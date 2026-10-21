package com.homeplatform.homeassistant;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.Optional;
import java.util.UUID;

/**
 * Short-lived, signed live-view tickets. The browser can't put a JWT on a WebSocket
 * handshake, so a member asks the API for a ticket and opens
 * {@code /camera-stream/<ticket>/ws}; nginx checks it with the backend
 * ({@code auth_request}) before proxying to go2rtc. A ticket names one camera and
 * only gates opening the stream — closing the page ends it.
 *
 * <p>The HMAC key is random per process: tickets are only valid for {@link #TTL}, so a
 * restart just means the page asks for a new one.
 */
@Component
public class CameraStreamTickets {

    static final Duration TTL = Duration.ofSeconds(60);
    /**
     * HLS (the iPhone path) authorizes every playlist/segment request with the same
     * ticket for as long as someone watches, so it has to outlive a viewing session.
     */
    static final Duration HLS_TTL = Duration.ofMinutes(15);
    private static final Base64.Encoder B64 = Base64.getUrlEncoder().withoutPadding();
    private static final Base64.Decoder B64D = Base64.getUrlDecoder();

    private final byte[] key = new byte[32];
    private final Clock clock;

    @Autowired
    public CameraStreamTickets() {
        this(Clock.systemUTC());
    }

    CameraStreamTickets(Clock clock) {
        this.clock = clock;
        new SecureRandom().nextBytes(key);
    }

    public record Ticket(String value, Instant expiresAt) {}

    public Ticket issue(UUID deviceId) {
        return issue(deviceId, TTL);
    }

    public Ticket issue(UUID deviceId, Duration ttl) {
        Instant exp = clock.instant().plus(ttl);
        String payload = deviceId + "|" + exp.getEpochSecond();
        String body = B64.encodeToString(payload.getBytes(StandardCharsets.UTF_8));
        return new Ticket(body + "." + B64.encodeToString(sign(body)), exp);
    }

    /** The camera a valid, unexpired ticket is for; empty for anything else. */
    public Optional<UUID> verify(String ticket) {
        if (ticket == null) return Optional.empty();
        int dot = ticket.indexOf('.');
        if (dot <= 0 || dot != ticket.lastIndexOf('.')) return Optional.empty();
        String body = ticket.substring(0, dot);
        try {
            byte[] sig = B64D.decode(ticket.substring(dot + 1));
            if (!MessageDigest.isEqual(sig, sign(body))) return Optional.empty();
            String[] parts = new String(B64D.decode(body), StandardCharsets.UTF_8).split("\\|", -1);
            if (parts.length != 2) return Optional.empty();
            if (clock.instant().getEpochSecond() > Long.parseLong(parts[1])) return Optional.empty();
            return Optional.of(UUID.fromString(parts[0]));
        } catch (IllegalArgumentException e) { // bad base64, number or UUID
            return Optional.empty();
        }
    }

    private byte[] sign(String body) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(key, "HmacSHA256"));
            return mac.doFinal(body.getBytes(StandardCharsets.US_ASCII));
        } catch (GeneralSecurityException e) {
            throw new IllegalStateException("HmacSHA256 unavailable", e);
        }
    }
}
