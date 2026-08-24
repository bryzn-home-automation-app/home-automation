package com.homeplatform.service;

import com.homeplatform.dto.RoombaRunResponse;
import com.homeplatform.dto.RoombaStatusResponse;
import com.homeplatform.model.Notification;
import com.homeplatform.model.Notification.Category;
import com.homeplatform.model.Notification.Severity;
import com.homeplatform.model.User;
import com.homeplatform.repository.UserRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Map;

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

    public AlertEngine(JdbcTemplate jdbc,
                       NotificationService notificationService,
                       UserRepository userRepo,
                       AppEventService appEventService,
                       RoombaService roombaService) {
        this.jdbc = jdbc;
        this.notificationService = notificationService;
        this.userRepo = userRepo;
        this.appEventService = appEventService;
        this.roombaService = roombaService;
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

        // ── Daily Usage Report (INFO) ──
        String dateLabel = yesterday.format(US_DATE);
        String reportTitle = "Daily usage report for " + dateLabel;
        if (isNew(userId, reportTitle)) {
            String msg = String.format(
                    "%s: %.1f kWh from %d hourly readings. 7-day avg: %.1f kWh/day. 30-day avg: %.1f kWh/day.",
                    dateLabel, yesterdayMetrics.totalKwh, yesterdayMetrics.readingCount, avg7, avg30);
            create(userId, Severity.INFO, reportTitle, msg, "daily:" + yyyyMmDd);
        }

        // ── Usage Spike (WARNING) — 30%+ above 7-day avg ──
        if (avg7 > 0 && yesterdayMetrics.totalKwh > avg7 * 1.3) {
            String spikeTitle = "Usage spike on " + dateLabel;
            if (isNew(userId, spikeTitle)) {
                double pct = ((yesterdayMetrics.totalKwh - avg7) / avg7) * 100;
                String msg = String.format(
                        "Yesterday's usage (%.1f kWh) was %.0f%% above your 7-day average (%.1f kWh/day).",
                        yesterdayMetrics.totalKwh, pct, avg7);
                create(userId, Severity.WARNING, spikeTitle, msg, "spike:" + yyyyMmDd);
            }
        }

        // ── Peak Hour (WARNING) ≥ 5 kWh in a single hour ──
        if (yesterdayMetrics.maxHourKwh != null && yesterdayMetrics.maxHourKwh.compareTo(BigDecimal.valueOf(5)) >= 0) {
            String peakTitle = "Peak usage hour on " + dateLabel;
            if (isNew(userId, peakTitle)) {
                String msg = String.format(
                        "Highest consumption was %d:00–%d:00 at %.1f kWh.",
                        yesterdayMetrics.maxHour, yesterdayMetrics.maxHour + 1, yesterdayMetrics.maxHourKwh);
                create(userId, Severity.WARNING, peakTitle, msg, "peak:" + yyyyMmDd);
            }
        }

        // ── Monthly Bill Estimate (INFO) — only on the 1st day after a new month starts ──
        LocalDate today = LocalDate.now(CHICAGO);
        if (today.getDayOfMonth() <= 3) { // first 3 days of month
            String billTitle = "Monthly bill estimate — " + today.getMonth().toString().charAt(0) + today.getMonth().toString().substring(1).toLowerCase();
            if (isNew(userId, billTitle)) {
                double monthKwh = queryMonthToDate(meterId);
                if (monthKwh > 0) {
                    // Use the configured kWh rate (same source as ConfigController /
                    // the dashboards) so the alert's bill estimate matches what the UI
                    // shows — previously hardcoded 0.1171, which silently disagreed.
                    double rate = kwhRate;
                    String msg = String.format(
                            "Month-to-date: %.0f kWh used. Estimated bill: $%.2f at $%.4f/kWh.",
                            monthKwh, monthKwh * rate, rate);
                    create(userId, Severity.INFO, billTitle, msg, "bill:" + today.format(DateTimeFormatter.ofPattern("yyyy-MM")));
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
        } catch (Exception e) {
            log.warn("AlertEngine: roomba alert generation failed for user {}: {}", userId, e.getMessage());
        }
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

    void maybeCleaningCompleteAlert(Long userId, RoombaRunResponse run) {
        if (run.completedAt() == null) return;           // still running / not finished
        if (run.error() != null && run.error() != 0) return; // errored runs surface via the error alert
        if (!isRecent(run.completedAt())) return;        // don't resurface old history

        String tag = run.missionNumber() != null ? "#" + run.missionNumber() : "run " + run.id();
        String title = "Cleaning complete — " + tag;
        if (!isNewRoomba(userId, title, false)) return;  // one-time event: dedup forever

        boolean haveArea = run.squareFeet() != null && run.squareFeet() > 0;
        boolean haveDur  = run.durationMinutes() != null && run.durationMinutes() > 0;
        String msg;
        if (haveArea && haveDur) {
            msg = String.format("Cleaned %d sq ft in %d min.", run.squareFeet(), run.durationMinutes());
        } else if (haveArea) {
            msg = String.format("Cleaned %d sq ft.", run.squareFeet());
        } else if (haveDur) {
            msg = String.format("Ran for %d min.", run.durationMinutes());
        } else {
            msg = "The robot finished a cleaning mission.";
        }
        createRoomba(userId, Severity.SUCCESS, title, msg);
    }

    void maybeRoombaStatusAlerts(Long userId, RoombaStatusResponse s) {
        // ── Error / stuck (CRITICAL) — an active fault code ──
        if (s.error() != null && s.error() != 0) {
            String reason = s.errorText() != null && !s.errorText().isBlank()
                    ? s.errorText() : "Error code " + s.error();
            String title = "Roomba error — " + reason;
            if (isNewRoomba(userId, title, true)) {
                createRoomba(userId, Severity.CRITICAL, title,
                        "The robot reported: " + reason + ". It may be stuck and need a hand to continue.");
            }
        } else if (s.needsAttention() && s.attentionReasons() != null && !s.attentionReasons().isEmpty()) {
            // ── Needs attention (WARNING) — bin/tank removed, dock error, not ready, charge faults ──
            // Fold the leading reason into the title so a *different* problem the same
            // day still alerts (rather than being deduped against an unrelated one).
            String title = "Roomba needs attention — " + s.attentionReasons().get(0);
            if (isNewRoomba(userId, title, true)) {
                createRoomba(userId, Severity.WARNING, title,
                        String.join("; ", s.attentionReasons()) + ".");
            }
        }

        // ── Battery low (WARNING) — low and not currently charging ──
        Integer batt = s.batteryPct();
        boolean charging = s.phase() != null && s.phase().equalsIgnoreCase("charge");
        if (batt != null && batt <= LOW_BATTERY_PCT && !charging) {
            String title = "Roomba battery low";
            if (isNewRoomba(userId, title, true)) {
                createRoomba(userId, Severity.WARNING, title, String.format(
                        "Battery at %d%%. The robot may not have enough charge to finish or return to its dock.",
                        batt));
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
                    COUNT(*)                        AS readings
                FROM hourly_electric_usage
                WHERE meter_id = ? AND timestamp::date = ?::date
                """, meterId, date);

            double total = ((Number) row.get("total")).doubleValue();
            int readings = ((Number) row.get("readings")).intValue();

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

            return new DailyMetrics(total, readings, maxHour, maxKwh);
        } catch (Exception e) {
            return new DailyMetrics(0, 0, 0, BigDecimal.ZERO);
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

    double queryMonthToDate(Long meterId) {
        try {
            Number sum = jdbc.queryForObject("""
                SELECT COALESCE(SUM(usage_kwh), 0)
                FROM hourly_electric_usage
                WHERE meter_id = ?
                  AND timestamp >= date_trunc('month', CURRENT_DATE)
                """, Double.class, meterId);
            return sum != null ? sum.doubleValue() : 0;
        } catch (Exception e) {
            return 0;
        }
    }

    // ──────────────────────────────────────────
    // Dedup helpers
    // ──────────────────────────────────────────

    /**
     * Returns true if no notification with the given title prefix exists
     * for this user today.
     */
    boolean isNew(Long userId, String titlePrefix) {
        try {
            Long count = jdbc.queryForObject("""
                SELECT COUNT(*) FROM notifications
                WHERE user_id = ?
                  AND category = 'ELECTRICAL'
                  AND title LIKE ? || '%'
                  AND created_at::date = CURRENT_DATE
                """, Long.class, userId, titlePrefix);
            return count == null || count == 0;
        } catch (Exception e) {
            return true; // on error, allow creation
        }
    }

    void create(Long userId, Severity severity, String title, String message, String sourceKey) {
        log.info("AlertEngine: {} — {}", severity, title);
        notificationService.create(userId, Category.ELECTRICAL, severity, title, message);
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

    void createRoomba(Long userId, Severity severity, String title, String message) {
        log.info("AlertEngine[roomba]: {} — {}", severity, title);
        notificationService.create(userId, Category.ROOMBA, severity, title, message);
    }

    // ──────────────────────────────────────────
    // Value object
    // ──────────────────────────────────────────

    record DailyMetrics(
            double totalKwh,
            int readingCount,
            int maxHour,
            BigDecimal maxHourKwh) {}
}
