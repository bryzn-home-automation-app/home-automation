package com.homeplatform.homeassistant;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;

class CameraStreamTicketsTest {

    private static final UUID CAMERA = UUID.randomUUID();
    private static final Instant T0 = Instant.parse("2026-10-20T12:00:00Z");

    @Test
    @DisplayName("a fresh ticket verifies to its camera and looks nginx-safe")
    void roundTrip() {
        var tickets = new CameraStreamTickets(Clock.fixed(T0, ZoneOffset.UTC));
        var t = tickets.issue(CAMERA);
        assertTrue(t.value().matches("^[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+$"));
        assertEquals(T0.plus(CameraStreamTickets.TTL), t.expiresAt());
        assertEquals(Optional.of(CAMERA), tickets.verify(t.value()));
    }

    @Test
    @DisplayName("expired, tampered, foreign and malformed tickets are rejected")
    void rejects() {
        var issuedAt = new CameraStreamTickets(Clock.fixed(T0, ZoneOffset.UTC));
        String good = issuedAt.issue(CAMERA).value();

        // Another instance has its own random key, like a restarted backend.
        assertTrue(new CameraStreamTickets(Clock.fixed(T0, ZoneOffset.UTC)).verify(good).isEmpty(), "other process key");

        String body = good.substring(0, good.indexOf('.'));
        String sig = good.substring(good.indexOf('.') + 1);
        String flipped = (sig.charAt(0) == 'A' ? "B" : "A") + sig.substring(1);
        assertTrue(issuedAt.verify(body + "." + flipped).isEmpty(), "bad signature");
        assertTrue(issuedAt.verify(body).isEmpty());
        assertTrue(issuedAt.verify(good + ".x").isEmpty());
        assertTrue(issuedAt.verify("!!!.???").isEmpty());
        assertTrue(issuedAt.verify(null).isEmpty());
    }

    @Test
    @DisplayName("a ticket stops working after the TTL")
    void expires() {
        var clock = new MutableClock(T0);
        var tickets = new CameraStreamTickets(clock);
        String t = tickets.issue(CAMERA).value();
        clock.now = T0.plus(CameraStreamTickets.TTL);
        assertTrue(tickets.verify(t).isPresent(), "valid through the last second");
        clock.now = T0.plus(CameraStreamTickets.TTL).plusSeconds(1);
        assertTrue(tickets.verify(t).isEmpty());
    }

    private static final class MutableClock extends Clock {
        Instant now;
        MutableClock(Instant now) { this.now = now; }
        @Override public ZoneOffset getZone() { return ZoneOffset.UTC; }
        @Override public Clock withZone(java.time.ZoneId zone) { return this; }
        @Override public Instant instant() { return now; }
    }
}
