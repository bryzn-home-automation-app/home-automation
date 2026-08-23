package com.homeplatform.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import javax.sql.DataSource;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;

/**
 * Runs the daily sync every 30 min from 7:00 AM to 11:30 PM CT.
 * Downloads daily data from the CoServ Usage Explorer API and writes to electric_usage.
 * Skips if the day is already populated (idempotent), and backfills any gaps in
 * the last {@link #LOOKBACK_DAYS} days left by server downtime.
 *
 * <p><b>Run window:</b> CoServ has never posted a complete day before ~08:45 CT in the
 * observed history (typical arrival ~09:45 CT), so the pre-07:00 window was pure no-op
 * noise and is not scheduled. The window still runs late into the evening because CoServ
 * occasionally posts a delayed day around 21:00–22:00 CT.
 *
 * <p><b>Backoff:</b> once every day in the lookback window has been confirmed populated
 * on {@link #STANDDOWN_AFTER_CONFIRMATIONS} consecutive ticks, the scheduler stops
 * re-scanning until the calendar day rolls over (a new "yesterday" appears). This keeps
 * a finished date from being re-checked and re-logged every 30 minutes for the rest of
 * the day.
 *
 * Complements the {@link HourlySyncScheduler} which writes to hourly_electric_usage —
 * together they provide two independent data sources for reconciliation.
 */
@Service
public class DailySyncScheduler {

    private static final Logger log = LoggerFactory.getLogger(DailySyncScheduler.class);
    private static final ZoneId CHICAGO = ZoneId.of("America/Chicago");
    private static final DateTimeFormatter US_DATE = DateTimeFormatter.ofPattern("MM/dd/yyyy");

    /** CoServ only retains ~2 weeks of data — backfill lookback is bounded by this window. */
    private static final int LOOKBACK_DAYS = 14;

    /**
     * Number of consecutive ticks that must find the whole lookback window populated
     * before the scheduler stands down for the day. A small count (not 1) guards
     * against a transient DB read making a still-missing day look finished.
     */
    private static final int STANDDOWN_AFTER_CONFIRMATIONS = 2;

    private final DataSource dataSource;
    private final AppEventService appEventService;
    private final AlertEngine alertEngine;

    /** Consecutive ticks that found every lookback day already populated. Reset on rollover or a fresh gap. */
    private int consecutiveCompleteChecks = 0;

    /**
     * The "yesterday" we've backed off for, or {@code null} while actively syncing.
     * Once set, ticks return immediately until the calendar day rolls over and a new
     * "yesterday" appears — at which point the stand-down auto-clears.
     */
    private LocalDate standDownFor = null;

    public DailySyncScheduler(DataSource dataSource, AppEventService appEventService, AlertEngine alertEngine) {
        this.dataSource = dataSource;
        this.appEventService = appEventService;
        this.alertEngine = alertEngine;
    }

    /** Every 30 min from 7:00 AM to 11:30 PM CT. Same window as hourly but
     *  offset by 15 min to avoid both browser logins at the exact same second. */
    @Scheduled(cron = "0 0,30 7-23 * * *", zone = "America/Chicago")
    public void runDailySync() {
        LocalDate yesterday = today().minusDays(1);

        // Stand-down auto-clears when the calendar day rolls over: a new "yesterday"
        // means a new day's data to chase, so start scanning (and counting) afresh.
        if (standDownFor != null && !standDownFor.equals(yesterday)) {
            standDownFor = null;
            consecutiveCompleteChecks = 0;
        }

        // Already confirmed populated for this date — don't re-scan or re-log until tomorrow.
        if (yesterday.equals(standDownFor)) {
            return;
        }

        log.info("DailySyncScheduler: checking for {}…", yesterday);

        // Skip only when every day in the lookback window is already populated.
        Optional<LocalDate> earliest = findEarliestMissingDay(yesterday, LOOKBACK_DAYS);
        if (earliest.isEmpty()) {
            // Back off after a few consecutive clean scans, so a finished date isn't
            // re-checked every 30 min for the rest of the day.
            if (++consecutiveCompleteChecks >= STANDDOWN_AFTER_CONFIRMATIONS) {
                standDownFor = yesterday;
                log.info("DailySyncScheduler: {} populated on {} consecutive checks — standing down until tomorrow",
                        yesterday, consecutiveCompleteChecks);
            } else {
                log.info("DailySyncScheduler: {} already populated — skipping ({}/{} confirmations)",
                        yesterday, consecutiveCompleteChecks, STANDDOWN_AFTER_CONFIRMATIONS);
            }
            return;
        }

        // A real gap remains — restart the confirmation streak before syncing.
        consecutiveCompleteChecks = 0;

        LocalDate start = earliest.get();
        String label = start.equals(yesterday) ? start.toString() : start + " → " + yesterday;
        appEventService.info("sync", "DailySyncScheduler",
                "Starting daily sync for " + label);

        runSync(dailyCommand(start, yesterday), label);
    }

