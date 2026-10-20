package com.homeplatform.homeassistant;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;

import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * Home Assistant WebSocket API message handling, kept free of any socket so it can be
 * unit-tested. One instance per connection: feed every inbound text message to
 * {@link #onMessage}, send whatever it returns.
 *
 * <p>Flow: {@code auth_required} → we send {@code auth}; {@code auth_ok} → we send
 * {@code subscribe_events(state_changed)}; {@code event} messages for that subscription
 * are parsed and handed to the {@link Listener}. Message IDs increase per connection,
 * as HA requires. Duplicate events (same entity + {@code last_updated}) and malformed
 * messages are dropped.
 */
public class HaWebSocketProtocol {

    public interface Listener {
        void onAuthenticated();
        void onAuthFailed(String message);
        void onSubscribed();
        void onStateChanged(HaEntityState newState);
    }

    private final ObjectMapper mapper;
    private final String token;
    private final Listener listener;

    private int nextId = 1;
    private Integer subscriptionId;
    private boolean authenticated;
    private int malformed;
    private Instant lastMessageAt = Instant.now();
    private final Map<String, Instant> lastSeen = new HashMap<>();

    public HaWebSocketProtocol(ObjectMapper mapper, String token, Listener listener) {
        this.mapper = mapper;
        this.token = token;
        this.listener = listener;
    }

    /** Handle one inbound message; returns the messages to send (possibly empty). */
    public List<String> onMessage(String text) {
        lastMessageAt = Instant.now();
        JsonNode msg;
        try {
            msg = mapper.readTree(text);
        } catch (Exception e) {
            malformed++;
            return List.of();
        }
        if (msg == null || !msg.isObject()) {
            malformed++;
            return List.of();
        }
        String type = msg.path("type").asText("");
        List<String> out = new ArrayList<>();
        switch (type) {
            case "auth_required" -> {
                ObjectNode auth = mapper.createObjectNode();
                auth.put("type", "auth");
                auth.put("access_token", token);
                out.add(auth.toString());
            }
            case "auth_ok" -> {
                authenticated = true;
                listener.onAuthenticated();
                subscriptionId = nextId++;
                ObjectNode sub = mapper.createObjectNode();
                sub.put("id", subscriptionId);
                sub.put("type", "subscribe_events");
                sub.put("event_type", "state_changed");
                out.add(sub.toString());
            }
            case "auth_invalid" -> {
                authenticated = false;
                listener.onAuthFailed(msg.path("message").asText("auth_invalid"));
            }
            case "result" -> {
                if (Objects.equals(intOrNull(msg.get("id")), subscriptionId)) {
                    if (msg.path("success").asBoolean(false)) {
                        listener.onSubscribed();
                    } else {
                        listener.onAuthFailed("subscribe_events failed: "
                                + msg.path("error").path("message").asText("unknown error"));
                    }
                }
            }
            case "event" -> handleEvent(msg);
            case "pong" -> { /* lastMessageAt already updated */ }
            default -> { /* ignore unknown types */ }
        }
        return out;
    }

    private void handleEvent(JsonNode msg) {
        if (subscriptionId == null || !Objects.equals(intOrNull(msg.get("id")), subscriptionId)) return;
        JsonNode event = msg.path("event");
        if (!"state_changed".equals(event.path("event_type").asText())) return;
        JsonNode newState = event.path("data").path("new_state");
        if (newState.isMissingNode() || newState.isNull()) return; // entity removed
        HaEntityState state;
        try {
            state = HaEntityState.fromJson(newState);
        } catch (HomeAssistantException.InvalidResponse e) {
            malformed++;
            return;
        }
        if (state.lastUpdated() != null) {
            Instant prev = lastSeen.put(state.entityId(), state.lastUpdated());
            if (state.lastUpdated().equals(prev)) return; // duplicate delivery
        }
        listener.onStateChanged(state);
    }

    /** A {@code ping} message with the next ID (HA answers with {@code pong}). */
    public String ping() {
        ObjectNode p = mapper.createObjectNode();
        p.put("id", nextId++);
        p.put("type", "ping");
        return p.toString();
    }

    public boolean isAuthenticated() { return authenticated; }
    public int getMalformedCount() { return malformed; }
    public Instant getLastMessageAt() { return lastMessageAt; }

    private static Integer intOrNull(JsonNode n) {
        return n != null && n.canConvertToInt() ? n.asInt() : null;
    }
}
