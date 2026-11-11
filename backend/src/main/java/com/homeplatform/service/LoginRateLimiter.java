package com.homeplatform.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.util.concurrent.TimeUnit;

/**
 * Redis-backed fixed-window rate limiter for authentication entry points.
 *
 * <p>Fails OPEN: every Redis error is swallowed and treated as "not blocked" so
 * a transient Redis outage never locks users out of login. Rate limiting is a
 * hardening layer, not the primary gate.
 */
@Component
public class LoginRateLimiter {

    private static final Logger log = LoggerFactory.getLogger(LoginRateLimiter.class);

    private final StringRedisTemplate redis;
    private final int maxAttempts;
    private final Duration window;

    public LoginRateLimiter(
            StringRedisTemplate redis,
            @Value("${app.security.login.max-attempts:10}") int maxAttempts,
            @Value("${app.security.login.window-minutes:15}") int windowMinutes) {
        this.redis = redis;
        this.maxAttempts = maxAttempts;
        this.window = Duration.ofMinutes(windowMinutes);
    }

    /** True when the key has accumulated {@code maxAttempts} failures in the current window. */
    public boolean isBlocked(String key) {
        try {
            String v = redis.opsForValue().get(key);
            return v != null && Integer.parseInt(v) >= maxAttempts;
        } catch (Exception e) {
            log.warn("Rate limiter check failed (failing open): {}", e.getMessage());
            return false;
        }
    }

    /** Record a failed attempt. The window TTL is set on the first increment. */
    public void recordFailure(String key) {
        try {
            Long count = redis.opsForValue().increment(key);
            if (count != null && count == 1) {
                redis.expire(key, window);
            }
        } catch (Exception e) {
            log.warn("Rate limiter record failed (ignoring): {}", e.getMessage());
        }
    }

    /** Clear the counter (e.g. after a successful login). */
    public void clear(String key) {
        try {
            redis.delete(key);
        } catch (Exception e) {
            log.warn("Rate limiter clear failed (ignoring): {}", e.getMessage());
        }
    }

    // ── Stricter limits with their own numbers (the birthday password reset) ──

    /**
     * Seconds until {@code key} lets attempts through again: 0 when it has fewer than {@code max}
     * failures. Fails CLOSED, unlike {@link #isBlocked}: when Redis can't be asked this returns -1,
     * which callers must treat as blocked. A reset checked by a birthday has no other brake, so a
     * Redis outage pauses resets rather than lifting the limit.
     */
    public long blockedForSeconds(String key, int max) {
        try {
            String v = redis.opsForValue().get(key);
            if (v == null || Integer.parseInt(v) < max) return 0;
            Long ttl = redis.getExpire(key, TimeUnit.SECONDS);
            // No expiry (shouldn't happen): say a minute rather than "never".
            return ttl == null || ttl <= 0 ? 60 : ttl;
        } catch (Exception e) {
            log.warn("Rate limiter check failed (failing closed): {}", e.getMessage());
            return -1;
        }
    }

    /**
     * Records a failure counted in {@code window} from the first one. The failure that reaches
     * {@code max} locks the key for {@code lockout} from now (a longer pause than the window).
     *
     * @return the new count, or -1 when Redis failed
     */
    public long recordFailure(String key, Duration window, int max, Duration lockout) {
        try {
            Long count = redis.opsForValue().increment(key);
            if (count == null) return -1;
            if (count == 1) redis.expire(key, window);
            if (count == max) redis.expire(key, lockout);
            return count;
        } catch (Exception e) {
            log.warn("Rate limiter record failed: {}", e.getMessage());
            return -1;
        }
    }

    /**
     * True the first time per {@code ttl} for {@code key}: lets a caller write one log line per
     * minute for a flood of refused requests instead of one each. True when Redis can't be asked.
     */
    public boolean firstIn(String key, Duration ttl) {
        try {
            return Boolean.TRUE.equals(redis.opsForValue().setIfAbsent(key, "1", ttl));
        } catch (Exception e) {
            return true;
        }
    }
}
