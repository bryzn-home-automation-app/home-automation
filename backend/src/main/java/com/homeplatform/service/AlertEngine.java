package com.homeplatform.service;

import com.homeplatform.dto.RoombaDockIssue;
import com.homeplatform.dto.RoombaNativeScheduleResponse;
import com.homeplatform.dto.RoombaRunResponse;
import com.homeplatform.dto.RoombaStatusResponse;
import com.homeplatform.model.AlertType;
import com.homeplatform.model.Notification;
import com.homeplatform.model.Notification.Category;
import com.homeplatform.model.Notification.Severity;
import com.homeplatform.model.RoombaScheduleSkip;
import com.homeplatform.model.User;
import com.homeplatform.repository.RoombaScheduleSkipRepository;
import com.homeplatform.repository.UserRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;

/**
 * Generates real ELECTRICAL notifications from live usage data.
 * Called by {@code HourlySyncScheduler} after each sync and on user login.
 *
 * Every alert is deduplicated by title-prefix + date so the same day
 * never gets double-notified even after multiple scheduler ticks.
 */
@Service
public class AlertEngine {

    private static final Logger log = LoggerFactory.getLogger(AlertEngine.class);
    private static final ZoneId CHICAGO = ZoneId.of("America/Chicago");
    /** A day CoServ never finishes posting still gets its report, with what's there, after this. */
    private static final LocalTime PARTIAL_REPORT_AFTER = LocalTime.of(20, 0);
    private static final DateTimeFormatter US_DATE = DateTimeFormatter.ofPattern("MM/dd/yyyy");

    /** Battery percentage at or below which a low-battery warning fires (when not charging). */
    private static final int LOW_BATTERY_PCT = 15;

    /**
     * Only alert on a completed mission if it finished within this window. Keeps the
     * first login/scheduler pass from resurfacing an old run as "just cleaned".
     */
    private static final Duration RUN_FRESHNESS = Duration.ofHours(24);

    @Value("${app.kwh-rate:0.12}")
    private double kwhRate;

    private final JdbcTemplate jdbc;
    private final NotificationService notificationService;
    private final UserRepository userRepo;
    private final AppEventService appEventService;
    private final RoombaService roombaService;
    private final RoombaScheduleSkipRepository skipRepo;

    @Autowired
    public AlertEngine(JdbcTemplate jdbc,
                       NotificationService notificationService,
                       UserRepository userRepo,
                       AppEventService appEventService,
                       RoombaService roombaService,
                       RoombaScheduleSkipRepository skipRepo) {
        this.jdbc = jdbc;
        this.notificationService = notificationService;
        this.userRepo = userRepo;
        this.appEventService = appEventService;
        this.roombaService = roombaService;
        this.skipRepo = skipRepo;
    }

    /** Without the skipped cleans (tests that supply them through {@link #roombaSkips}). */
    AlertEngine(JdbcTemplate jdbc, NotificationService notificationService, UserRepository userRepo,
                AppEventService appEventService, RoombaService roombaService) {
        this(jdbc, notificationService, userRepo, appEventService, roombaService, null);
    }

    // ──────────────────────────────────────────
    // Public entry points
    // ──────────────────────────────────────────

    /** Generate alerts for every active (non-GUEST) user. Called by the scheduler. */
    public void generateForAllUsers() {
        List<User> users = userRepo.findByStatus(User.AccountStatus.ACTIVE);
        for (User u : users) {
            if (u.getRole() == User.Role.GUEST) continue;
            try {
                generateElectricAlerts(u.getId());
            } catch (Exception e) {
                log.warn("AlertEngine failed for user {}: {}", u.getId(), e.getMessage());
            }
            try {
                generateRoombaAlerts(u.getId());
            } catch (Exception e) {
                log.warn("AlertEngine (roomba) failed for user {}: {}", u.getId(), e.getMessage());
            }
        }
        log.info("AlertEngine: generated alerts for {} active users", users.size());
    }

