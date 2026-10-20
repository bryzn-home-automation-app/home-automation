package com.homeplatform.homeassistant;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.homeplatform.service.AppEventService;
import jakarta.annotation.PreDestroy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.annotation.Profile;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.WebSocket;
import java.time.Duration;
import java.time.Instant;
import java.util.UUID;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;

/**
 * Keeps one authenticated connection to HA's WebSocket API and feeds
 * {@code state_changed} events into {@link HomeAssistantService}. Reconnects with
 * exponential backoff (5s → 5 min; 30 min after an auth failure, since retrying a bad
 * token fast is pointless). Does nothing when the integration is inactive.
 *
 * <p>Protocol handling lives in {@link HaWebSocketProtocol}; this class is only the
 * socket, the timers, and the threading. All ingestion runs on one worker thread, so
 * events are processed in arrival order. Excluded from tests via {@code @Profile("!test")}.
 */
@Component
@Profile("!test")
public class HomeAssistantWebSocket {

    private static final Logger log = LoggerFactory.getLogger(HomeAssistantWebSocket.class);
    private static final String SOURCE = "HomeAssistantWebSocket";
    private static final Duration MIN_BACKOFF = Duration.ofSeconds(5);
    private static final Duration MAX_BACKOFF = Duration.ofMinutes(5);
    private static final Duration AUTH_FAILED_BACKOFF = Duration.ofMinutes(30);
    private static final Duration PING_EVERY = Duration.ofSeconds(30);
    private static final Duration SILENCE_LIMIT = Duration.ofSeconds(90);

    private final HomeAssistantProperties props;
    private final HomeAssistantService service;
    private final AppEventService appEventService;
    private final ObjectMapper mapper;
    private final HttpClient http;
    private final ScheduledExecutorService worker = Executors.newSingleThreadScheduledExecutor(r -> {
        Thread t = new Thread(r, "ha-websocket");
        t.setDaemon(true);
        return t;
    });

    // Mutated only on the worker thread, except where noted.
    private volatile WebSocket socket;
    private volatile HaWebSocketProtocol protocol;
    private volatile long generation;
    private volatile boolean stopping;
    private volatile UUID sessionBatchId;
    private int attempts;
    private boolean connected;
    private boolean authFailed;

