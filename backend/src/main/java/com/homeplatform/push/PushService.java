package com.homeplatform.push;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.homeplatform.model.Notification.Category;
import com.homeplatform.model.Notification.Severity;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.event.TransactionalEventListener;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.KeyPair;
import java.security.interfaces.ECPublicKey;
import java.time.Clock;
import java.time.Duration;
import java.time.LocalDateTime;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Phone alerts over Web Push (works for the iPhone Home Screen app on iOS 16.4+).
 * Devices subscribe from the Profile page; this pushes the in-app notifications that
 * are worth interrupting someone for — everything from the cameras and anything
 * CRITICAL — and leaves the rest in the in-app Alerts list.
 *
 * <p>Sends run on a background thread after the notification row commits, so alert
 * generation never waits on Apple/Google. A subscription the push service reports as
 * gone (404/410) is deleted; one that keeps failing is dropped after
 * {@link #MAX_FAILURES}.
 */
@Service
public class PushService {

    private static final Logger log = LoggerFactory.getLogger(PushService.class);

    static final int MAX_FAILURES = 10;
    static final Duration TTL = Duration.ofHours(12);
    /**
     * Push services we'll POST to. The endpoint comes from the browser, so without an
     * allowlist a member could make the server request any URL (SSRF).
     */
    static final Set<String> ALLOWED_HOST_SUFFIXES = Set.of(
            ".push.apple.com", "fcm.googleapis.com", "android.googleapis.com",
            ".push.services.mozilla.com", ".notify.windows.com");

    private final PushSubscriptionRepository subs;
    private final PushVapidKeyRepository keys;
    private final ObjectMapper mapper;
    private final HttpClient http;
    private final Clock clock;
    /**
     * VAPID "sub" contact (a mailto: or https: URL). Apple answers 403 BadJwtToken
     * when it isn't a real public domain, e.g. https://homeos.local, so the default
     * is the app's Tailscale HTTPS address.
     */
    private final String subject;
    private final ExecutorService sender = Executors.newSingleThreadExecutor(r -> {
        Thread t = new Thread(r, "web-push");
        t.setDaemon(true);
        return t;
    });
    private volatile KeyPair vapid;

    @Autowired
    public PushService(PushSubscriptionRepository subs, PushVapidKeyRepository keys, ObjectMapper mapper,
                       @Value("${app.push.subject:https://nuc.tailf10ac4.ts.net}") String subject) {
        this(subs, keys, mapper, HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build(),
                Clock.systemDefaultZone(), subject);
    }

    PushService(PushSubscriptionRepository subs, PushVapidKeyRepository keys, ObjectMapper mapper,
                HttpClient http, Clock clock, String subject) {
        this.subs = subs;
        this.keys = keys;
        this.mapper = mapper;
        this.http = http;
        this.clock = clock;
        this.subject = subject;
    }

    /** The VAPID public key the browser needs to subscribe (base64url uncompressed point). */
    public String publicKey() {
        return WebPushCrypto.b64(WebPushCrypto.encodePoint((ECPublicKey) vapid().getPublic()));
    }

    /** Register (or re-register) this device for a member. */
    @Transactional
    public void subscribe(Long userId, String endpoint, String p256dh, String auth, String userAgent) {
        validate(endpoint, p256dh, auth);
        PushSubscription s = subs.findByEndpoint(endpoint).orElseGet(() -> PushSubscription.builder()
                .endpoint(endpoint).createdAt(LocalDateTime.now(clock)).build());
        // A device signing in as someone else takes the subscription with it.
        s.setUserId(userId);
        s.setP256dh(p256dh);
        s.setAuth(auth);
        s.setUserAgent(userAgent == null ? null : userAgent.substring(0, Math.min(300, userAgent.length())));
        s.setFailureCount(0);
        subs.save(s);
    }

    @Transactional
    public void unsubscribe(Long userId, String endpoint) {
        subs.findByEndpoint(endpoint).filter(s -> s.getUserId().equals(userId)).ifPresent(subs::delete);
    }

    public boolean isSubscribed(Long userId, String endpoint) {
        return subs.findByEndpoint(endpoint).map(s -> s.getUserId().equals(userId)).orElse(false);
    }

    /** Push one test alert to all of a user's devices now; returns how many accepted it. */
    public int sendTest(Long userId) {
        Map<String, Object> payload = payload("HomeOS alerts are on",
                "This is how camera and critical alerts will reach this phone.", "/notifications", "test");
        int ok = 0;
        for (PushSubscription s : subs.findByUserId(userId)) {
            if (send(s, payload, false)) ok++;
        }
        return ok;
    }

    /** Push in-app notifications worth an interruption, once the row has committed. */
    @TransactionalEventListener(fallbackExecution = true)
    public void onNotification(NotificationCreatedEvent e) {
        if (e.push() != null ? !e.push() : !shouldPush(e.category(), e.severity())) return;
        Map<String, Object> payload = payload(e.title(), e.message(), urlFor(e.category()), e.title());
        boolean urgent = e.severity() == Severity.CRITICAL || e.category() == Category.CAMERA;
        sender.execute(() -> {
            try {
                for (PushSubscription s : subs.findByUserId(e.userId())) send(s, payload, urgent);
            } catch (Exception ex) {
                log.warn("Push delivery failed: {}", ex.getMessage());
            }
        });
    }

    static boolean shouldPush(Category category, Severity severity) {
        return category == Category.CAMERA || severity == Severity.CRITICAL;
    }

    static String urlFor(Category category) {
        return switch (category) {
            case CAMERA -> "/cameras";
            case ROOMBA -> "/roomba";
            case ELECTRICAL, GAS, WATER -> "/utility";
            default -> "/notifications";
        };
    }

    // ── delivery ──

    /** @return true when the push service accepted the message. */
    boolean send(PushSubscription s, Map<String, Object> payload, boolean urgent) {
        try {
            byte[] body = WebPushCrypto.encrypt(mapper.writeValueAsBytes(payload),
                    WebPushCrypto.unb64(s.getP256dh()), WebPushCrypto.unb64(s.getAuth()));
            KeyPair kp = vapid();
            HttpRequest req = HttpRequest.newBuilder(URI.create(s.getEndpoint()))
                    .timeout(Duration.ofSeconds(15))
                    .header("Content-Type", "application/octet-stream")
                    .header("Content-Encoding", "aes128gcm")
                    .header("TTL", String.valueOf(TTL.toSeconds()))
                    .header("Urgency", urgent ? "high" : "normal")
                    .header("Authorization", WebPushCrypto.vapidAuthorization(s.getEndpoint(), subject,
                            (ECPublicKey) kp.getPublic(), kp.getPrivate(), clock.instant().getEpochSecond()))
                    .POST(HttpRequest.BodyPublishers.ofByteArray(body))
                    .build();
            HttpResponse<String> resp = http.send(req, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            int code = resp.statusCode();
            if (code >= 200 && code < 300) {
                s.setLastSuccessAt(LocalDateTime.now(clock));
                s.setFailureCount(0);
                subs.save(s);
                return true;
            }
            if (code == 404 || code == 410) {
                log.info("Push subscription expired (HTTP {}); removing it", code);
                subs.delete(s);
                return false;
            }
            log.warn("Push service returned HTTP {}: {}", code, resp.body() == null ? "" : resp.body().substring(0, Math.min(200, resp.body().length())));
            recordFailure(s);
            return false;
        } catch (InterruptedException ie) {
            Thread.currentThread().interrupt();
            return false;
        } catch (Exception ex) {
            log.warn("Push send failed: {}", ex.getMessage());
            recordFailure(s);
            return false;
        }
    }

    private void recordFailure(PushSubscription s) {
        s.setFailureCount(s.getFailureCount() + 1);
        if (s.getFailureCount() >= MAX_FAILURES) subs.delete(s);
        else subs.save(s);
    }

    private static Map<String, Object> payload(String title, String body, String url, String tag) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("title", title == null ? "HomeOS" : title);
        m.put("body", body == null ? "" : body.length() > 300 ? body.substring(0, 300) : body);
        m.put("url", url);
        m.put("tag", tag);
        return m;
    }

    static void validate(String endpoint, String p256dh, String auth) {
        URI u;
        try {
            u = URI.create(endpoint);
        } catch (Exception e) {
            throw new IllegalArgumentException("Invalid push endpoint");
        }
        String host = u.getHost() == null ? "" : u.getHost().toLowerCase();
        boolean allowed = "https".equals(u.getScheme())
                && ALLOWED_HOST_SUFFIXES.stream().anyMatch(sfx -> sfx.startsWith(".") ? host.endsWith(sfx) : host.equals(sfx));
        if (!allowed) throw new IllegalArgumentException("Unsupported push service");
        try {
            WebPushCrypto.decodePoint(WebPushCrypto.unb64(p256dh));
            if (WebPushCrypto.unb64(auth).length != 16) throw new IllegalArgumentException();
        } catch (RuntimeException e) {
            throw new IllegalArgumentException("Invalid push subscription keys");
        }
    }

    /** Load the server's VAPID key pair, generating and storing it on first use. */
    synchronized KeyPair vapid() {
        if (vapid != null) return vapid;
        PushVapidKey stored = keys.findById(1).orElse(null);
        if (stored == null) {
            KeyPair kp = WebPushCrypto.newKeyPair();
            stored = keys.save(PushVapidKey.builder()
                    .id(1)
                    .publicKey(WebPushCrypto.b64(WebPushCrypto.encodePoint((ECPublicKey) kp.getPublic())))
                    .privateKey(WebPushCrypto.b64(kp.getPrivate().getEncoded()))
                    .createdAt(LocalDateTime.now(clock))
                    .build());
            log.info("Generated the Web Push (VAPID) key pair");
        }
        vapid = new KeyPair(WebPushCrypto.decodePoint(WebPushCrypto.unb64(stored.getPublicKey())),
                WebPushCrypto.decodePrivate(WebPushCrypto.unb64(stored.getPrivateKey())));
        return vapid;
    }

    /** For tests/admin: current subscriptions of a user. */
    List<PushSubscription> subscriptionsOf(Long userId) {
        return subs.findByUserId(userId);
    }
}