    /**
     * Manually sync an explicit date range (force — no idempotency skip).
     * Dates are ISO {@code yyyy-MM-dd}; a single day runs {@code --date}, a
     * range runs {@code --start}/{@code --end}.
     */
    public void runSyncForRange(String startIso, String endIso) {
        String start = toUsDate(startIso);
        String end = toUsDate(endIso);
        String label = start.equals(end) ? start : start + " → " + end;

        appEventService.info("sync", "DailySyncScheduler",
                "Starting manual daily sync for " + label);

        List<String> command = start.equals(end)
                ? List.of("node", "/scripts/sync.js", "--granularity", "daily", "--date", start)
                : List.of("node", "/scripts/sync.js", "--granularity", "daily", "--start", start, "--end", end);

        runSync(command, label);
    }

    /** Build the sync.js invocation for a (possibly single-day) date range. */
    private List<String> dailyCommand(LocalDate start, LocalDate end) {
        String startUs = start.format(US_DATE);
        String endUs = end.format(US_DATE);
        return start.equals(end)
                ? List.of("node", "/scripts/sync.js", "--granularity", "daily", "--date", startUs)
                : List.of("node", "/scripts/sync.js", "--granularity", "daily", "--start", startUs, "--end", endUs);
    }

    /** Today in Chicago. Package-private seam so tests can drive the day-rollover backoff. */
    LocalDate today() {
        return LocalDate.now(CHICAGO);
    }

    /** Spawn sync.js and record the result as an app event (with full output in details). */
    void runSync(List<String> command, String label) {
        try {
            ProcessBuilder pb = new ProcessBuilder(command);
            pb.redirectErrorStream(true);

            Process process = pb.start();
            StringBuilder output = new StringBuilder();
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(process.getInputStream()))) {
                String line;
                while ((line = reader.readLine()) != null) {
                    output.append(line).append("\n");
                }
            }

            int exitCode = process.waitFor();
            String full = output.toString();
            String tail = full.length() > 2000
                    ? "…\n" + full.substring(full.length() - 2000) : full;
            String details = full.length() > 4000
                    ? "…\n" + full.substring(full.length() - 4000) : full;
            String summary = summarize(full);

            if (exitCode == 0) {
                appEventService.log("sync", "INFO", "DailySyncScheduler",
                        "Daily sync completed for " + label + " — " + summary, details);
            } else {
                appEventService.log("sync", "WARN", "DailySyncScheduler",
                        "Daily sync exited " + exitCode + " for " + label + " — " + summary, details);
                log.warn("DailySyncScheduler stderr: {}", tail);
            }

            log.info("DailySyncScheduler output: {}", tail);
        } catch (Exception e) {
            log.error("DailySyncScheduler failed", e);
            appEventService.error("sync", "DailySyncScheduler",
                    "Daily sync failed for " + label, e.getMessage());
        }
    }

    /** Extract a human-readable summary line from script output, e.g.
     *  "── 08/12/2026 (daily) — 1 record(s) · 37.30 kWh · 1 written". */
    private String summarize(String output) {
        String summary = output.lines()
                .map(String::trim)
                .filter(l -> l.contains("(daily)"))
                .reduce((a, b) -> a + " | " + b)
                .orElse("");

        if (!summary.isBlank()) return summary;

        return output.lines()
                .map(String::trim)
                .filter(l -> l.contains("Total:") && l.contains("records"))
                .findFirst()
                .orElse("ok");
    }

    private static String toUsDate(String iso) {
        return LocalDate.parse(iso).format(US_DATE);
    }

    /**
     * Find the earliest day in the last {@code windowDays} days (through
     * {@code yesterday}) that has no non-zero daily reading. Empty when every
     * day is already populated. Backfills gaps left by server downtime, bounded
     * by CoServ's ~2-week retention window.
     */
    Optional<LocalDate> findEarliestMissingDay(LocalDate yesterday, int windowDays) {
        LocalDate first = yesterday.minusDays(windowDays - 1);
        Set<LocalDate> populated = new HashSet<>();
        try (var conn = dataSource.getConnection();
             var stmt = conn.prepareStatement(
                     "SELECT DISTINCT timestamp::date FROM electric_usage " +
                     "WHERE usage_kwh > 0 AND timestamp::date >= ?::date AND timestamp::date <= ?::date")) {
            stmt.setString(1, first.toString());
            stmt.setString(2, yesterday.toString());
            try (var rs = stmt.executeQuery()) {
                while (rs.next()) populated.add(rs.getDate(1).toLocalDate());
            }
        } catch (Exception e) {
            log.warn("DailySyncScheduler backfill scan failed: {}", e.getMessage());
            return Optional.empty();
        }

        LocalDate missing = null;
        for (LocalDate d = yesterday; !d.isBefore(first); d = d.minusDays(1)) {
            if (!populated.contains(d)) missing = d;
        }
        return Optional.ofNullable(missing);
    }
}
