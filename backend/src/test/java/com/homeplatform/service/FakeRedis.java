package com.homeplatform.service;

import org.springframework.data.redis.RedisConnectionFailureException;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;

import java.time.Duration;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.TimeUnit;

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * The few Redis calls LoginRateLimiter makes, over a map, so the limiter's real logic runs in unit
 * tests. Expiry doesn't tick by itself: {@link #ttl} shows what was set and {@link #pass} lets a key
 * lapse, as time would.
 */
public final class FakeRedis {

    public final Map<String, String> values = new HashMap<>();
    public final Map<String, Duration> ttls = new HashMap<>();
    /** When true every call fails, as with Redis unreachable. */
    public boolean down;

    public final StringRedisTemplate template = mock(StringRedisTemplate.class);
    @SuppressWarnings("unchecked")
    private final ValueOperations<String, String> ops = mock(ValueOperations.class);

    public FakeRedis() {
        when(template.opsForValue()).thenReturn(ops);
        when(ops.get(anyString())).thenAnswer(i -> {
            check();
            return values.get(i.<String>getArgument(0));
        });
        when(ops.increment(anyString())).thenAnswer(i -> {
            check();
            String k = i.getArgument(0);
            long n = Long.parseLong(values.getOrDefault(k, "0")) + 1;
            values.put(k, String.valueOf(n));
            return n;
        });
        when(ops.setIfAbsent(anyString(), anyString(), any(Duration.class))).thenAnswer(i -> {
            check();
            String k = i.getArgument(0);
            if (values.containsKey(k)) return false;
            values.put(k, i.getArgument(1));
            ttls.put(k, i.getArgument(2));
            return true;
        });
        when(template.expire(anyString(), any(Duration.class))).thenAnswer(i -> {
            check();
            ttls.put(i.getArgument(0), i.getArgument(1));
            return true;
        });
        when(template.getExpire(anyString(), any(TimeUnit.class))).thenAnswer(i -> {
            check();
            Duration d = ttls.get(i.<String>getArgument(0));
            return d == null ? -1L : i.<TimeUnit>getArgument(1).convert(d);
        });
        when(template.delete(anyString())).thenAnswer(i -> {
            check();
            ttls.remove(i.<String>getArgument(0));
            return values.remove(i.<String>getArgument(0)) != null;
        });
    }

    public LoginRateLimiter limiter() {
        return new LoginRateLimiter(template, 10, 15);
    }

    public Duration ttl(String key) {
        return ttls.get(key);
    }

    /** The key's time is up. */
    public void pass(String key) {
        values.remove(key);
        ttls.remove(key);
    }

    private void check() {
        if (down) throw new RedisConnectionFailureException("Redis is down");
    }
}