    /** Generate alerts for a single user. Called on login. */
    public void generateElectricAlerts(Long userId) {
        Long meterId = findElectricMeter(userId);
        if (meterId == null) {
            log.debug("AlertEngine: no electric meter for user {}", userId);
            return;
        }

        LocalDate yesterday = LocalDate.now(CHICAGO).minusDays(1);
        String yyyyMmDd = yesterday.format(DateTimeFormatter.ISO_LOCAL_DATE);

        // Gather metrics
        DailyMetrics yesterdayMetrics = queryDay(meterId, yyyyMmDd);
        double avg7  = queryAvgLastNDays(meterId, yyyyMmDd, 7);
        double avg30 = queryAvgLastNDays(meterId, yyyyMmDd, 30);

        if (yesterdayMetrics.readingCount == 0) {
            log.debug("AlertEngine: no hourly data for {} — skipping alerts", yyyyMmDd);
            return;
        }
        // The hourly sync writes all 24 rows on its first pass, zeros included, and
        // CoServ often posts a late 3-hour block; a report sent then was frozen at the
        // partial total (10/31 went out as 23.6 kWh of a final 35.0). Wait for the same
        // "day is complete" rule the sync uses — or, failing that, until the evening.
        boolean complete = HourlySyncScheduler.isComplete(
                yesterday, yesterdayMetrics.readingCount, yesterdayMetrics.nonZeroCount);
        if (!complete && nowCentral().isBefore(PARTIAL_REPORT_AFTER)) {
            log.debug("AlertEngine: {} isn't complete yet ({} non-zero hours) — report waits",
                    yyyyMmDd, yesterdayMetrics.nonZeroCount);
            return;
        }

        // ── Daily Usage Report (INFO) ──
        String dateLabel = yesterday.format(US_DATE);
        String reportTitle = "Daily usage report for " + dateLabel;
        if (isNew(userId, reportTitle)) {
            String msg = String.format(
                    "%s: %.1f kWh from %d hourly readings. 7-day avg: %.1f kWh/day. 30-day avg: %.1f kWh/day.",
                    dateLabel, yesterdayMetrics.totalKwh, yesterdayMetrics.readingCount, avg7, avg30);
            create(userId, AlertType.ENERGY_DAILY, Severity.INFO, reportTitle, msg, "daily:" + yyyyMmDd);
        }

        // ── Usage Spike (WARNING) — 30%+ above 7-day avg ──
        if (avg7 > 0 && yesterdayMetrics.totalKwh > avg7 * 1.3) {
            String spikeTitle = "Usage spike on " + dateLabel;
            if (isNew(userId, spikeTitle)) {
                double pct = ((yesterdayMetrics.totalKwh - avg7) / avg7) * 100;
                String msg = String.format(
                        "Yesterday's usage (%.1f kWh) was %.0f%% above your 7-day average (%.1f kWh/day).",
                        yesterdayMetrics.totalKwh, pct, avg7);
                create(userId, AlertType.ENERGY_SPIKE, Severity.WARNING, spikeTitle, msg, "spike:" + yyyyMmDd);
            }
        }

        // ── Peak Hour (WARNING) ≥ 5 kWh in a single hour ──
        if (yesterdayMetrics.maxHourKwh != null && yesterdayMetrics.maxHourKwh.compareTo(BigDecimal.valueOf(5)) >= 0) {
            String peakTitle = "Peak usage hour on " + dateLabel;
            if (isNew(userId, peakTitle)) {
                String msg = String.format(
                        "Highest consumption was %d:00–%d:00 at %.1f kWh.",
                        yesterdayMetrics.maxHour, yesterdayMetrics.maxHour + 1, yesterdayMetrics.maxHourKwh);
                create(userId, AlertType.ENERGY_SPIKE, Severity.WARNING, peakTitle, msg, "peak:" + yyyyMmDd);
            }
        }

        // ── Monthly Bill Estimate (INFO) — last month's total, sent early in the new month ──
        // (It used to sum the new month, which on the 1st–3rd is a day or two of data:
        // November's said "29 kWh, $3.43".)
        LocalDate today = LocalDate.now(CHICAGO);
        if (today.getDayOfMonth() >= 2 && today.getDayOfMonth() <= 5) { // the 1st's data lands on the 2nd
            LocalDate lastMonth = today.minusMonths(1).withDayOfMonth(1);
            String monthName = lastMonth.getMonth().getDisplayName(java.time.format.TextStyle.FULL, java.util.Locale.US);
            String billTitle = "Monthly bill estimate — " + monthName + " " + lastMonth.getYear();
            if (isNew(userId, billTitle)) {
                double monthKwh = queryMonthTotal(meterId, lastMonth);
                if (monthKwh > 0) {
                    // Use the configured kWh rate (same source as ConfigController /
                    // the dashboards) so the alert's bill estimate matches what the UI
                    // shows — previously hardcoded 0.1171, which silently disagreed.
                    double rate = kwhRate;
                    String msg = String.format(
                            "%s: %.0f kWh used. Estimated electric cost: $%.2f at $%.4f/kWh.",
                            monthName, monthKwh, monthKwh * rate, rate);
                    create(userId, AlertType.ENERGY_BILL, Severity.INFO, billTitle, msg, "bill:" + lastMonth.format(DateTimeFormatter.ofPattern("yyyy-MM")));
                }
            }
        }
    }

    // ──────────────────────────────────────────
    // Roomba alerts
    // ──────────────────────────────────────────

