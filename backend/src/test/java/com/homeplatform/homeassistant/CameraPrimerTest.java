package com.homeplatform.homeassistant;

import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.http.HttpClient;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;

/** CameraPrimer against a fake go2rtc that streams bytes until the client hangs up. */
class CameraPrimerTest {

    private HttpServer server;
    private final Map<String, AtomicInteger> opens = new ConcurrentHashMap<>();
    private final Set<String> open = ConcurrentHashMap.newKeySet();
    private MutableClock clock;
    private CameraPrimer primer;

    @BeforeEach
    void setUp() throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/api/stream.mp4", ex -> {
            String src = ex.getRequestURI().getQuery().replace("src=", "");
            opens.computeIfAbsent(src, k -> new AtomicInteger()).incrementAndGet();
            open.add(src);
            ex.sendResponseHeaders(200, 0);
            try (OutputStream out = ex.getResponseBody()) {
                byte[] chunk = new byte[4096];
                for (int i = 0; i < 2_000; i++) {
                    out.write(chunk);
                    out.flush();
                    Thread.sleep(20);
                }
            } catch (Exception hungUp) {
                // the primer closed it
            } finally {
                open.remove(src);
            }
        });
        server.setExecutor(java.util.concurrent.Executors.newCachedThreadPool());
        server.start();
        clock = new MutableClock(Instant.parse("2026-10-24T06:00:00Z"));
        primer = new CameraPrimer("http://127.0.0.1:" + server.getAddress().getPort() + "/",
                HttpClient.newHttpClient(), clock);
    }

    @AfterEach
    void tearDown() {
        server.stop(0);
    }

    @Test
    @DisplayName("a heartbeat opens one stream per camera, and they close once the window passes")
    void holdsThenReleases() throws Exception {
        primer.prime(List.of("CAM1", "CAM2"));
        primer.prime(List.of("CAM1", "CAM2")); // a second heartbeat doesn't open more
        waitFor(() -> open.containsAll(Set.of("CAM1", "CAM2")));
        assertThat(primer.holding()).containsExactlyInAnyOrder("CAM1", "CAM2");
        assertThat(opens.get("CAM1").get()).isEqualTo(1);

        clock.now = clock.now.plus(CameraPrimer.WINDOW).plusSeconds(1);
        primer.release();
        waitFor(() -> open.isEmpty() && primer.holding().isEmpty());
    }

    @Test
    @DisplayName("nothing is primed without a go2rtc address or any camera")
    void noop() {
        CameraPrimer off = new CameraPrimer("", HttpClient.newHttpClient(), clock);
        off.prime(List.of("CAM1"));
        assertThat(off.primed()).isFalse();
        primer.prime(List.of());
        assertThat(primer.primed()).isFalse();
    }

    private static void waitFor(java.util.function.BooleanSupplier cond) throws InterruptedException {
        for (int i = 0; i < 100 && !cond.getAsBoolean(); i++) Thread.sleep(50);
        assertThat(cond.getAsBoolean()).isTrue();
    }

    private static final class MutableClock extends Clock {
        volatile Instant now;
        MutableClock(Instant now) { this.now = now; }
        @Override public ZoneOffset getZone() { return ZoneOffset.UTC; }
        @Override public Clock withZone(java.time.ZoneId zone) { return this; }
        @Override public Instant instant() { return now; }
    }
}
