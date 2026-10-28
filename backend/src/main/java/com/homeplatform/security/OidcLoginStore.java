package com.homeplatform.security;

import org.springframework.stereotype.Component;

import java.security.SecureRandom;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Short-lived, single-use state for home-SSO sign-in, held in memory (one backend instance; a
 * restart mid-sign-in just means trying again).
 *
 * <ul>
 *   <li><b>Transaction</b> (10 min): state, nonce and PKCE verifier between /start and /callback,
 *   keyed by a random id kept in an HttpOnly cookie, so a callback only completes in the browser
 *   that started it.</li>
 *   <li><b>Handoff</b> (60 s): /callback puts a one-time code in an HttpOnly cookie and the SPA
 *   swaps it for the app's JWT with a POST, so neither the JWT nor the code appears in a URL, and a
 *   forwarded link can't sign someone else in.</li>
 * </ul>
 * Each map is capped, so a flood of /start requests (a public endpoint) can't grow it without bound.
 */
@Component
public class OidcLoginStore {

    public static final Duration TX_TTL = Duration.ofMinutes(10);
    public static final Duration HANDOFF_TTL = Duration.ofSeconds(60);
    static final int MAX_ENTRIES = 500;

    public record Transaction(String state, String nonce, String codeVerifier) {}

    private record Entry<T>(T value, Instant expiresAt) {}

    private final Map<String, Entry<Transaction>> transactions = new ConcurrentHashMap<>();
    private final Map<String, Entry<String>> handoffs = new ConcurrentHashMap<>();
    private final SecureRandom random = new SecureRandom();
    private final Clock clock;

    public OidcLoginStore() {
        this(Clock.systemUTC());
    }

    OidcLoginStore(Clock clock) {
        this.clock = clock;
    }

    /** Stores a transaction and returns its id (the cookie value). Throws when the store is full. */
    public String putTransaction(Transaction tx) {
        return put(transactions, tx, TX_TTL);
    }

    /** Removes and returns the transaction, or null if unknown or expired. */
    public Transaction takeTransaction(String id) {
        return take(transactions, id);
    }

    /** Stores the verified email and returns the one-time handoff code (the cookie value). */
    public String putHandoff(String email) {
        return put(handoffs, email, HANDOFF_TTL);
    }

    /** Removes and returns the email for a handoff code, or null if unknown, used or expired. */
    public String takeHandoff(String code) {
        return take(handoffs, code);
    }

    private <T> String put(Map<String, Entry<T>> map, T value, Duration ttl) {
        Instant now = clock.instant();
        map.values().removeIf(e -> e.expiresAt().isBefore(now));
        if (map.size() >= MAX_ENTRIES) {
            throw new IllegalStateException("too many sign-ins in progress");
        }
        String id = randomId();
        map.put(id, new Entry<>(value, now.plus(ttl)));
        return id;
    }

    private <T> T take(Map<String, Entry<T>> map, String id) {
        if (id == null || id.isBlank()) return null;
        Entry<T> e = map.remove(id);
        if (e == null || e.expiresAt().isBefore(clock.instant())) return null;
        return e.value();
    }

    private String randomId() {
        byte[] b = new byte[32];
        random.nextBytes(b);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(b);
    }
}
