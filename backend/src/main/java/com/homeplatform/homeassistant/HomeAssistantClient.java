package com.homeplatform.homeassistant;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.net.ConnectException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.HttpTimeoutException;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.regex.Pattern;

/**
 * Thin REST client for the Home Assistant API. Owns the bearer token — nothing
 * returned from here (or any exception message) contains it.
 *
 * <p>Every call fails fast with {@link HomeAssistantException.Unavailable} when the
 * integration is inactive, so callers never hit the network unconfigured.
 */
@Component
public class HomeAssistantClient {

    /** HA entity IDs are {@code domain.object_id}, lowercase/digits/underscore. */
    private static final Pattern ENTITY_ID = Pattern.compile("^[a-z0-9_]+\\.[a-z0-9_]+$");
    private static final Pattern SERVICE_PART = Pattern.compile("^[a-z0-9_]+$");

    private final HomeAssistantProperties props;
    private final ObjectMapper mapper;
    private final HttpClient http;

    @Autowired
    public HomeAssistantClient(HomeAssistantProperties props, ObjectMapper mapper) {
        this(props, mapper, HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(props.getRequestTimeoutSeconds()))
                .build());
    }

    HomeAssistantClient(HomeAssistantProperties props, ObjectMapper mapper, HttpClient http) {
        this.props = props;
        this.mapper = mapper;
        this.http = http;
    }

    public boolean isActive() {
        return props.isActive();
    }

    /** All entity states. */
    public List<HaEntityState> getStates() {
        JsonNode body = parseJson(send(get("/api/states")));
        if (!body.isArray()) {
            throw new HomeAssistantException.InvalidResponse("Expected a JSON array from /api/states");
        }
        List<HaEntityState> out = new ArrayList<>(body.size());
        for (JsonNode n : body) {
            try {
                out.add(HaEntityState.fromJson(n));
            } catch (HomeAssistantException.InvalidResponse ignored) {
                // Skip a malformed entry rather than failing the whole listing.
            }
        }
        return out;
    }

    /** HA's configured temperature unit ({@code unit_system.temperature}, e.g. "°F"), or null. */
    public String getTemperatureUnit() {
        JsonNode t = parseJson(send(get("/api/config"))).path("unit_system").path("temperature");
        return t.isTextual() && !t.asText().isBlank() ? t.asText() : null;
    }

    /** One entity's state, or empty if HA doesn't know the entity (404). */
    public Optional<HaEntityState> getState(String entityId) {
        requireEntityId(entityId);
        HttpResponse<byte[]> resp = sendAllowing404(get("/api/states/" + entityId));
        if (resp.statusCode() == 404) return Optional.empty();
        return Optional.of(HaEntityState.fromJson(parseJson(resp)));
    }

    /** {@code POST /api/services/{domain}/{service}} with a JSON body. */
    public void callService(String domain, String service, Map<String, ?> data) {
        if (domain == null || !SERVICE_PART.matcher(domain).matches()
                || service == null || !SERVICE_PART.matcher(service).matches()) {
            throw new IllegalArgumentException("Invalid HA service name");
        }
        byte[] json;
        try {
            json = mapper.writeValueAsBytes(data == null ? Map.of() : data);
        } catch (JsonProcessingException e) {
            throw new IllegalArgumentException("Unserializable service data", e);
        }
        send(request("/api/services/" + domain + "/" + service)
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofByteArray(json))
                .build());
    }

    /** Current still image from a camera entity via HA's camera proxy. */
    public CameraImage getCameraSnapshot(String entityId) {
        requireEntityId(entityId);
        HttpResponse<byte[]> resp = send(get("/api/camera_proxy/" + entityId));
        String type = resp.headers().firstValue("Content-Type").orElse("image/jpeg");
        if (resp.body() == null || resp.body().length == 0) {
            throw new HomeAssistantException.InvalidResponse("Camera returned an empty image");
        }
        return new CameraImage(resp.body(), type);
    }

    public record CameraImage(byte[] bytes, String contentType) {}

    // ── internals ──

    private HttpRequest get(String path) {
        return request(path).GET().build();
    }

    private HttpRequest.Builder request(String path) {
        if (!props.isActive()) {
            throw new HomeAssistantException.Unavailable("Home Assistant integration is disabled: " + props.inactiveReason());
        }
        return HttpRequest.newBuilder(URI.create(props.getUrl() + path))
                .timeout(Duration.ofSeconds(props.getRequestTimeoutSeconds()))
                .header("Authorization", "Bearer " + props.getToken())
                .header("Accept", "application/json");
    }

    private HttpResponse<byte[]> send(HttpRequest req) {
        HttpResponse<byte[]> resp = sendAllowing404(req);
        if (resp.statusCode() == 404) {
            throw new HomeAssistantException.Http(404, "Home Assistant returned 404 for " + req.uri().getPath());
        }
        return resp;
    }

    private HttpResponse<byte[]> sendAllowing404(HttpRequest req) {
        HttpResponse<byte[]> resp;
        try {
            resp = http.send(req, HttpResponse.BodyHandlers.ofByteArray());
        } catch (HttpTimeoutException e) {
            throw new HomeAssistantException.Unavailable("Home Assistant timed out", e);
        } catch (ConnectException e) {
            throw new HomeAssistantException.Unavailable("Home Assistant is unreachable", e);
        } catch (IOException e) {
            throw new HomeAssistantException.Unavailable("Home Assistant I/O error: " + e.getClass().getSimpleName(), e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new HomeAssistantException.Unavailable("Interrupted calling Home Assistant", e);
        }
        int status = resp.statusCode();
        if (status == 401 || status == 403) {
            throw new HomeAssistantException.Auth("Home Assistant rejected the access token (" + status + ")");
        }
        if (status != 404 && (status < 200 || status >= 300)) {
            throw new HomeAssistantException.Http(status, "Home Assistant returned HTTP " + status
                    + " for " + req.method() + " " + req.uri().getPath());
        }
        return resp;
    }

    private JsonNode parseJson(HttpResponse<byte[]> resp) {
        try {
            JsonNode n = mapper.readTree(resp.body());
            if (n == null || n.isMissingNode()) {
                throw new HomeAssistantException.InvalidResponse("Empty response from Home Assistant");
            }
            return n;
        } catch (IOException e) {
            throw new HomeAssistantException.InvalidResponse("Home Assistant returned invalid JSON", e);
        }
    }

    static void requireEntityId(String entityId) {
        if (entityId == null || !ENTITY_ID.matcher(entityId).matches()) {
            throw new IllegalArgumentException("Invalid HA entity id");
        }
    }
}
