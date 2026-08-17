package com.homeplatform.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

import java.time.Duration;

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
}
