package com.homeplatform.service;

import com.homeplatform.model.Notification;
import com.homeplatform.model.Notification.Category;
import com.homeplatform.model.Notification.Severity;
import com.homeplatform.model.User;
import com.homeplatform.repository.UserRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
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

    private final JdbcTemplate jdbc;
    private final NotificationService notificationService;
    private final UserRepository userRepo;
    private final AppEventService appEventService;

    public AlertEngine(JdbcTemplate jdbc,
                       NotificationService notificationService,
                       UserRepository userRepo,
                       AppEventService appEventService) {
        this.jdbc = jdbc;
        this.notificationService = notificationService;
        this.userRepo = userRepo;
        this.appEventService = appEventService;
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
                    // Read kWh rate from the properties table or env — hardcode fallback
                    double rate = 0.1171;
                    String msg = String.format(
                            "Month-to-date: %.0f kWh used. Estimated bill: $%.2f at $%.4f/kWh.",
                            monthKwh, monthKwh * rate, rate);
                    create(userId, Severity.INFO, billTitle, msg, "bill:" + today.format(DateTimeFormatter.ofPattern("yyyy-MM")));
                }
            }
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

    // ──────────────────────────────────────────
    // Value object
    // ──────────────────────────────────────────

    record DailyMetrics(
            double totalKwh,
            int readingCount,
            int maxHour,
            BigDecimal maxHourKwh) {}
}
