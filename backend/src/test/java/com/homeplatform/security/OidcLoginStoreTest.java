package com.homeplatform.security;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.jupiter.api.Assertions.*;

/** Sign-in state is single-use and short-lived. */
class OidcLoginStoreTest {

    private final AtomicReference<Instant> now = new AtomicReference<>(Instant.parse("2026-10-28T18:00:00Z"));
    private final OidcLoginStore store = new OidcLoginStore(new Clock() {
        @Override public ZoneOffset getZone() { return ZoneOffset.UTC; }
        @Override public Clock withZone(java.time.ZoneId zone) { return this; }
        @Override public Instant instant() { return now.get(); }
    });

    @Test
    @DisplayName("a transaction can be taken once")
    void transactionSingleUse() {
        var tx = new OidcLoginStore.Transaction("s", "n", "v");
        String id = store.putTransaction(tx);
        assertEquals(tx, store.takeTransaction(id));
        assertNull(store.takeTransaction(id));
    }

    @Test
    @DisplayName("a transaction expires after 10 minutes")
    void transactionExpires() {
        String id = store.putTransaction(new OidcLoginStore.Transaction("s", "n", "v"));
        now.set(now.get().plus(OidcLoginStore.TX_TTL).plus(Duration.ofSeconds(1)));
        assertNull(store.takeTransaction(id));
    }

    @Test
    @DisplayName("a handoff code works once, and not after 60 seconds")
    void handoff() {
        String code = store.putHandoff("kim@example.com");
        assertEquals("kim@example.com", store.takeHandoff(code));
        assertNull(store.takeHandoff(code));

        String late = store.putHandoff("kim@example.com");
        now.set(now.get().plus(OidcLoginStore.HANDOFF_TTL).plus(Duration.ofSeconds(1)));
        assertNull(store.takeHandoff(late));
    }

    @Test
    @DisplayName("unknown or missing ids return nothing")
    void unknownIds() {
        assertNull(store.takeTransaction(null));
        assertNull(store.takeTransaction(""));
        assertNull(store.takeHandoff("nope"));
    }

    @Test
    @DisplayName("ids are unguessable and distinct")
    void idsAreRandom() {
        String a = store.putHandoff("a@x"), b = store.putHandoff("a@x");
        assertNotEquals(a, b);
        assertTrue(a.length() >= 43, "32 random bytes, base64url");
    }

    @Test
    @DisplayName("refuses new entries when full, until old ones expire")
    void capped() {
        for (int i = 0; i < OidcLoginStore.MAX_ENTRIES; i++) {
            store.putTransaction(new OidcLoginStore.Transaction("s", "n", "v"));
        }
        assertThrows(IllegalStateException.class,
                () -> store.putTransaction(new OidcLoginStore.Transaction("s", "n", "v")));
        now.set(now.get().plus(OidcLoginStore.TX_TTL).plus(Duration.ofSeconds(1)));
        assertNotNull(store.putTransaction(new OidcLoginStore.Transaction("s", "n", "v")));
    }
}