    /**
     * Generate ROOMBA notifications from the latest live status snapshot and the
     * most recent mission. Reuses the same notifications table, severities and
     * per-day dedup as the electric alerts. Roomba data is global (single robot),
     * so — like the electric alerts — each active user gets their own copy.
     *
     * Alert types:
     *  • Cleaning complete (SUCCESS) — a mission finished with no error, deduped
     *    once ever per mission.
     *  • Roomba error (CRITICAL) — an active fault/error code (stuck, cliff,
     *    brush, etc. — decoded by the poller into {@code errorText}).
     *  • Roomba needs attention (WARNING) — bin/tank removed, dock error, not-ready
     *    or charging faults (the derived {@code needsAttention} reasons).
     *  • Battery low (WARNING) — battery ≤ {@value #LOW_BATTERY_PCT}% while not
     *    charging (may not finish or return to dock).
     *  • Roomba dock — … (WARNING) — the dock's own complaint (clean-water tank empty,
     *    dirty-water tank full, …), once per occurrence ({@link #maybeDockAlert}).
     *  • Scheduled clean didn't start (WARNING) — once per scheduled start
     *    ({@link #maybeMissedStartAlerts}).
     * The three status-derived alerts dedup once per day so a persistent condition
     * re-notifies daily rather than every scheduler tick.
     */
    public void generateRoombaAlerts(Long userId) {
        try {
            RoombaRunResponse latestRun = latestRoombaRun();
            if (latestRun != null) {
                maybeCleaningCompleteAlert(userId, latestRun);
            }

            RoombaStatusResponse status = roombaStatus();
            if (status != null) {
                maybeRoombaStatusAlerts(userId, status);
            }
            dockAndScheduleAlerts(userId, status);
        } catch (Exception e) {
            log.warn("AlertEngine: roomba alert generation failed for user {}: {}", userId, e.getMessage());
        }
    }

    /**
     * The dock's complaint and a scheduled clean that didn't start, for every active member.
     * These need to be timely (the rest of the Roomba alerts ride on the hourly sync and on
     * logins), so {@code RoombaAlertScheduler} runs this every few minutes.
     */
    public void generateRoombaWatchAlerts() {
        for (User u : userRepo.findByStatus(User.AccountStatus.ACTIVE)) {
            if (u.getRole() == User.Role.GUEST) continue;
            try {
                generateRoombaWatchAlerts(u.getId());
            } catch (Exception e) {
                log.warn("AlertEngine (roomba watch) failed for user {}: {}", u.getId(), e.getMessage());
            }
        }
    }

    void generateRoombaWatchAlerts(Long userId) {
        dockAndScheduleAlerts(userId, roombaStatus());
    }

    // synchronized: the five-minute check, the hourly sync and a login can land together, and
    // each checks "sent already?" before sending.
    private synchronized void dockAndScheduleAlerts(Long userId, RoombaStatusResponse status) {
        if (status != null) {
            maybeDockAlert(userId, status);
        }
        maybeMissedStartAlerts(userId, status);
    }

    // package-private seams so tests can supply status/runs without a DB
    RoombaStatusResponse roombaStatus() {
        return roombaService == null ? null : roombaService.getStatus().orElse(null);
    }

    RoombaRunResponse latestRoombaRun() {
        if (roombaService == null) return null;
        List<RoombaRunResponse> runs = roombaService.getRuns(1);
        return runs.isEmpty() ? null : runs.get(0);
    }

    /** The newest runs, enough to cover today (the robot runs once or twice a day). */
    List<RoombaRunResponse> recentRoombaRuns() {
        return roombaService == null ? List.of() : roombaService.getRuns(10);
    }

    /** The robot's own schedules as last read from the cloud (roomba_native_schedule). */
    List<RoombaNativeScheduleResponse> roombaSchedules() {
        return roombaService == null ? List.of() : roombaService.getNativeSchedules();
    }

    /**
     * The skipped cleans that bear on today's starts: today's skips, and every skip of ours
     * holding a schedule switched off now, whatever its day. Null when they can't be read.
     */
    List<RoombaScheduleSkip> roombaSkips(LocalDate today) {
        if (skipRepo == null) return List.of();
        try {
            return skipRepo.findBySkipDateOrStateIn(today, HOLDING);
        } catch (Exception e) {
            log.warn("AlertEngine: couldn't read the skipped Roomba cleans: {}", e.getMessage());
            return null;
        }
    }

    /** Now at home (a seam for tests). */
    ZonedDateTime nowAtHome() {
        return ZonedDateTime.now(CHICAGO);
    }

