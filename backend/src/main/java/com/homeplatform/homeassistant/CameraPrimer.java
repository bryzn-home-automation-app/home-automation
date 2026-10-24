package com.homeplatform.homeassistant;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Collection;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Keeps every camera's live stream running while a member is using the app, on any tab,
 * so the Cameras tab opens on a picture that's already live. Otherwise a battery camera
 * takes ~10 s to wake. The app sends a heartbeat ({@link #prime}) about once a minute
 * while someone is active, and the streams close {@link #WINDOW} after the last one.
 *
 * A stream is held by reading go2rtc's MP4 of it and discarding the bytes. go2rtc runs a
 * camera's producer while anyone is consuming it, so a browser that connects during the
 * window joins a stream that's already running. When the bridge ends a battery stream
 * at its own budget (STREAM_BATTERY_BUDGET_MS), the holder reopens it.
 */
@Component
public class CameraPrimer {

    static final Duration WINDOW = Duration.ofSeconds(90);
    private static final Duration RETRY_MIN = Duration.ofSeconds(2);
    private static final Duration RETRY_MAX = Duration.ofSeconds(30);

    private static final Logger log = LoggerFactory.getLogger(CameraPrimer.class);

    private final String go2rtcUrl;
    private final HttpClient http;
    private final Clock clock;
    private final Map<String, Holder> holders = new ConcurrentHashMap<>();
    private volatile Instant primedUntil = Instant.EPOCH;

    @Autowired
    public CameraPrimer(@Value("${app.camera-go2rtc.url:http://eufy-bridge:1984}") String go2rtcUrl) {
        this(go2rtcUrl, HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).build(), Clock.systemUTC());
    }

    CameraPrimer(String go2rtcUrl, HttpClient http, Clock clock) {
        this.go2rtcUrl = go2rtcUrl == null ? "" : go2rtcUrl.replaceAll("/+$", "");
        this.http = http;
        this.clock = clock;
    }

    /** Keep these go2rtc streams running for the next {@link #WINDOW}. */
    public void prime(Collection<String> streams) {
        if (go2rtcUrl.isBlank() || streams.isEmpty()) return;
        if (!primed()) log.info("Priming live view for {} camera(s)", streams.size());
        primedUntil = clock.instant().plus(WINDOW);
        for (String s : streams) holders.computeIfAbsent(s, this::start);
    }

    boolean primed() {
        return clock.instant().isBefore(primedUntil);
    }

    /** Streams being held right now. */
    Set<String> holding() {
        return Set.copyOf(holders.keySet());
    }

    /** Past the window, unblock any holder stuck waiting on a stream that went quiet. */
    @Scheduled(fixedDelay = 15_000)
    void release() {
        if (primed()) return;
        holders.values().forEach(Holder::close);
    }

    private Holder start(String stream) {
        Holder h = new Holder(stream);
        Thread t = new Thread(h, "camera-prime-" + stream);
        t.setDaemon(true);
        t.start();
        return h;
    }

    private final class Holder implements Runnable {
        private final String stream;
        private volatile InputStream body;

        Holder(String stream) {
            this.stream = stream;
        }

        @Override
        public void run() {
            Duration retry = RETRY_MIN;
            try {
                while (primed()) {
                    boolean flowed = hold();
                    if (!primed()) break;
                    retry = flowed ? RETRY_MIN : min(retry.multipliedBy(2), RETRY_MAX);
                    try {
                        Thread.sleep(retry.toMillis());
                    } catch (InterruptedException e) {
                        Thread.currentThread().interrupt();
                        return;
                    }
                }
            } finally {
                holders.remove(stream, this);
                // A heartbeat that landed while this one was on its way out found it still
                // registered and started nothing.
                if (primed()) holders.computeIfAbsent(stream, CameraPrimer.this::start);
            }
        }

        /** Read the stream until the window ends or the stream does. True when video came through. */
        private boolean hold() {
            URI uri = URI.create(go2rtcUrl + "/api/stream.mp4?src=" + URLEncoder.encode(stream, StandardCharsets.UTF_8));
            HttpRequest req = HttpRequest.newBuilder(uri).timeout(Duration.ofSeconds(20)).GET().build();
            long total = 0;
            try {
                HttpResponse<InputStream> res = http.send(req, HttpResponse.BodyHandlers.ofInputStream());
                body = res.body();
                if (res.statusCode() != 200) {
                    log.debug("Prime {}: go2rtc answered {}", stream, res.statusCode());
                    return false;
                }
                byte[] buf = new byte[64 * 1024];
                for (int n; primed() && (n = body.read(buf)) >= 0; ) total += n;
            } catch (IOException e) {
                log.debug("Prime {}: {}", stream, e.getMessage());
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            } finally {
                close();
            }
            return total > 0;
        }

        void close() {
            InputStream b = body;
            body = null;
            if (b == null) return;
            try {
                b.close();
            } catch (IOException ignored) {
                // closing anyway
            }
        }
    }

    private static Duration min(Duration a, Duration b) {
        return a.compareTo(b) <= 0 ? a : b;
    }
}
