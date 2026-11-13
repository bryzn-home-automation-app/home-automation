package com.homeplatform.security;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Who has the app open, for every role: when each person's last signed-in request came in.
 * {@link JwtAuthFilter} records every request it lets through. An open app sends one at least
 * once a minute (the session heartbeat in AuthContext), so a person is online while their last
 * request is within {@link #ONLINE_WINDOW}: three heartbeats, and more than the ~2 minutes a
 * browser can stretch one to in a background tab. A locked phone or a closed tab sends nothing,
 * so it reads offline once the window passes; signing out reads offline at once.
 *
 * <p>In memory, like {@link UserAccessCache}: one backend, and a map write per request costs
 * nothing (no database write per request). A restart forgets it; an open app's next request,
 * within a minute, puts its person back.
 */
@Component
public class OnlineTracker {

    /** Online while the last signed-in request is this recent. */
    public static final Duration ONLINE_WINDOW = Duration.ofMinutes(3);

    private record Seen(Instant at, boolean signedOut) {}

    private final Clock clock;
    private final Map<Long, Seen> seen = new ConcurrentHashMap<>();

    @Autowired
    public OnlineTracker() {
        this(Clock.systemUTC());
    }

    OnlineTracker(Clock clock) {
        this.clock = clock;
    }

    /** A signed-in request from this person just came in. */
    public void seen(Long userId) {
        if (userId != null) seen.put(userId, new Seen(clock.instant(), false));
    }

    /** They signed out: offline now, still showing when they were last here. */
    public void signedOut(Long userId) {
        if (userId != null) seen.computeIfPresent(userId, (id, s) -> new Seen(s.at(), true));
    }

    public boolean isOnline(Long userId) {
        Seen s = userId == null ? null : seen.get(userId);
        return s != null && !s.signedOut() && s.at().isAfter(clock.instant().minus(ONLINE_WINDOW));
    }

    /** When this person's last signed-in request came in; empty if none since the backend started. */
    public Optional<Instant> lastSeen(Long userId) {
        Seen s = userId == null ? null : seen.get(userId);
        return s == null ? Optional.empty() : Optional.of(s.at());
    }
}