    void maybeCleaningCompleteAlert(Long userId, RoombaRunResponse run) {
        if (run.completedAt() == null) return;           // still running / not finished
        // Wait for the cloud's record of the run. The poller's own row can be cut
        // short (a mid-clean recharge looked like the end) or call a stuck run
        // complete; the history sync replaces it about a minute after the robot docks.
        if (!run.verified()) return;
        if (!isRecent(run.completedAt())) return;        // don't resurface old history

        String tag = run.missionNumber() != null ? "#" + run.missionNumber() : "run " + run.id();
        boolean haveArea = run.squareFeet() != null && run.squareFeet() > 0;

        // ── Didn't finish (WARNING) — stuck or otherwise stopped short ──
        if ("STUCK".equals(run.status()) || "INCOMPLETE".equals(run.status())) {
            String title = "Cleaning didn't finish — " + tag;
            if (!isNewRoomba(userId, title, false)) return;
            String reason = run.errorText() != null && !run.errorText().isBlank() ? run.errorText() : "it got stuck";
            String msg = (haveArea ? String.format("Stopped after %d sq ft: %s.", run.squareFeet(), reason)
                                   : String.format("Stopped early: %s.", reason))
                    + " It may need a hand before the next clean.";
            createRoomba(userId, AlertType.ROOMBA_ATTENTION, Severity.WARNING, title, msg);
            return;
        }
        if (!"COMPLETED".equals(run.status())) return;   // cancelled — someone stopped it on purpose
        if (run.error() != null && run.error() != 0) return; // errored runs surface via the error alert

        String title = "Cleaning complete — " + tag;
        if (!isNewRoomba(userId, title, false)) return;  // one-time event: dedup forever

        // Cleaning time: the run's wall-clock length less its recharge stops and pauses,
        // the same figure the Roomba tab shows.
        Integer cleaning = run.durationMinutes();
        if (cleaning != null) {
            int stopped = (run.chargeMinutes() != null ? run.chargeMinutes() : 0)
                    + (run.pauseMinutes() != null ? run.pauseMinutes() : 0);
            cleaning = Math.max(0, cleaning - stopped);
        }
        boolean haveDur = cleaning != null && cleaning > 0;
        String msg;
        if (haveArea && haveDur) {
            msg = String.format("Cleaned %,d sq ft in %s.", run.squareFeet(), minutesLabel(cleaning));
        } else if (haveArea) {
            msg = String.format("Cleaned %,d sq ft.", run.squareFeet());
        } else if (haveDur) {
            msg = String.format("Ran for %s.", minutesLabel(cleaning));
        } else {
            msg = "The robot finished a cleaning mission.";
        }
        if (run.chargeMinutes() != null && run.chargeMinutes() > 0) {
            msg = msg.substring(0, msg.length() - 1)
                    + String.format(", plus %s docked to recharge.", minutesLabel(run.chargeMinutes()));
        }
        createRoomba(userId, AlertType.ROOMBA_DONE, Severity.SUCCESS, title, msg);
    }

    /** "45 min", "2 hr", "4 hr 23 min". */
    static String minutesLabel(int minutes) {
        if (minutes < 60) return minutes + " min";
        int h = minutes / 60;
        int m = minutes % 60;
        return m == 0 ? h + " hr" : h + " hr " + m + " min";
    }

    void maybeRoombaStatusAlerts(Long userId, RoombaStatusResponse s) {
        // ── Error / stuck (CRITICAL) — an active fault code ──
        if (s.error() != null && s.error() != 0) {
            String reason = s.errorText() != null && !s.errorText().isBlank()
                    ? s.errorText() : "Error code " + s.error();
            String title = "Roomba error — " + reason;
            if (isNewRoomba(userId, title, true)) {
                createRoomba(userId, AlertType.ROOMBA_ERROR, Severity.CRITICAL, title,
                        "The robot reported: " + reason + ". It may be stuck and need a hand to continue.");
            }
        } else if (s.needsAttention() && !otherReasons(s).isEmpty()) {
            // ── Needs attention (WARNING) — bin/tank removed, dock error, not ready, charge faults ──
            // Fold the leading reason into the title so a *different* problem the same
            // day still alerts (rather than being deduped against an unrelated one).
            // The dock's complaint has its own alert (maybeDockAlert), so it isn't repeated here.
            List<String> reasons = otherReasons(s);
            String title = "Roomba needs attention — " + reasons.get(0);
            if (isNewRoomba(userId, title, true)) {
                createRoomba(userId, AlertType.ROOMBA_ATTENTION, Severity.WARNING, title,
                        String.join("; ", reasons) + ".");
            }
        }

        // ── Battery low (WARNING) — low and not currently charging ──
        Integer batt = s.batteryPct();
        boolean charging = s.phase() != null && s.phase().equalsIgnoreCase("charge");
        if (batt != null && batt <= LOW_BATTERY_PCT && !charging) {
            String title = "Roomba battery low";
            if (isNewRoomba(userId, title, true)) {
                createRoomba(userId, AlertType.ROOMBA_ATTENTION, Severity.WARNING, title, String.format(
                        "Battery at %d%%. The robot may not have enough charge to finish or return to its dock.",
                        batt));
            }
        }
    }

