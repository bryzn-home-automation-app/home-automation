package com.homeplatform.homeassistant;

import com.homeplatform.service.AppEventService;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.http.HttpClient;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** CameraVideoWatchdog logs once when go2rtc goes down and once when it's back. */
class CameraVideoWatchdogTest {

    private AppEventService events;
    private Instant now;
    private CameraVideoWatchdog watchdog;

    @BeforeEach
    void setUp() {
        events = mock(AppEventService.class);
        now = Instant.parse("2026-10-29T14:19:00Z");
        Clock clock = new Clock() {
            @Override public ZoneId getZone() { return ZoneId.of("UTC"); }
            @Override public Clock withZone(ZoneId zone) { return this; }
            @Override public Instant instant() { return now; }
        };
        watchdog = new CameraVideoWatchdog("http://127.0.0.1:1", HttpClient.newHttpClient(), clock, events);
    }

    private void tick(boolean up) {
        watchdog.record(up);
        now = now.plus(CameraVideoWatchdog.INTERVAL);
    }

    @Test
    @DisplayName("one failed check isn't an outage")
    void singleFailureIsIgnored() {
        tick(false);
        tick(true);
        assertThat(watchdog.down()).isFalse();
        verifyNoInteractions(events);
    }

    @Test
    @DisplayName("logs a warning once when video goes down, and how long it was out when it's back")
    void logsDownAndBack() {
        tick(true);
        tick(false);
        tick(false);
        tick(false);
        tick(false);
        assertThat(watchdog.down()).isTrue();
        verify(events, times(1)).log(eq("camera"), eq("WARN"), eq("CameraVideoWatchdog"), contains("Live video is down"), any());

        tick(true);
        assertThat(watchdog.down()).isFalse();
        verify(events).info("camera", "CameraVideoWatchdog", "Live video is back — go2rtc answering again after 2 min down");
        tick(true);
        verifyNoMoreInteractions(events);
    }

    @Test
    @DisplayName("a go2rtc that isn't listening fails the probe; one that answers passes")
    void probe() throws Exception {
        int closed;
        try (ServerSocket s = new ServerSocket(0)) {
            closed = s.getLocalPort();
        }
        assertThat(new CameraVideoWatchdog("http://127.0.0.1:" + closed, HttpClient.newHttpClient(), Clock.systemUTC(), events).probe()).isFalse();

        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/api", ex -> {
            ex.sendResponseHeaders(200, -1);
            ex.close();
        });
        server.start();
        try {
            String url = "http://127.0.0.1:" + server.getAddress().getPort() + "/";
            assertThat(new CameraVideoWatchdog(url, HttpClient.newHttpClient(), Clock.systemUTC(), events).probe()).isTrue();
        } finally {
            server.stop(0);
        }
    }

    @Test
    void describesDurations() {
        assertThat(CameraVideoWatchdog.describe(Duration.ofSeconds(45))).isEqualTo("45 s");
        assertThat(CameraVideoWatchdog.describe(Duration.ofSeconds(120))).isEqualTo("2 min");
        assertThat(CameraVideoWatchdog.describe(Duration.ofSeconds(95))).isEqualTo("1 min 35 s");
    }
}
