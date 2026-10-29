package com.homeplatform.homeassistant;

import com.homeplatform.service.AppEventService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;

/**
 * Logs to the Debug Dashboard when the eufy bridge's go2rtc — the server every live
 * view streams from — stops answering, and again when it's back. go2rtc can crash on
 * its own (10/29: a panic in its H.265 → MP4 path) and the bridge doesn't restart it,
 * so every live view got a 502 and the iPhone player said the format wasn't supported.
 * The eufy-bridge healthcheck in docker-compose.yml now restarts the container after
 * about a minute; this records that it happened and how long video was out.
 */
@Component
public class CameraVideoWatchdog {

    /** Often enough to see an outage before the bridge's healthcheck restart (~50 s) ends it. */
    static final Duration INTERVAL = Duration.ofSeconds(10);
    /** Consecutive failed checks before video counts as down (one slow answer isn't an outage). */
    static final int FAILURES_BEFORE_DOWN = 2;

    private static final String SOURCE = "CameraVideoWatchdog";

    private final String go2rtcUrl;
    private final HttpClient http;
    private final Clock clock;
    private final AppEventService events;

    private int failures = 0;
    private Instant firstFailure = null;
    private Instant downSince = null;
    private String lastError = null;

    @Autowired
    public CameraVideoWatchdog(@Value("${app.camera-go2rtc.url:http://eufy-bridge:1984}") String go2rtcUrl,
                               AppEventService events) {
        this(go2rtcUrl, HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).build(), Clock.systemUTC(), events);
    }

    CameraVideoWatchdog(String go2rtcUrl, HttpClient http, Clock clock, AppEventService events) {
        this.go2rtcUrl = go2rtcUrl == null ? "" : go2rtcUrl.replaceAll("/+$", "");
        this.http = http;
        this.clock = clock;
        this.events = events;
    }

    @Scheduled(fixedDelay = 10_000, initialDelay = 30_000)
    void check() {
        if (go2rtcUrl.isBlank()) return;
        record(probe());
    }

    /** True when go2rtc answers its API. */
    boolean probe() {
        try {
            HttpRequest req = HttpRequest.newBuilder(URI.create(go2rtcUrl + "/api")).timeout(Duration.ofSeconds(5)).GET().build();
            int status = http.send(req, HttpResponse.BodyHandlers.discarding()).statusCode();
            lastError = status == 200 ? null : "HTTP " + status;
            return status == 200;
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            lastError = "interrupted";
            return false;
        } catch (Exception e) {
            lastError = e.getClass().getSimpleName() + (e.getMessage() != null ? ": " + e.getMessage() : "");
            return false;
        }
    }

    /** Applies one check's result; logs only when video goes down or comes back. */
    void record(boolean up) {
        Instant now = clock.instant();
        if (up) {
            failures = 0;
            firstFailure = null;
            if (downSince != null) {
                events.info("camera", SOURCE, "Live video is back — go2rtc answering again after "
                        + describe(Duration.between(downSince, now)) + " down");
                downSince = null;
            }
            return;
        }
        if (failures++ == 0) firstFailure = now;
        if (failures == FAILURES_BEFORE_DOWN && downSince == null) {
            downSince = firstFailure;
            events.log("camera", "WARN", SOURCE,
                    "Live video is down — the eufy bridge's go2rtc isn't answering; the bridge restarts itself within about a minute",
                    lastError);
        }
    }

    boolean down() {
        return downSince != null;
    }

    static String describe(Duration d) {
        long s = Math.max(0, d.toSeconds());
        if (s < 60) return s + " s";
        long m = s / 60;
        return s % 60 == 0 ? m + " min" : m + " min " + (s % 60) + " s";
    }
}