    /** The attention reasons without the dock's complaint, which has an alert of its own. */
    static List<String> otherReasons(RoombaStatusResponse s) {
        List<String> reasons = s.attentionReasons() == null ? List.of() : s.attentionReasons();
        RoombaDockIssue issue = s.dockIssue();
        if (issue == null) return reasons;
        String dock = RoombaDock.reason(issue.kind(), issue.code());
        return reasons.stream().filter(r -> !r.equals(dock)).toList();
    }

    // ── The dock ──────────────────────────────────

    /**
     * A complaint has to stand this long before it alerts: the poller reads the robot every
     * five minutes when it's idle, so this is two readings, not one that cleared on the next.
     */
    static final Duration DOCK_ISSUE_SETTLE = Duration.ofMinutes(10);
    /**
     * No second alert for the same kind of complaint within this long of the last one. The
     * poller restarts {@code since} whenever the complaint drops out of a reading, and the dock
     * can stop reporting its tank state while the robot is out, so without this a tank left
     * empty could alert again after every clean.
     */
    static final Duration DOCK_REPEAT_QUIET = Duration.ofHours(12);

    /**
     * The dock's complaint (clean-water tank empty, dirty-water tank full, …), once per
     * occurrence: the poller keeps {@code since} while the same complaint stands, so a member
     * hears about it once, and again only after it was fixed and came back (or changed), and
     * not within {@link #DOCK_REPEAT_QUIET} of the last alert for that kind.
     */
    void maybeDockAlert(Long userId, RoombaStatusResponse s) {
        RoombaDockIssue issue = s.dockIssue();
        if (issue == null || issue.kind() == null || issue.kind().isBlank()) return;
        Instant now = nowAtHome().toInstant();
        Instant since = parseInstant(issue.since());
        if (since != null && since.isAfter(now.minus(DOCK_ISSUE_SETTLE))) return;
        String title = RoombaDock.alertTitle(issue.kind());
        // No start recorded (a poller from before dock_issue_since): at most once a day.
        Instant quiet = now.minus(DOCK_REPEAT_QUIET);
        Instant from = since == null ? now.minus(Duration.ofDays(1)) : since.isBefore(quiet) ? since : quiet;
        if (!isNewRoombaSince(userId, title, from)) return;
        createRoomba(userId, AlertType.ROOMBA_ATTENTION, Severity.WARNING, title,
                RoombaDock.alertMessage(issue.kind(), issue.code(), s.name()));
    }

    // ── A scheduled clean that didn't start ───────

    /** A scheduled clean starts within a minute (09:00:13–09:00:34 since October); this late, it didn't. */
    static final Duration START_GRACE = Duration.ofMinutes(30);
    /** A start this close to the scheduled time is the schedule's (the robot's clock can run early). */
    static final Duration START_EARLY = Duration.ofMinutes(10);
    /** Past this, the morning's miss isn't news any more (the backend was down, say). */
    static final Duration START_STALE = Duration.ofHours(12);
    private static final DateTimeFormatter MISSED_DAY = DateTimeFormatter.ofPattern("MMM d", java.util.Locale.US);
    private static final DateTimeFormatter MISSED_TIME = DateTimeFormatter.ofPattern("h:mm a", java.util.Locale.US);
    private static final Map<Integer, String> MODE_WORDS = Map.of(2, "vacuum", 4, "mop", 6, "vacuum-and-mop");

