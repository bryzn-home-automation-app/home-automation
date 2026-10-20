package com.homeplatform.security;

import com.homeplatform.model.User;
import com.homeplatform.repository.UserRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Each user's current status and role, as the JWT filter checks them on every
 * request. A token only proves who someone was when it was issued (24 h lifetime);
 * without this, disabling a user or demoting an admin took effect only when their
 * token expired. Cached briefly so a page load isn't a query per request;
 * {@link #evict} makes admin changes apply immediately.
 */
@Component
public class UserAccessCache {

    static final Duration TTL = Duration.ofSeconds(30);

    public record Access(User.AccountStatus status, User.Role role) {
        public boolean active() { return status == User.AccountStatus.ACTIVE; }
    }

    private record Entry(Optional<Access> access, Instant at) {}

    private final UserRepository users;
    private final Clock clock;
    private final Map<Long, Entry> cache = new ConcurrentHashMap<>();

    @Autowired
    public UserAccessCache(UserRepository users) {
        this(users, Clock.systemUTC());
    }

    UserAccessCache(UserRepository users, Clock clock) {
        this.users = users;
        this.clock = clock;
    }

    /** Current access for a user id; empty when the user no longer exists. */
    public Optional<Access> get(Long userId) {
        if (userId == null) return Optional.empty();
        Instant now = clock.instant();
        Entry e = cache.get(userId);
        if (e != null && e.at().plus(TTL).isAfter(now)) return e.access();
        Optional<Access> fresh = users.findById(userId).map(u -> new Access(u.getStatus(), u.getRole()));
        cache.put(userId, new Entry(fresh, now));
        return fresh;
    }

    /** Forget a user's cached access — call after changing their status or role. */
    public void evict(Long userId) {
        if (userId != null) cache.remove(userId);
    }
}
