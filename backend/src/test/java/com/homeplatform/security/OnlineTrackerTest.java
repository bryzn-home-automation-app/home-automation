package com.homeplatform.security;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.time.*;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;

/** Online = a signed-in request within the last 3 minutes; an open app sends one every minute. */
class OnlineTrackerTest {

    private static final Instant T0 = Instant.parse("2026-11-13T18:00:00Z");

    /** A clock the test can move forward. */
    static final class MutableClock extends Clock {
        Instant now;
        MutableClock(Instant now) { this.now = now; }
        @Override public ZoneId getZone() { return ZoneOffset.UTC; }
        @Override public Clock withZone(ZoneId zone) { return this; }
        @Override public Instant instant() { return now; }
    }

    private final MutableClock clock = new MutableClock(T0);
    private final OnlineTracker online = new OnlineTracker(clock);

    @Test
    @DisplayName("no request since the backend started: offline, and no last-active time")
    void neverSeen() {
        assertFalse(online.isOnline(1L));
        assertEquals(Optional.empty(), online.lastSeen(1L));
        assertFalse(online.isOnline(null));
    }

    @Test
    @DisplayName("an open app's minute heartbeat keeps its person online; one stretched to 2 minutes in a background tab too")
    void staysOnlineBetweenHeartbeats() {
        online.seen(1L);
        for (int beat = 0; beat < 5; beat++) {
            clock.now = clock.now.plus(Duration.ofSeconds(60));
            assertTrue(online.isOnline(1L), "beat " + beat);
            online.seen(1L);
        }
        clock.now = clock.now.plus(Duration.ofSeconds(125));
        assertTrue(online.isOnline(1L), "a throttled background-tab beat doesn't flicker offline");
    }

    @Test
    @DisplayName("offline once 3 minutes pass with no request (phone locked, tab closed), still showing when")
    void goesOfflineAfterTheWindow() {
        online.seen(1L);
        clock.now = T0.plus(OnlineTracker.ONLINE_WINDOW).minusSeconds(1);
        assertTrue(online.isOnline(1L));
        clock.now = T0.plus(OnlineTracker.ONLINE_WINDOW);
        assertFalse(online.isOnline(1L));
        assertEquals(Optional.of(T0), online.lastSeen(1L));
    }

    @Test
    @DisplayName("signing out is offline at once, keeps the last-active time, and the next request is online again")
    void signOut() {
        online.seen(1L);
        online.seen(2L);
        online.signedOut(1L);
        assertFalse(online.isOnline(1L));
        assertTrue(online.isOnline(2L), "only that person");
        assertEquals(Optional.of(T0), online.lastSeen(1L));

        clock.now = T0.plusSeconds(30);
        online.seen(1L); // signed back in, or another device still open
        assertTrue(online.isOnline(1L));

        online.signedOut(3L); // never seen: nothing to do
        assertEquals(Optional.empty(), online.lastSeen(3L));
    }
}
