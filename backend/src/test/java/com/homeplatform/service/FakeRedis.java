package com.homeplatform.service;

import org.springframework.data.redis.RedisConnectionFailureException;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;
import org.springframework.data.redis.core.script.RedisScript;

import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * The few Redis calls LoginRateLimiter makes, over a map, so the limiter's real logic runs in unit
 * tests. Safe to call from many threads at once: every call holds one lock, as Redis runs one
 * command (or script) at a time. Expiry doesn't tick by itself: {@link #ttl} shows what was set and
 * {@link #pass} lets a key lapse, as time would.
 */
public final class FakeRedis {

    public final Map<String, String> values = new ConcurrentHashMap<>();
    public final Map<String, Duration> ttls = new ConcurrentHashMap<>();
    /** When true every call fails, as with Redis unreachable. */
    public volatile boolean down;

    public final StringRedisTemplate template = mock(StringRedisTemplate.class);
    @SuppressWarnings("unchecked")
    private final ValueOperations<String, String> ops = mock(ValueOperations.class);
    private final Object lock = new Object();

    @SuppressWarnings("unchecked")
    public FakeRedis() {
        when(template.opsForValue()).thenReturn(ops);
        when(ops.get(anyString())).thenAnswer(i -> {
            synchronized (lock) {
                check();
                return values.get(i.<String>getArgument(0));
            }
        });
        when(ops.increment(anyString())).thenAnswer(i -> {
            synchronized (lock) {
                check();
                return incr(i.getArgument(0));
            }
        });
        when(ops.setIfAbsent(anyString(), anyString(), any(Duration.class))).thenAnswer(i -> {
            synchronized (lock) {
                check();
                String k = i.getArgument(0);
                if (values.containsKey(k)) return false;
                values.put(k, i.getArgument(1));
                ttls.put(k, i.getArgument(2));
                return true;
            }
        });
        when(template.expire(anyString(), any(Duration.class))).thenAnswer(i -> {
            synchronized (lock) {
                check();
                ttls.put(i.getArgument(0), i.getArgument(1));
                return true;
            }
        });
        when(template.getExpire(anyString(), any(TimeUnit.class))).thenAnswer(i -> {
            synchronized (lock) {
                check();
                Duration d = ttls.get(i.<String>getArgument(0));
                return d == null ? -1L : i.<TimeUnit>getArgument(1).convert(d);
            }
        });
        when(template.delete(anyString())).thenAnswer(i -> {
            synchronized (lock) {
                check();
                ttls.remove(i.<String>getArgument(0));
                return values.remove(i.<String>getArgument(0)) != null;
            }
        });
        // LoginRateLimiter.COUNT_ATTEMPT, step for step: the script runs atomically in Redis.
        when(template.execute(any(RedisScript.class), anyList(), any(), any(), any())).thenAnswer(i -> {
            synchronized (lock) {
                check();
                if (i.getArgument(0) != LoginRateLimiter.COUNT_ATTEMPT) throw new IllegalArgumentException("unknown script");
                Object[] args = i.getArguments();
                Object[] argv = args.length == 3 && args[2] instanceof Object[] a ? a : new Object[]{args[2], args[3], args[4]};
                String k = ((List<String>) args[1]).get(0);
                long n = incr(k);
                Duration window = Duration.ofMillis(Long.parseLong((String) argv[0]));
                long max = Long.parseLong((String) argv[1]);
                Duration lockout = Duration.ofMillis(Long.parseLong((String) argv[2]));
                if (n == 1) ttls.put(k, window);
                if (n == max) ttls.put(k, lockout);
                ttls.putIfAbsent(k, lockout);
                return n;
            }
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
        synchronized (lock) {
            values.remove(key);
            ttls.remove(key);
        }
    }

    private long incr(String k) {
        long n = Long.parseLong(values.getOrDefault(k, "0")) + 1;
        values.put(k, String.valueOf(n));
        return n;
    }

    private void check() {
        if (down) throw new RedisConnectionFailureException("Redis is down");
    }
}
