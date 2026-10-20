package com.homeplatform.push;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.homeplatform.model.Notification.Category;
import com.homeplatform.model.Notification.Severity;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.security.KeyPair;
import java.security.interfaces.ECPublicKey;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

class PushServiceTest {

    private static final String APPLE = "https://web.push.apple.com/QGuQyavXutnMH8hFvd7";

    private PushSubscriptionRepository subs;
    private PushVapidKeyRepository keys;
    private HttpClient http;
    private PushService service;
    private final List<PushSubscription> stored = new ArrayList<>();
    private String p256dh;
    private String auth;

    @BeforeEach
    void setUp() {
        subs = mock(PushSubscriptionRepository.class);
        keys = mock(PushVapidKeyRepository.class);
        http = mock(HttpClient.class);
        service = new PushService(subs, keys, new ObjectMapper(), http,
                Clock.fixed(Instant.parse("2026-10-20T23:00:00Z"), ZoneId.of("America/Chicago")), "https://homeos.local");
        when(keys.findById(1)).thenReturn(Optional.empty());
        when(keys.save(any())).thenAnswer(i -> {
            PushVapidKey k = i.getArgument(0);
            when(keys.findById(1)).thenReturn(Optional.of(k));
            return k;
        });
        when(subs.save(any())).thenAnswer(i -> {
            PushSubscription s = i.getArgument(0);
            if (!stored.contains(s)) stored.add(s);
            return s;
        });
        doAnswer(i -> stored.remove(i.<PushSubscription>getArgument(0))).when(subs).delete(any());
        when(subs.findByUserId(any())).thenAnswer(i -> stored.stream().filter(s -> s.getUserId().equals(i.getArgument(0))).toList());
        when(subs.findByEndpoint(any())).thenAnswer(i -> stored.stream().filter(s -> s.getEndpoint().equals(i.getArgument(0))).findFirst());
        KeyPair browser = WebPushCrypto.newKeyPair();
        p256dh = WebPushCrypto.b64(WebPushCrypto.encodePoint((ECPublicKey) browser.getPublic()));
        auth = WebPushCrypto.b64(new byte[16]);
    }

    @SuppressWarnings("unchecked")
    private void pushServiceAnswers(int status) throws Exception {
        HttpResponse<String> resp = mock(HttpResponse.class);
        when(resp.statusCode()).thenReturn(status);
        when(resp.body()).thenReturn("");
        doReturn(resp).when(http).send(any(HttpRequest.class), any());
    }

    @Test
    @DisplayName("only real push services are accepted as endpoints (no SSRF)")
    void endpointAllowlist() {
        assertDoesNotThrow(() -> PushService.validate(APPLE, p256dh, auth));
        assertDoesNotThrow(() -> PushService.validate("https://fcm.googleapis.com/fcm/send/abc", p256dh, auth));
        assertDoesNotThrow(() -> PushService.validate("https://updates.push.services.mozilla.com/wpush/v2/x", p256dh, auth));
        for (String bad : new String[]{"http://web.push.apple.com/x", "https://backend:8080/api/admin",
                "https://evil.com/web.push.apple.com", "https://push.apple.com.evil.com/x", "https://192.168.4.1/", "garbage"}) {
            assertThrows(IllegalArgumentException.class, () -> PushService.validate(bad, p256dh, auth), bad);
        }
        assertThrows(IllegalArgumentException.class, () -> PushService.validate(APPLE, "not-a-key", auth));
        assertThrows(IllegalArgumentException.class, () -> PushService.validate(APPLE, p256dh, WebPushCrypto.b64(new byte[8])));
    }

    @Test
    @DisplayName("camera alerts and anything critical are pushed; the rest stays in-app")
    void whatGetsPushed() {
        assertTrue(PushService.shouldPush(Category.CAMERA, Severity.INFO));
        assertTrue(PushService.shouldPush(Category.ROOMBA, Severity.CRITICAL));
        assertFalse(PushService.shouldPush(Category.ELECTRICAL, Severity.WARNING));
        assertFalse(PushService.shouldPush(Category.ROOMBA, Severity.SUCCESS));
        assertEquals("/cameras", PushService.urlFor(Category.CAMERA));
        assertEquals("/utility", PushService.urlFor(Category.GAS));
    }

    @Test
    @DisplayName("subscribe is an upsert by endpoint; a device follows whoever signed in last")
    void subscribeUpsert() {
        service.subscribe(1L, APPLE, p256dh, auth, "iPhone");
        service.subscribe(2L, APPLE, p256dh, auth, "iPhone");
        assertEquals(1, stored.size());
        assertEquals(2L, stored.get(0).getUserId());
        assertTrue(service.isSubscribed(2L, APPLE));
        assertFalse(service.isSubscribed(1L, APPLE));
        service.unsubscribe(1L, APPLE); // not theirs
        assertEquals(1, stored.size());
        service.unsubscribe(2L, APPLE);
        assertTrue(stored.isEmpty());
    }

    @Test
    @DisplayName("the VAPID key pair is generated once and reused")
    void vapidKeyStable() {
        String k1 = service.publicKey();
        String k2 = new PushService(subs, keys, new ObjectMapper(), http, Clock.systemUTC(), "https://homeos.local").publicKey();
        assertEquals(k1, k2);
        verify(keys, times(1)).save(any());
    }

    @Test
    @DisplayName("a test push is encrypted, VAPID-signed and sent to each device")
    void sendTest() throws Exception {
        pushServiceAnswers(201);
        service.subscribe(1L, APPLE, p256dh, auth, "iPhone");
        assertEquals(1, service.sendTest(1L));
        var req = org.mockito.ArgumentCaptor.forClass(HttpRequest.class);
        verify(http).send(req.capture(), any());
        HttpRequest r = req.getValue();
        assertEquals(APPLE, r.uri().toString());
        assertEquals("aes128gcm", r.headers().firstValue("Content-Encoding").orElseThrow());
        assertTrue(r.headers().firstValue("Authorization").orElseThrow().startsWith("vapid t="));
        assertTrue(r.headers().firstValue("TTL").isPresent());
        assertNotNull(stored.get(0).getLastSuccessAt());
    }

    @Test
    @DisplayName("a subscription the push service says is gone (410) is deleted")
    void expiredRemoved() throws Exception {
        pushServiceAnswers(410);
        service.subscribe(1L, APPLE, p256dh, auth, "iPhone");
        assertEquals(0, service.sendTest(1L));
        assertTrue(stored.isEmpty());
    }

    @Test
    @DisplayName("repeated failures drop the subscription after the limit")
    void failuresCounted() throws Exception {
        pushServiceAnswers(500);
        service.subscribe(1L, APPLE, p256dh, auth, "iPhone");
        for (int i = 0; i < PushService.MAX_FAILURES - 1; i++) service.sendTest(1L);
        assertEquals(PushService.MAX_FAILURES - 1, stored.get(0).getFailureCount());
        service.sendTest(1L);
        assertTrue(stored.isEmpty());
    }

    @Test
    @DisplayName("a camera notification is pushed in the background; an electric warning isn't")
    void eventsPushed() throws Exception {
        pushServiceAnswers(201);
        service.subscribe(1L, APPLE, p256dh, auth, "iPhone");
        service.onNotification(new NotificationCreatedEvent(1L, Category.ELECTRICAL, Severity.WARNING, "Spike", "x"));
        service.onNotification(new NotificationCreatedEvent(1L, Category.CAMERA, Severity.INFO, "Person detected — Front", "x"));
        verify(http, timeout(2_000).times(1)).send(any(HttpRequest.class), any());
    }
}
