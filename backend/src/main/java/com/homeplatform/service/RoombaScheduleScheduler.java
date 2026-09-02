package com.homeplatform.service;

import com.homeplatform.model.RoombaSchedule;
import com.homeplatform.repository.RoombaScheduleRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.ZonedDateTime;
import java.time.temporal.ChronoUnit;
import java.util.List;

/**
 * Fires app-managed recurring cleaning schedules. Runs once a minute (America/Chicago)
 * and, for each enabled schedule whose weekday + HH:mm matches the current minute,
 * enqueues a clean by REUSING the exact command path the manual "Start a clean" UI
 * uses: {@link RoombaService#enqueueWholeHouseClean} (→ {@code clean_rooms} over every
 * mapped room, or a plain {@code start} when unmapped) for WHOLE_HOUSE, and
 * {@link RoombaService#enqueueClean} (→ {@code clean_rooms}) for a chosen room set.
 * The poller drains the enqueued {@code roomba_commands} row exactly as for a manual clean.
 *
 * <p><b>Idempotency:</b> each fire stamps {@code lastFiredAt} with the UTC minute-start;
 * a schedule whose {@code lastFiredAt} is not before the current minute is skipped, so a
 * schedule fires at most once per matching minute even across a restart or a double tick.
 */
@Service
public class RoombaScheduleScheduler {

    private static final Logger log = LoggerFactory.getLogger(RoombaScheduleScheduler.class);
    private static final ZoneId CHICAGO = ZoneId.of("America/Chicago");

    private final RoombaScheduleRepository repo;
    private final RoombaService roombaService;
    private final AppEventService appEventService;

    public RoombaScheduleScheduler(RoombaScheduleRepository repo,
                                   RoombaService roombaService,
                                   AppEventService appEventService) {
        this.repo = repo;
        this.roombaService = roombaService;
        this.appEventService = appEventService;
    }

    /** Every minute, on the minute, in Chicago local time. */
    @Scheduled(cron = "0 * * * * *", zone = "America/Chicago")
    public void fireDueSchedules() {
        ZonedDateTime nowCt = ZonedDateTime.now(CHICAGO);
        int isoDay = nowCt.getDayOfWeek().getValue(); // 1 = Monday … 7 = Sunday
        int hour = nowCt.getHour();
        int minute = nowCt.getMinute();
        // Current minute-start in UTC — the idempotency key stamped on lastFiredAt.
        LocalDateTime minuteStartUtc = LocalDateTime.now(ZoneOffset.UTC).truncatedTo(ChronoUnit.MINUTES);

        List<RoombaSchedule> candidates;
        try {
            candidates = repo.findByEnabledTrue();
        } catch (Exception e) { // table may not exist yet at very first boot
            log.debug("schedule scan skipped: {}: {}", e.getClass().getSimpleName(), e.getMessage());
            return;
        }

        for (RoombaSchedule s : candidates) {
            if (s.getTimeOfDay() == null
                    || s.getTimeOfDay().getHour() != hour
                    || s.getTimeOfDay().getMinute() != minute) {
                continue;
            }
            if (!matchesDay(s.getDaysOfWeek(), isoDay)) {
                continue;
            }
            // Already fired this minute (or later) — idempotent guard.
            if (s.getLastFiredAt() != null && !s.getLastFiredAt().isBefore(minuteStartUtc)) {
                continue;
            }
            try {
                fire(s);
                s.setLastFiredAt(minuteStartUtc);
                repo.save(s);
            } catch (Exception e) { // fail-open — one bad schedule must not stop the rest
                log.warn("schedule #{} ({}) failed to fire: {}: {}",
                        s.getId(), s.getName(), e.getClass().getSimpleName(), e.getMessage());
                appEventService.error("roomba", "RoombaScheduleScheduler",
                        "Schedule \"" + s.getName() + "\" failed to fire", e.getMessage());
            }
        }
    }

    /** Enqueue the clean for a due schedule via the shared, manual-UI command path. */
    private void fire(RoombaSchedule s) {
        String requestedBy = "schedule:" + s.getId();
        String scope;
        if (RoombaScheduleService.ROOMS.equals(s.getTargetType())) {
            List<String> ids = RoombaScheduleService.csvToStrings(s.getRoomIds());
            if (ids.isEmpty()) {
                throw new IllegalArgumentException("no rooms configured");
            }
            roombaService.enqueueClean(ids, s.getSuction(), s.getPasses(), s.getMode(), requestedBy);
            scope = ids.size() + " room(s)";
        } else {
            roombaService.enqueueWholeHouseClean(s.getSuction(), s.getPasses(), s.getMode(), requestedBy);
            scope = "the whole house";
        }
        log.info("schedule #{} ({}) fired — cleaning {}", s.getId(), s.getName(), scope);
        appEventService.info("roomba", "RoombaScheduleScheduler",
                "Schedule \"" + s.getName() + "\" fired — cleaning " + scope);
    }

    /** True when the CSV of ISO day numbers contains the given day. */
    private static boolean matchesDay(String daysCsv, int isoDay) {
        if (daysCsv == null || daysCsv.isBlank()) {
            return false;
        }
        for (String part : daysCsv.split(",")) {
            if (part.trim().equals(String.valueOf(isoDay))) {
                return true;
            }
        }
        return false;
    }
}