    /**
     * Today's scheduled cleans (the robot's own schedules, in home time like the robot's
     * clock) that should have started by now and didn't. Nov 13 2026: the 9:00 AM
     * vacuum-and-mop clean never started because the dock's clean-water tank was empty, and
     * nothing said so. Only on a fresh reading (the poller checked in within 10 minutes, so
     * a missing run isn't just the poller being down), and not when the robot was already
     * out on another clean at that time. Once per scheduled start.
     *
     * <p>A clean skipped from the Roomba page isn't a miss ({@link #skipped}), and neither is
     * one whose schedule a skip of ours had switched off as asked ({@link #skipHold}). Such a
     * skip leaves the mirrored schedule reading {@code enabled: false}, so the flag alone can't
     * say whether the owner switched it off: a schedule a skip of ours holds off still counts
     * as on for the starts before we switched it off, and for any start after it should have
     * been back on (the switch back on failed, or an undo wasn't carried out in time).
     */
    void maybeMissedStartAlerts(Long userId, RoombaStatusResponse s) {
        if (s == null || !s.online()) return;
        List<RoombaNativeScheduleResponse> schedules = roombaSchedules();
        if (schedules == null || schedules.isEmpty()) return;
        ZonedDateTime now = nowAtHome();
        LocalDate today = now.toLocalDate();
        List<RoombaRunResponse> runs = null;
        List<RoombaScheduleSkip> skips = null;
        for (RoombaNativeScheduleResponse sch : schedules) {
            if (sch.hour() == null || sch.minute() == null || sch.days() == null) continue;
            if (sch.frequency() != null && !"WEEKLY".equalsIgnoreCase(sch.frequency())) continue;
            if (!RoombaScheduleSkipService.runsOn(new HashSet<>(sch.days()), today)) continue;
            ZonedDateTime at = today.atTime(sch.hour(), sch.minute()).atZone(CHICAGO);
            if (now.isBefore(at.plus(START_GRACE)) || now.isAfter(at.plus(START_STALE))) continue;
            if (skips == null) {
                skips = roombaSkips(today);
                if (skips == null) return;  // a skipped clean can't be told from a missed one: next check
            }
            if (skipped(sch, at, skips)) continue;
            SkipHold hold = skipHold(sch, at.toInstant(), skips);
            if (hold == SkipHold.WANTED || (hold == SkipHold.NONE && !sch.enabled())) continue;
            if (runs == null) runs = recentRoombaRuns();
            if (startedOrBusy(at.toInstant(), s, runs)) continue;

            String time = at.format(MISSED_TIME);
            String title = "Scheduled clean didn't start — " + at.format(MISSED_DAY) + ", " + time;
            if (!isNewRoombaSince(userId, title, at.toInstant())) continue;
            String name = s.name() != null && !s.name().isBlank() ? s.name().trim() : "The Roomba";
            String mode = sch.operatingModes() != null && sch.operatingModes().size() == 1
                    ? MODE_WORDS.get(sch.operatingModes().get(0)) : null;
            String msg = name + "'s " + time + (mode != null ? " " + mode : "") + " clean didn't start.";
            RoombaDockIssue issue = s.dockIssue();
            if (hold == SkipHold.LEFT_OFF) {
                msg += " Its schedule was still switched off in the iRobot app after a skipped clean."
                        + " Turn it back on there; the home app keeps trying too.";
            } else if (issue != null && issue.kind() != null) {
                msg += " " + RoombaDock.reason(issue.kind(), issue.code()) + ". " + RoombaDock.fix(issue.kind(), issue.code(), s.name());
            } else {
                msg += " It hasn't said why: check the robot and the iRobot app.";
            }
            createRoomba(userId, AlertType.ROOMBA_ATTENTION, Severity.WARNING, title, msg);
        }
    }

    /** Skip states in which the poller has (or may have) the schedule switched off. */
    static final List<String> HOLDING = List.of(RoombaScheduleSkipService.APPLYING, RoombaScheduleSkipService.APPLIED);

    /**
     * Whether the start at {@code at} was skipped from the Roomba page, so its not starting is
     * what was asked for. A skip row for that schedule, day and time counts unless it was
     * undone before the start, or ended before the start without skipping it (switched back on,
     * changed or deleted in the iRobot app, or already off there, which the schedule's own
     * flag then says). So it counts while it is under way (PENDING, APPLYING, APPLIED), once it
     * is RESTORED after the start, and when it FAILED: then the schedule couldn't be switched
     * off in time, and the admins have had "Couldn't skip the Roomba's clean"; if the robot ran
     * anyway there is nothing to say, and if it didn't, it did what the owner asked.
     */
    static boolean skipped(RoombaNativeScheduleResponse sch, ZonedDateTime at, List<RoombaScheduleSkip> skips) {
        Instant start = at.toInstant();
        for (RoombaScheduleSkip skip : skips) {
            if (!Objects.equals(skip.getHouseholdScheduleId(), sch.householdScheduleId())
                    || !at.toLocalDate().equals(skip.getSkipDate())
                    || !Objects.equals(skip.getScheduleHour(), at.getHour())
                    || !Objects.equals(skip.getScheduleMinute(), at.getMinute())) {
                continue;
            }
            Instant undone = utcInstant(skip.getUndoRequestedAt());
            if (undone != null && undone.isBefore(start)) continue;
            Instant ended = utcInstant(skip.getFinishedAt());
            boolean over = RoombaScheduleSkipService.RESTORED.equals(skip.getState())
                    || RoombaScheduleSkipService.CANCELLED.equals(skip.getState());
            if (over && ended != null && ended.isBefore(start)) continue;
            return true;
        }
        return false;
    }

    /** How a skip of ours stood on a schedule at one of its starts. */
    enum SkipHold {
        /** No skip of ours holds it off: the schedule's own on/off flag says whether it was on. */
        NONE,
        /** A skip of ours holds it off now, but switched it off after this start: it was on. */
        ON_THEN,
        /** Switched off by a skip of ours at this start, as asked: no clean was due. */
        WANTED,
        /** Switched off by a skip of ours at this start, past when it should have been back on. */
        LEFT_OFF
    }

