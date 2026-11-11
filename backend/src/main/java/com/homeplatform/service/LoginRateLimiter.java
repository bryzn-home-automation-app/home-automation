package com.homeplatform.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.util.List;
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

    // ── Count first, then check (the birthday password reset) ──

    /**
     * One step in Redis, so nothing runs between the count and its expiry: INCR; the window starts
     * at the first count; the max-th count replaces it with the lockout. Later counts leave the
     * expiry alone, so piling on a paused key never makes the pause longer. A key that somehow has
     * no expiry gets the lockout rather than staying forever.
     */
    static final DefaultRedisScript<Long> COUNT_ATTEMPT = new DefaultRedisScript<>("""
            local n = redis.call('INCR', KEYS[1])
            if n == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
            if n == tonumber(ARGV[2]) then redis.call('PEXPIRE', KEYS[1], ARGV[3]) end
            if redis.call('PTTL', KEYS[1]) < 0 then redis.call('PEXPIRE', KEYS[1], ARGV[3]) end
            return n
            """, Long.class);

    /**
     * Counts an attempt BEFORE it's checked. Callers let the attempt through only while the count
     * is at most {@code max}; because the increment is atomic, however many requests arrive at
     * once, at most {@code max} per window get through. Counts start a {@code window}; the
     * {@code max}-th sets a {@code lockout} from then.
     *
     * <p>Fails CLOSED, unlike {@link #isBlocked}: -1 when Redis can't be asked, which callers must
     * treat as unavailable. A reset checked by a birthday has no other brake.
     *
     * @return this attempt's count in the window (1 for the first), or -1 when Redis failed
     */
    public long countAttempt(String key, Duration window, int max, Duration lockout) {
        try {
            Long count = redis.execute(COUNT_ATTEMPT, List.of(key),
                    String.valueOf(window.toMillis()), String.valueOf(max), String.valueOf(lockout.toMillis()));
            return count == null ? -1 : count;
        } catch (Exception e) {
            log.warn("Rate limiter count failed (failing closed): {}", e.getMessage());
            return -1;
        }
    }

    /** Seconds until {@code key} expires; a minute when that can't be told. */
    public long secondsLeft(String key) {
        try {
            Long ttl = redis.getExpire(key, TimeUnit.SECONDS);
            return ttl == null || ttl <= 0 ? 60 : ttl;
        } catch (Exception e) {
            return 60;
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
