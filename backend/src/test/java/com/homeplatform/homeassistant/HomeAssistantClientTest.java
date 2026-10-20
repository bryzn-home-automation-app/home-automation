package com.homeplatform.homeassistant;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Exercises the REST client against a throwaway in-process HTTP server standing in
 * for Home Assistant — no real HA, no network beyond loopback.
 */
class HomeAssistantClientTest {

    private static final String TOKEN = "secret-test-token";

    private HttpServer server;
    private final AtomicReference<String> lastAuth = new AtomicReference<>();
    private final AtomicReference<String> lastBody = new AtomicReference<>();
    private final AtomicReference<String> lastPath = new AtomicReference<>();
    private volatile int status = 200;
    private volatile String responseBody = "[]";
    private volatile String contentType = "application/json";

    @BeforeEach
    void start() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", ex -> {
            lastAuth.set(ex.getRequestHeaders().getFirst("Authorization"));
            lastPath.set(ex.getRequestMethod() + " " + ex.getRequestURI().getPath());
            lastBody.set(new String(ex.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            byte[] out = responseBody.getBytes(StandardCharsets.UTF_8);
            ex.getResponseHeaders().add("Content-Type", contentType);
            ex.sendResponseHeaders(status, out.length == 0 ? -1 : out.length);
            if (out.length > 0) ex.getResponseBody().write(out);
            ex.close();
        });
        server.start();
    }

    @AfterEach
    void stop() {
        server.stop(0);
    }

    private HomeAssistantClient client(boolean enabled, String url, String token) {
        return new HomeAssistantClient(new HomeAssistantProperties(enabled, url, token, 2), new ObjectMapper());
    }

    private HomeAssistantClient client() {
        return client(true, "http://127.0.0.1:" + server.getAddress().getPort() + "/", TOKEN);
    }

    @Test
    @DisplayName("getStates sends the bearer token and parses entities")
    void getStatesParses() {
        responseBody = """
                [{"entity_id":"climate.main_floor","state":"heat",
                  "attributes":{"friendly_name":"Main Floor","current_temperature":70.5},
                  "last_changed":"2026-10-19T12:00:00+00:00","last_updated":"2026-10-19T12:01:00+00:00"},
                 {"state":"broken-entry-without-id"}]
                """;
        List<HaEntityState> states = client().getStates();

        assertEquals("Bearer " + TOKEN, lastAuth.get());
        assertEquals("GET /api/states", lastPath.get());
        assertEquals(1, states.size(), "malformed entry skipped, not fatal");
        HaEntityState s = states.get(0);
        assertEquals("climate.main_floor", s.entityId());
        assertEquals("climate", s.domain());
        assertEquals("Main Floor", s.friendlyName());
        assertEquals(70.5, s.attributes().get("current_temperature").asDouble());
        assertNotNull(s.lastUpdated());
    }

    @Test
    @DisplayName("getTemperatureUnit reads unit_system.temperature from /api/config")
    void temperatureUnit() {
        responseBody = "{\"unit_system\":{\"temperature\":\"°F\",\"length\":\"mi\"}}";
        assertEquals("°F", client().getTemperatureUnit());
        assertEquals("GET /api/config", lastPath.get());
        responseBody = "{}";
        assertNull(client().getTemperatureUnit());
    }

    @Test
    @DisplayName("hasService checks /api/services for domain + service")
    void hasService() {
        responseBody = """
                [{"domain":"climate","services":{"set_temperature":{},"set_hvac_mode":{}}},
                 {"domain":"ecobee","services":{"resume_program":{}}}]""";
        var c = client();
        assertTrue(c.hasService("ecobee", "resume_program"));
        assertTrue(c.hasService("climate", "set_hvac_mode"));
        assertFalse(c.hasService("ecobee", "create_vacation"));
        assertFalse(c.hasService("eufy", "anything"));
    }

    @Test
    @DisplayName("getState returns empty on 404")
    void getStateMissing() {
        status = 404;
        responseBody = "{\"message\":\"Entity not found.\"}";
        assertTrue(client().getState("climate.nope").isEmpty());
    }

    @Test
    @DisplayName("callService posts JSON to /api/services/{domain}/{service}")
    void callServicePosts() {
        responseBody = "[]";
        client().callService("climate", "set_temperature", Map.of("entity_id", "climate.x", "temperature", 70));
        assertEquals("POST /api/services/climate/set_temperature", lastPath.get());
        assertTrue(lastBody.get().contains("\"temperature\":70"));
        assertTrue(lastBody.get().contains("\"entity_id\":\"climate.x\""));
    }

    @Test
    @DisplayName("401 → Auth exception without leaking the token")
    void authError() {
        status = 401;
        responseBody = "401: Unauthorized";
        var ex = assertThrows(HomeAssistantException.Auth.class, () -> client().getStates());
        assertFalse(ex.getMessage().contains(TOKEN));
    }

    @Test
    @DisplayName("5xx → Http exception carrying the status")
    void httpError() {
        status = 500;
        responseBody = "boom";
        var ex = assertThrows(HomeAssistantException.Http.class, () -> client().getStates());
        assertEquals(500, ex.getStatus());
    }

    @Test
    @DisplayName("invalid JSON → InvalidResponse")
    void invalidJson() {
        responseBody = "<html>not json";
        assertThrows(HomeAssistantException.InvalidResponse.class, () -> client().getStates());
    }

    @Test
    @DisplayName("non-array /api/states → InvalidResponse")
    void wrongShape() {
        responseBody = "{\"message\":\"API running.\"}";
        assertThrows(HomeAssistantException.InvalidResponse.class, () -> client().getStates());
    }

    @Test
    @DisplayName("unreachable host → Unavailable")
    void unreachable() {
        int port = server.getAddress().getPort();
        server.stop(0);
        var c = client(true, "http://127.0.0.1:" + port, TOKEN);
        assertThrows(HomeAssistantException.Unavailable.class, c::getStates);
    }

    @Test
    @DisplayName("disabled or unconfigured → Unavailable without any request")
    void disabled() {
        assertThrows(HomeAssistantException.Unavailable.class, () -> client(false, "http://x", TOKEN).getStates());
        assertThrows(HomeAssistantException.Unavailable.class, () -> client(true, "", TOKEN).getStates());
        assertThrows(HomeAssistantException.Unavailable.class, () -> client(true, "http://x", "").getStates());
        assertNull(lastPath.get(), "no request reached the server");
    }

    @Test
    @DisplayName("camera snapshot returns bytes and content type")
    void cameraSnapshot() {
        contentType = "image/jpeg";
        responseBody = "JPEGDATA";
        var img = client().getCameraSnapshot("camera.front_door");
        assertEquals("GET /api/camera_proxy/camera.front_door", lastPath.get());
        assertEquals("image/jpeg", img.contentType());
        assertEquals("JPEGDATA", new String(img.bytes(), StandardCharsets.UTF_8));
    }

    @Test
    @DisplayName("rejects entity ids that could escape the API path")
    void rejectsBadEntityIds() {
        var c = client();
        assertThrows(IllegalArgumentException.class, () -> c.getState("../config"));
        assertThrows(IllegalArgumentException.class, () -> c.getCameraSnapshot("camera.x/../../api"));
        assertThrows(IllegalArgumentException.class, () -> c.callService("climate/../x", "y", Map.of()));
    }

    @Test
    @DisplayName("properties toString never includes the token")
    void propsToStringHidesToken() {
        var p = new HomeAssistantProperties(true, "http://ha:8123/", TOKEN, 5);
        assertFalse(p.toString().contains(TOKEN));
        assertEquals("http://ha:8123", p.getUrl());
        assertEquals("ws://ha:8123/api/websocket", p.webSocketUrl());
        assertEquals("wss://ha.example/api/websocket",
                new HomeAssistantProperties(true, "https://ha.example", TOKEN, 5).webSocketUrl());
    }
}
