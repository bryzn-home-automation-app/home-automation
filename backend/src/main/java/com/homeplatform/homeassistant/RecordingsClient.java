package com.homeplatform.homeassistant;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;

/**
 * HTTP client for the eufy-recordings service (the HomeBase 3's stored recordings; see
 * eufy-recordings/src/server.mjs). Internal network only — callers check access.
 */
@Component
public class RecordingsClient {

    /** A recording as eufy-recordings describes it; {@code sn} is the camera's serial. */
    public record Recording(String id, String sn, String start, String end, Long durationMs, long bytes, boolean hasThumb) {}

    /** eufy-recordings is down, or the HomeBase didn't answer. */
    public static class Unavailable extends RuntimeException {
        public Unavailable(String message) { super(message); }
    }

    /** The recording doesn't exist (any more). */
    public static class Missing extends RuntimeException {
        public Missing() { super("Recording not found"); }
    }

    private static final Duration LIST_TIMEOUT = Duration.ofSeconds(45);
    /** A long clip comes off the HomeBase at ~1 MB/s, then gets muxed. */
    private static final Duration VIDEO_TIMEOUT = Duration.ofMinutes(3);
    private static final long MAX_VIDEO_BYTES = 300L * 1024 * 1024;

    private final String baseUrl;
    private final ObjectMapper mapper;
    private final HttpClient http;

    @Autowired
    public RecordingsClient(@Value("${app.camera-recordings.url:http://eufy-recordings:3000}") String baseUrl, ObjectMapper mapper) {
        this(baseUrl, mapper, HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).build());
    }

    RecordingsClient(String baseUrl, ObjectMapper mapper, HttpClient http) {
        this.baseUrl = baseUrl == null ? "" : baseUrl.replaceAll("/+$", "");
        this.mapper = mapper;
        this.http = http;
    }

    public boolean isConfigured() {
        return !baseUrl.isBlank();
    }

    public List<Recording> list(int days) {
        JsonNode body = json(get("/recordings?days=" + days, LIST_TIMEOUT));
        List<Recording> out = new ArrayList<>();
        for (JsonNode r : body.path("recordings")) out.add(recording(r));
        return out;
    }

    public Recording recording(String id) {
        return recording(json(get("/recordings/" + id, LIST_TIMEOUT)));
    }

    public byte[] thumbnail(String id) {
        return get("/recordings/" + id + "/thumb.jpg", LIST_TIMEOUT);
    }

    public byte[] video(String id) {
        byte[] b = get("/recordings/" + id + "/video.mp4", VIDEO_TIMEOUT);
        if (b.length > MAX_VIDEO_BYTES) throw new Unavailable("Recording is too large");
        return b;
    }

    private static Recording recording(JsonNode r) {
        return new Recording(r.path("id").asText(), r.path("sn").asText(), r.path("start").asText(null),
                r.path("end").isNull() ? null : r.path("end").asText(null),
                r.path("durationMs").isNumber() ? r.path("durationMs").asLong() : null,
                r.path("bytes").asLong(), r.path("hasThumb").asBoolean());
    }

    private JsonNode json(byte[] body) {
        try {
            return mapper.readTree(body);
        } catch (IOException e) {
            throw new Unavailable("Recordings service sent an unreadable answer");
        }
    }

    private byte[] get(String path, Duration timeout) {
        if (!isConfigured()) throw new Unavailable("Recordings aren't set up");
        HttpRequest req = HttpRequest.newBuilder(URI.create(baseUrl + path)).timeout(timeout).GET().build();
        HttpResponse<byte[]> res;
        try {
            res = http.send(req, HttpResponse.BodyHandlers.ofByteArray());
        } catch (IOException e) {
            throw new Unavailable("Recordings service is unreachable");
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new Unavailable("Interrupted");
        }
        if (res.statusCode() == 404) throw new Missing();
        if (res.statusCode() != 200) throw new Unavailable(message(res.body(), res.statusCode()));
        return res.body();
    }

    /** eufy-recordings' own error text — its messages are ours, not the HomeBase's. */
    private String message(byte[] body, int status) {
        try {
            String m = mapper.readTree(body).path("error").asText("");
            if (!m.isBlank()) return m;
        } catch (IOException ignored) {
            // fall through
        }
        return "Recordings service answered " + status;
    }
}
