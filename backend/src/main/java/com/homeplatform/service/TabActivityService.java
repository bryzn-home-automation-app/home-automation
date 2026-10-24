package com.homeplatform.service;

import com.homeplatform.dto.TabUsageResponse;
import com.homeplatform.model.TabActivity;
import com.homeplatform.model.User;
import com.homeplatform.repository.TabActivityRepository;
import com.homeplatform.repository.UserRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Function;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

/** Which tabs house members open and spend time on (see {@link TabActivity}). */
@Service
public class TabActivityService {

    static final int DEFAULT_DAYS = 30;
    static final int MAX_DAYS = 365;
    /** "home", "cameras", "admin/debug": a path's first one or two segments. */
    private static final Pattern TAB = Pattern.compile("[a-z][a-z0-9-]{0,24}(/[a-z][a-z0-9-]{0,12})?");

    private final TabActivityRepository repo;
    private final UserRepository users;
    private final Clock clock;

    @Autowired
    public TabActivityService(TabActivityRepository repo, UserRepository users) {
        this(repo, users, Clock.systemUTC());
    }

    TabActivityService(TabActivityRepository repo, UserRepository users, Clock clock) {
        this.repo = repo;
        this.users = users;
        this.clock = clock;
    }

    public void record(Long userId, String tab, TabActivity.Kind kind) {
        if (userId == null) throw new SecurityException("Access denied");
        if (tab == null || !TAB.matcher(tab).matches()) throw new IllegalArgumentException("Unknown tab");
        repo.save(TabActivity.builder().userId(userId).tab(tab).kind(kind).at(LocalDateTime.now(clock)).build());
    }

    public TabUsageResponse usage(Integer days) {
        int d = days == null ? DEFAULT_DAYS : Math.max(1, Math.min(MAX_DAYS, days));
        List<TabActivityRepository.Tally> rows = repo.tally(LocalDateTime.now(clock).minusDays(d));
        // Guests aren't recorded, but a member demoted to guest keeps their history: leave it out.
        Map<Long, User> members = users.findAllById(rows.stream().map(TabActivityRepository.Tally::getUserId).distinct().toList())
                .stream()
                .filter(u -> u.getRole() != User.Role.GUEST)
                .collect(Collectors.toMap(User::getId, Function.identity()));
        List<TabActivityRepository.Tally> kept = rows.stream().filter(r -> members.containsKey(r.getUserId())).toList();

        List<TabUsageResponse.Member> out = new ArrayList<>();
        kept.stream().collect(Collectors.groupingBy(TabActivityRepository.Tally::getUserId)).forEach((userId, tallies) -> {
            User u = members.get(userId);
            List<TabUsageResponse.TabTotal> tabs = totals(tallies);
            Instant last = tallies.stream().map(TabActivityRepository.Tally::getLast).max(Comparator.naturalOrder())
                    .map(t -> t.toInstant(ZoneOffset.UTC)).orElse(null);
            out.add(new TabUsageResponse.Member(userId, u.getUsername(), u.getDisplayName(), u.getRole().name(), last,
                    tabs.stream().mapToLong(TabUsageResponse.TabTotal::visits).sum(),
                    tabs.stream().mapToLong(TabUsageResponse.TabTotal::activeMinutes).sum(),
                    tabs));
        });
        out.sort(Comparator.comparingLong(TabUsageResponse.Member::activeMinutes)
                .thenComparingLong(TabUsageResponse.Member::visits)
                .reversed());
        return new TabUsageResponse(d, totals(kept), out);
    }

    /** Visits and active minutes per tab, most used first. */
    private static List<TabUsageResponse.TabTotal> totals(List<TabActivityRepository.Tally> rows) {
        Map<String, long[]> byTab = new HashMap<>();
        for (TabActivityRepository.Tally r : rows) {
            long[] t = byTab.computeIfAbsent(r.getTab(), k -> new long[2]);
            t[r.getKind() == TabActivity.Kind.VIEW ? 0 : 1] += r.getCount();
        }
        Comparator<TabUsageResponse.TabTotal> mostUsed = Comparator.comparingLong(TabUsageResponse.TabTotal::activeMinutes)
                .thenComparingLong(TabUsageResponse.TabTotal::visits)
                .reversed();
        return byTab.entrySet().stream()
                .map(e -> new TabUsageResponse.TabTotal(e.getKey(), e.getValue()[0], e.getValue()[1]))
                .sorted(mostUsed.thenComparing(TabUsageResponse.TabTotal::tab))
                .toList();
    }
}