    /**
     * Whether a skip of ours had this schedule switched off at {@code start}. The poller
     * switches it off once its run before the skipped one has started, and back on 30 minutes
     * after the skipped start (or at once on an undo), so between those it is off as asked.
     */
    static SkipHold skipHold(RoombaNativeScheduleResponse sch, Instant start, List<RoombaScheduleSkip> skips) {
        SkipHold hold = SkipHold.NONE;
        for (RoombaScheduleSkip skip : skips) {
            if (!HOLDING.contains(skip.getState()) || !Objects.equals(skip.getHouseholdScheduleId(), sch.householdScheduleId())) {
                continue;
            }
            // APPLYING has no applied_at yet: it was stored just before the switch-off was sent.
            Instant off = utcInstant(skip.getAppliedAt() != null ? skip.getAppliedAt() : skip.getUpdatedAt());
            if (off == null || off.isAfter(start)) {
                if (hold == SkipHold.NONE) hold = SkipHold.ON_THEN;
                continue;
            }
            Instant backOn = utcInstant(skip.getRestoreAfter());
            Instant undone = utcInstant(skip.getUndoRequestedAt());
            if (undone != null && (backOn == null || undone.isBefore(backOn))) backOn = undone;
            if (backOn == null || start.isBefore(backOn)) return SkipHold.WANTED;
            hold = SkipHold.LEFT_OFF;
        }
        return hold;
    }

    /** A roomba_schedule_skips TIMESTAMP (UTC wall clock) as an instant. */
    private static Instant utcInstant(LocalDateTime utc) {
        return utc == null ? null : utc.toInstant(ZoneOffset.UTC);
    }

    /**
     * Whether the robot started a clean around {@code at}, or was out on one already. Runs
     * are written when they end; a clean still going shows as the status's mission start.
     */
    static boolean startedOrBusy(Instant at, RoombaStatusResponse s, List<RoombaRunResponse> runs) {
        Instant from = at.minus(START_EARLY);
        Instant to = at.plus(START_GRACE);
        Instant missionStart = parseInstant(s.missionStart());
        if (missionStart != null && !missionStart.isAfter(to)) {
            if (!missionStart.isBefore(from)) return true;                 // started on time
            String cycle = s.cycle() == null ? "" : s.cycle().trim().toLowerCase();
            if (s.running() || !(cycle.isEmpty() || cycle.equals("none"))) return true; // an earlier clean, still going
        }
        for (RoombaRunResponse r : runs == null ? List.<RoombaRunResponse>of() : runs) {
            Instant started = parseInstant(r.startedAt());
            if (started == null) continue;
            if (!started.isBefore(from) && !started.isAfter(to)) return true;
            Instant ended = parseInstant(r.completedAt());
            if (started.isBefore(from) && (ended == null || ended.isAfter(at))) return true;
        }
        return false;
    }

    static Instant parseInstant(String iso) {
        if (iso == null || iso.isBlank()) return null;
        try {
            return java.time.OffsetDateTime.parse(iso).toInstant();
        } catch (Exception e) {
            try {
                return Instant.parse(iso);
            } catch (Exception e2) {
                return null;
            }
        }
    }

    /** True when an ISO-8601 (UTC, 'Z') timestamp is within {@link #RUN_FRESHNESS} of now. */
    boolean isRecent(String isoUtc) {
        try {
            return Instant.parse(isoUtc).isAfter(Instant.now().minus(RUN_FRESHNESS));
        } catch (Exception e) {
            return false;
        }
    }

    // ──────────────────────────────────────────
    // Data queries
    // ──────────────────────────────────────────

    Long findElectricMeter(Long userId) {
        try {
            return jdbc.queryForObject("""
                SELECT m.id FROM meters m
                WHERE UPPER(m.type) = 'ELECTRIC'
                ORDER BY m.id
                LIMIT 1
                """, Long.class);
        } catch (Exception e) {
            return null;
        }
    }

    // package-private for testability
    DailyMetrics queryDay(Long meterId, String date) {
        try {
            Map<String, Object> row = jdbc.queryForMap("""
                SELECT
                    COALESCE(SUM(usage_kwh), 0) AS total,
                    COUNT(*)                        AS readings,
                    COUNT(*) FILTER (WHERE usage_kwh > 0) AS nonzero
                FROM hourly_electric_usage
                WHERE meter_id = ? AND timestamp::date = ?::date
                """, meterId, date);

            double total = ((Number) row.get("total")).doubleValue();
            int readings = ((Number) row.get("readings")).intValue();
            int nonZero = ((Number) row.get("nonzero")).intValue();

            // Peak hour
            Map<String, Object> peak = jdbc.queryForMap("""
                SELECT
                    EXTRACT(HOUR FROM timestamp) AS hr,
                    usage_kwh
                FROM hourly_electric_usage
                WHERE meter_id = ? AND timestamp::date = ?::date
                ORDER BY usage_kwh DESC
                LIMIT 1
                """, meterId, date);

            int maxHour = ((Number) peak.get("hr")).intValue();
            BigDecimal maxKwh = (BigDecimal) peak.get("usage_kwh");

            return new DailyMetrics(total, readings, nonZero, maxHour, maxKwh);
        } catch (Exception e) {
            return new DailyMetrics(0, 0, 0, 0, BigDecimal.ZERO);
        }
    }