    public HomeAssistantWebSocket(HomeAssistantProperties props, HomeAssistantService service,
                                  AppEventService appEventService, ObjectMapper mapper) {
        this.props = props;
        this.service = service;
        this.appEventService = appEventService;
        this.mapper = mapper;
        this.http = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(props.getRequestTimeoutSeconds()))
                .build();
    }

    @EventListener(ApplicationReadyEvent.class)
    public void start() {
        if (!props.isActive()) {
            log.info("Home Assistant integration inactive ({}) — WebSocket not started", props.inactiveReason());
            return;
        }
        worker.execute(this::connect);
        worker.scheduleAtFixedRate(this::heartbeat, PING_EVERY.toSeconds(), PING_EVERY.toSeconds(), TimeUnit.SECONDS);
    }

    @PreDestroy
    public void stop() {
        stopping = true;
        WebSocket ws = socket;
        if (ws != null) ws.sendClose(WebSocket.NORMAL_CLOSURE, "shutdown");
        worker.shutdownNow();
    }

    // ── connection lifecycle (worker thread) ──

    private void connect() {
        if (stopping) return;
        long gen = ++generation;
        authFailed = false;
        protocol = new HaWebSocketProtocol(mapper, props.getToken(), new ProtocolCallbacks(gen));
        http.newWebSocketBuilder()
                .connectTimeout(Duration.ofSeconds(props.getRequestTimeoutSeconds()))
                .buildAsync(URI.create(props.webSocketUrl()), new SocketListener(gen))
                .whenComplete((ws, err) -> {
                    if (err != null) worker.execute(() -> disconnected(gen, "connect failed: " + rootMessage(err)));
                });
    }

    private void disconnected(long gen, String reason) {
        if (gen != generation || stopping) return; // stale callback from an old socket
        socket = null;
        generation++; // invalidate any further callbacks from the dead socket
        if (connected) {
            connected = false;
            event(() -> appEventService.warn("home-assistant", SOURCE, "Disconnected from Home Assistant: " + reason));
        } else {
            log.debug("Home Assistant WebSocket not connected: {}", reason);
        }
        Duration delay = authFailed ? AUTH_FAILED_BACKOFF : backoff(attempts++);
        worker.schedule(this::connect, delay.toMillis(), TimeUnit.MILLISECONDS);
    }

    static Duration backoff(int attempt) {
        long seconds = MIN_BACKOFF.toSeconds() << Math.min(attempt, 10);
        return seconds >= MAX_BACKOFF.toSeconds() ? MAX_BACKOFF : Duration.ofSeconds(seconds);
    }

    private void heartbeat() {
        // An exception here would cancel the fixed-rate schedule for good.
        try {
            checkHeartbeat();
        } catch (Exception e) {
            log.warn("Home Assistant heartbeat failed: {}", e.getMessage());
        }
    }

    private void checkHeartbeat() {
        WebSocket ws = socket;
        HaWebSocketProtocol p = protocol;
        if (ws == null || p == null) return;
        // Also catches a socket that opened but never completed the auth handshake.
        if (Duration.between(p.getLastMessageAt(), Instant.now()).compareTo(SILENCE_LIMIT) > 0) {
            ws.abort();
            disconnected(generation, "no messages for " + SILENCE_LIMIT.toSeconds() + "s");
            return;
        }
        if (p.isAuthenticated()) ws.sendText(p.ping(), true);
    }

    private void handle(long gen, String text) {
        if (gen != generation) return;
        WebSocket ws = socket;
        for (String out : protocol.onMessage(text)) {
            if (ws != null) ws.sendText(out, true);
        }
    }

    /**
     * Writes an app_events row without letting a database error escape: these run on
     * the reconnect path, and a throw there would leave ingestion dead until restart.
     */
    private static void event(Runnable write) {
        try {
            write.run();
        } catch (Exception e) {
            log.warn("Could not record Home Assistant connection event: {}", e.getMessage());
        }
    }

    private static String rootMessage(Throwable t) {
        while (t.getCause() != null) t = t.getCause();
        return t.getClass().getSimpleName() + (t.getMessage() == null ? "" : ": " + t.getMessage());
    }

    // ── protocol callbacks (worker thread) ──

    private final class ProtocolCallbacks implements HaWebSocketProtocol.Listener {
        private final long gen;

        ProtocolCallbacks(long gen) { this.gen = gen; }

        @Override
        public void onAuthenticated() {
            sessionBatchId = UUID.randomUUID();
        }

        @Override
        public void onSubscribed() {
            attempts = 0;
            connected = true;
            event(() -> appEventService.info("home-assistant", SOURCE, "Connected to Home Assistant (state_changed subscribed)"));
            // Make sure devices/status exist before relying on events.
            try {
                service.discoverAndSnapshot();
            } catch (Exception e) {
                log.warn("Initial Home Assistant discovery failed: {}", e.getMessage());
            }
        }

        @Override
        public void onAuthFailed(String message) {
            authFailed = true;
            event(() -> appEventService.error("home-assistant", SOURCE,
                    "Home Assistant rejected the WebSocket login — check HA_TOKEN", message));
            WebSocket ws = socket;
            if (ws != null) ws.abort();
            disconnected(gen, "auth failed");
        }

        @Override
        public void onStateChanged(HaEntityState newState) {
            service.handleStateChanged(newState, sessionBatchId);
        }
    }

    // ── socket listener (HttpClient threads → hops to the worker) ──

    private final class SocketListener implements WebSocket.Listener {
        private final long gen;
        private final StringBuilder buffer = new StringBuilder();

        SocketListener(long gen) { this.gen = gen; }

        @Override
        public void onOpen(WebSocket ws) {
            // Set before any message is processed, so the reply to auth_required can be sent.
            if (gen == generation) socket = ws;
            ws.request(1);
        }

        @Override
        public CompletionStage<?> onText(WebSocket ws, CharSequence data, boolean last) {
            buffer.append(data);
            if (last) {
                String text = buffer.toString();
                buffer.setLength(0);
                worker.execute(() -> handle(gen, text));
            }
            ws.request(1);
            return null;
        }

        @Override
        public CompletionStage<?> onClose(WebSocket ws, int statusCode, String reason) {
            worker.execute(() -> disconnected(gen, "closed (" + statusCode + ")"));
            return null;
        }

        @Override
        public void onError(WebSocket ws, Throwable error) {
            worker.execute(() -> disconnected(gen, rootMessage(error)));
        }
    }
}
