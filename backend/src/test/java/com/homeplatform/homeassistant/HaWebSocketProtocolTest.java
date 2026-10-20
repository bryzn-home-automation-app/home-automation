package com.homeplatform.homeassistant;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/** HA WebSocket handshake/subscription/event handling without a real socket. */
class HaWebSocketProtocolTest {

    private static final ObjectMapper JSON = new ObjectMapper();

    private final List<String> calls = new ArrayList<>();
    private final List<HaEntityState> states = new ArrayList<>();
    private HaWebSocketProtocol protocol;

    @BeforeEach
    void setUp() {
        protocol = new HaWebSocketProtocol(JSON, "tok", new HaWebSocketProtocol.Listener() {
            public void onAuthenticated() { calls.add("authenticated"); }
            public void onAuthFailed(String m) { calls.add("authFailed:" + m); }
            public void onSubscribed() { calls.add("subscribed"); }
            public void onStateChanged(HaEntityState s) { states.add(s); }
        });
    }

    private static JsonNode only(List<String> out) throws Exception {
        assertEquals(1, out.size());
        return JSON.readTree(out.get(0));
    }

    /** Runs the handshake and returns the subscription id. */
    private int handshake() throws Exception {
        protocol.onMessage("{\"type\":\"auth_required\",\"ha_version\":\"2026.10.0\"}");
        JsonNode sub = only(protocol.onMessage("{\"type\":\"auth_ok\"}"));
        int id = sub.get("id").asInt();
        protocol.onMessage("{\"id\":" + id + ",\"type\":\"result\",\"success\":true,\"result\":null}");
        return id;
    }

    private static String event(int id, String entityId, String state, String lastUpdated) {
        return """
                {"id":%d,"type":"event","event":{"event_type":"state_changed","data":{
                  "entity_id":"%s","old_state":null,
                  "new_state":{"entity_id":"%s","state":"%s","attributes":{"current_temperature":70},
                               "last_updated":"%s"}}}}""".formatted(id, entityId, entityId, state, lastUpdated);
    }

    @Test
    @DisplayName("auth_required → sends auth with the token")
    void sendsAuth() throws Exception {
        JsonNode auth = only(protocol.onMessage("{\"type\":\"auth_required\"}"));
        assertEquals("auth", auth.get("type").asText());
        assertEquals("tok", auth.get("access_token").asText());
        assertFalse(protocol.isAuthenticated());
    }

    @Test
    @DisplayName("auth_ok → subscribes to state_changed; result success → onSubscribed")
    void subscribes() throws Exception {
        protocol.onMessage("{\"type\":\"auth_required\"}");
        JsonNode sub = only(protocol.onMessage("{\"type\":\"auth_ok\"}"));
        assertEquals("subscribe_events", sub.get("type").asText());
        assertEquals("state_changed", sub.get("event_type").asText());
        assertEquals(1, sub.get("id").asInt(), "first id on a connection is 1");
        assertTrue(protocol.isAuthenticated());

        protocol.onMessage("{\"id\":1,\"type\":\"result\",\"success\":true}");
        assertEquals(List.of("authenticated", "subscribed"), calls);
    }

    @Test
    @DisplayName("auth_invalid → onAuthFailed")
    void authInvalid() {
        protocol.onMessage("{\"type\":\"auth_invalid\",\"message\":\"Invalid access token\"}");
        assertEquals(List.of("authFailed:Invalid access token"), calls);
        assertFalse(protocol.isAuthenticated());
    }

    @Test
    @DisplayName("failed subscription result is reported")
    void subscribeFailed() throws Exception {
        protocol.onMessage("{\"type\":\"auth_ok\"}");
        protocol.onMessage("{\"id\":1,\"type\":\"result\",\"success\":false,\"error\":{\"message\":\"nope\"}}");
        assertTrue(calls.contains("authFailed:subscribe_events failed: nope"));
    }

    @Test
    @DisplayName("state_changed events are parsed and delivered")
    void deliversStateChanged() throws Exception {
        int id = handshake();
        protocol.onMessage(event(id, "climate.main", "heat", "2026-10-19T12:00:00+00:00"));
        assertEquals(1, states.size());
        assertEquals("climate.main", states.get(0).entityId());
        assertEquals(70.0, states.get(0).attributes().get("current_temperature").asDouble());
    }

    @Test
    @DisplayName("duplicate delivery (same entity + last_updated) is dropped")
    void dropsDuplicates() throws Exception {
        int id = handshake();
        String e = event(id, "climate.main", "heat", "2026-10-19T12:00:00+00:00");
        protocol.onMessage(e);
        protocol.onMessage(e);
        protocol.onMessage(event(id, "climate.main", "heat", "2026-10-19T12:05:00+00:00"));
        assertEquals(2, states.size());
    }

    @Test
    @DisplayName("events for other subscription ids, removed entities, and malformed JSON are ignored")
    void ignoresNoise() throws Exception {
        int id = handshake();
        protocol.onMessage(event(id + 99, "climate.main", "heat", "2026-10-19T12:00:00+00:00"));
        protocol.onMessage("{\"id\":" + id + ",\"type\":\"event\",\"event\":{\"event_type\":\"state_changed\",\"data\":{\"entity_id\":\"climate.main\",\"new_state\":null}}}");
        protocol.onMessage("{\"id\":" + id + ",\"type\":\"event\",\"event\":{\"event_type\":\"state_changed\",\"data\":{\"new_state\":{\"state\":\"heat\"}}}}");
        protocol.onMessage("not json at all");
        protocol.onMessage("[1,2,3]");
        assertTrue(states.isEmpty());
        assertEquals(3, protocol.getMalformedCount());
    }

    @Test
    @DisplayName("events before subscription are ignored")
    void ignoresEventsBeforeSubscribe() {
        protocol.onMessage(event(1, "climate.main", "heat", "2026-10-19T12:00:00+00:00"));
        assertTrue(states.isEmpty());
    }

    @Test
    @DisplayName("ping ids keep increasing after the subscription id")
    void pingIds() throws Exception {
        int id = handshake();
        JsonNode p1 = JSON.readTree(protocol.ping());
        JsonNode p2 = JSON.readTree(protocol.ping());
        assertEquals("ping", p1.get("type").asText());
        assertEquals(id + 1, p1.get("id").asInt());
        assertEquals(id + 2, p2.get("id").asInt());
    }
}