    double queryAvgLastNDays(Long meterId, String beforeDate, int days) {
        try {
            Number avg = jdbc.queryForObject("""
                SELECT COALESCE(AVG(daily_total), 0)
                FROM (
                    SELECT timestamp::date AS d, SUM(usage_kwh) AS daily_total
                    FROM hourly_electric_usage
                    WHERE meter_id = ?
                      AND timestamp::date < ?::date
                    GROUP BY timestamp::date
                    ORDER BY d DESC
                    LIMIT ?
                ) sub
                """, Double.class, meterId, beforeDate, days);
            return avg != null ? avg.doubleValue() : 0;
        } catch (Exception e) {
            return 0;
        }
    }

    /** Wall-clock time at home (a seam for tests). */
    LocalTime nowCentral() {
        return LocalTime.now(CHICAGO);
    }

    /** kWh for the calendar month starting at {@code monthStart}. */
    double queryMonthTotal(Long meterId, LocalDate monthStart) {
        try {
            Number sum = jdbc.queryForObject("""
                SELECT COALESCE(SUM(usage_kwh), 0)
                FROM hourly_electric_usage
                WHERE meter_id = ?
                  AND timestamp >= ?::date
                  AND timestamp <  ?::date
                """, Double.class, meterId, monthStart.toString(), monthStart.plusMonths(1).toString());
            return sum != null ? sum.doubleValue() : 0;
        } catch (Exception e) {
            return 0;
        }
    }

    // ──────────────────────────────────────────
    // Dedup helpers
    // ──────────────────────────────────────────

    /**
     * Returns true if no notification with the given title prefix exists for this
     * user. Every electric title names its day or month, so this dedups for good
     * (it used to check today only, and the bill estimate went out on the 2nd and 3rd).
     */
    boolean isNew(Long userId, String titlePrefix) {
        try {
            Long count = jdbc.queryForObject("""
                SELECT COUNT(*) FROM notifications
                WHERE user_id = ?
                  AND category = 'ELECTRICAL'
                  AND title LIKE ? || '%'
                """, Long.class, userId, titlePrefix);
            return count == null || count == 0;
        } catch (Exception e) {
            return true; // on error, allow creation
        }
    }

    void create(Long userId, AlertType type, Severity severity, String title, String message, String sourceKey) {
        log.info("AlertEngine: {} — {}", severity, title);
        notificationService.send(userId, type, severity, title, message);
    }

    /**
     * True if no ROOMBA notification with this exact title exists for the user.
     * When {@code todayOnly} is set the check is scoped to today (a persistent
     * condition re-notifies once per day); otherwise it dedups forever (a one-time
     * event such as a finished mission is never repeated).
     */
    boolean isNewRoomba(Long userId, String title, boolean todayOnly) {
        try {
            String sql = "SELECT COUNT(*) FROM notifications "
                    + "WHERE user_id = ? AND category = 'ROOMBA' AND title = ?"
                    + (todayOnly ? " AND created_at::date = CURRENT_DATE" : "");
            Long count = jdbc.queryForObject(sql, Long.class, userId, title);
            return count == null || count == 0;
        } catch (Exception e) {
            return true; // on error, allow creation
        }
    }

    /**
     * True if no ROOMBA notification with this exact title has been created for the user
     * since {@code since}: one alert per occurrence of a condition that began then.
     * notifications.created_at is the backend's local time (Notification's
     * LocalDateTime.now()), so {@code since} is turned into the same. Unlike the checks
     * above, a failed read means no alert: this runs every few minutes, and a broken
     * check must not repeat the alert each time.
     */
    boolean isNewRoombaSince(Long userId, String title, Instant since) {
        try {
            Long count = jdbc.queryForObject("""
                SELECT COUNT(*) FROM notifications
                WHERE user_id = ? AND category = 'ROOMBA' AND title = ? AND created_at >= ?
                """, Long.class, userId, title, LocalDateTime.ofInstant(since, ZoneId.systemDefault()));
            return count == null || count == 0;
        } catch (Exception e) {
            log.warn("AlertEngine: couldn't check for an earlier '{}' alert: {}", title, e.getMessage());
            return false;
        }
    }

    void createRoomba(Long userId, AlertType type, Severity severity, String title, String message) {
        log.info("AlertEngine[roomba]: {} — {}", severity, title);
        notificationService.send(userId, type, severity, title, message);
    }

    // ──────────────────────────────────────────
    // Value object
    // ──────────────────────────────────────────

    record DailyMetrics(
            double totalKwh,
            int readingCount,
            int nonZeroCount,
            int maxHour,
            BigDecimal maxHourKwh) {}
}
