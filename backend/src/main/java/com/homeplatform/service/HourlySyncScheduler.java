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
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * Syncs yesterday's hourly electric data from the CoServ Usage Explorer API.
 * Every 30 min from 6:15 AM to 11:45 PM CT — late enough for data, frequent
 * enough to fill gaps. Backfills any incomplete days in the last
 * {@link #LOOKBACK_DAYS} days left by server downtime.
 *
 * <p>"Complete" is judged on <em>non-zero</em> readings, not raw row count:
 * CoServ posts hourly values progressively, so early in the day most hours
 * come back as 0.00 kWh. Counting rows alone made a 24-row-but-mostly-zero
 * day look finished. We only stop retrying once enough hours carry a real
 * reading, and we log the day's total kWh so the Debug Dashboard shows the
 * actual reading rather than a bare "24/24".
 */
@Service
public class HourlySyncScheduler {

    private static final Logger log = LoggerFactory.getLogger(HourlySyncScheduler.class);
    private static final ZoneId CHICAGO = ZoneId.of("America/Chicago");
    private static final DateTimeFormatter US_DATE = DateTimeFormatter.ofPattern("MM/dd/yyyy");

    /** A single meter+provider should never produce more than this many hourly rows per day. */
    private static final int EXPECTED_ROWS_PER_DAY = 24;

    /** A day counts as fully synced once at least this many hours have a real (non-zero) reading. */
    private static final int COMPLETE_NONZERO_THRESHOLD = 20;

    /** CoServ only retains ~2 weeks of interval data — backfill lookback is bounded by this window. */
    private static final int LOOKBACK_DAYS = 14;

    private final DataSource dataSource;
    private final AppEventService appEventService;
    private final AlertEngine alertEngine;

    public HourlySyncScheduler(DataSource dataSource,
                               AppEventService appEventService,
                               AlertEngine alertEngine) {
        this.dataSource = dataSource;
        this.appEventService = appEventService;
        this.alertEngine = alertEngine;
    }

    /** Every 30 min from 6:15 AM to 11:45 PM CT. Staggered 15 min from DailySync. */
    @Scheduled(cron = "0 15,45 6-23 * * *", zone = "America/Chicago")
    public void checkAndSync() {
        LocalDate yesterday = LocalDate.now(CHICAGO).minusDays(1);

        // Skip only when every day in the lookback window is already complete —
        // non-zero readings, not raw rows. Otherwise sync from the earliest gap.
        Optional<LocalDate> earliest = findEarliestIncompleteDay(yesterday, LOOKBACK_DAYS);
        if (earliest.isEmpty()) {
            log.info("HourlySyncScheduler: {} already complete — skipping", yesterday);
            return;
        }

        LocalDate start = earliest.get();
        String label = start.equals(yesterday) ? start.toString() : start + " → " + yesterday;

        // Snapshot yesterday before syncing: total rows, non-zero readings, and total kWh.
        DaySnapshot before = readDay(yesterday.toString());
        log.info("HourlySyncScheduler: syncing hourly data for {} (have {} non-zero of {} rows · {} kWh)…",
                label, before.nonZero(), before.total(), fmtKwh(before.totalKwh()));

        // Data integrity: a single meter+provider day should never exceed 24 rows.
        if (before.total() > EXPECTED_ROWS_PER_DAY) {
            appEventService.warn("sync", "HourlySyncScheduler",
                    "Hourly sync " + yesterday + ": " + before.total()
                            + " rows for one day — expected at most " + EXPECTED_ROWS_PER_DAY);
        }

        appEventService.info("sync", "HourlySyncScheduler",
                "Hourly sync " + label + ": starting (have " + before.nonZero()
                        + "/24 non-zero · " + fmtKwh(before.totalKwh()) + " kWh)");

        try {
            StringBuilder output = new StringBuilder();
            int exitCode = spawn(hourlyCommand(start, yesterday), output);
            String fullOutput = output.toString().trim();
            // Keep a short tail for the container log, the full text for the event details column.
            String tail = fullOutput.length() > 500
                    ? "…\n" + fullOutput.substring(fullOutput.length() - 500) : fullOutput;
            String details = fullOutput.length() > 4000
                    ? "…\n" + fullOutput.substring(fullOutput.length() - 4000) : fullOutput;

            DaySnapshot after = readDay(yesterday.toString());

            if (exitCode == 0) {
                if (start.equals(yesterday)) {
                    emitSyncResult(yesterday.toString(), after, details);
                } else {
                    emitBackfillResult(start, yesterday, details);
                }
                // Generate alerts with whatever data we have
                alertEngine.generateForAllUsers();
            } else {
                appEventService.log("sync", "WARN", "HourlySyncScheduler",
                        "Hourly sync exited " + exitCode + " for " + label, details);
                log.warn("HourlySyncScheduler stderr: {}", tail);
            }

            log.info("HourlySyncScheduler output: {}", tail);
        } catch (Exception e) {
            log.error("HourlySyncScheduler failed", e);
            appEventService.error("sync", "HourlySyncScheduler",
                    "Hourly sync failed for " + label, e.getMessage());
        }
    }

    /**
     * Manually sync an explicit date range (force — no completeness skip).
     * Dates are ISO {@code yyyy-MM-dd}; a single day runs {@code --date}, a
     * range runs {@code --start}/{@code --end}.
     */
    public void runSyncForRange(String startIso, String endIso) {
        String start = toUsDate(startIso);
        String end = toUsDate(endIso);
        String label = start.equals(end) ? start : start + " → " + end;

        appEventService.info("sync", "HourlySyncScheduler",
                "Hourly sync " + label + ": starting (manual)");

        List<String> command = hourlyCommand(LocalDate.parse(startIso), LocalDate.parse(endIso));

        try {
            StringBuilder output = new StringBuilder();
            int exitCode = spawn(command, output);
            String full = output.toString().trim();
            String details = full.length() > 4000
                    ? "…\n" + full.substring(full.length() - 4000) : full;

            if (exitCode == 0) {
                appEventService.log("sync", "INFO", "HourlySyncScheduler",
                        "Hourly sync " + label + ": completed ✓", details);
            } else {
                appEventService.log("sync", "WARN", "HourlySyncScheduler",
                        "Hourly sync " + label + ": exited " + exitCode, details);
                log.warn("HourlySyncScheduler manual stderr: {}", details);
            }
            alertEngine.generateForAllUsers();
        } catch (Exception e) {
            log.error("HourlySyncScheduler manual sync failed", e);
            appEventService.error("sync", "HourlySyncScheduler",
                    "Hourly sync " + label + " failed", e.getMessage());
        }
    }

    /** Spawn a child process, capturing merged stdout+stderr into {@code output}. Returns exit code. */
    private int spawn(List<String> command, StringBuilder output) throws Exception {
        ProcessBuilder pb = new ProcessBuilder(command);
        pb.redirectErrorStream(true);
        Process process = pb.start();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(process.getInputStream()))) {
            String line;
            while ((line = reader.readLine()) != null) {
                output.append(line).append("\n");
            }
        }
        return process.waitFor();
    }

    private static String toUsDate(String iso) {
        return LocalDate.parse(iso).format(US_DATE);
    }

    /** Build the sync.js invocation for a (possibly single-day) date range. */
    private List<String> hourlyCommand(LocalDate start, LocalDate end) {
        String startUs = start.format(US_DATE);
        String endUs = end.format(US_DATE);
        return start.equals(end)
                ? List.of("node", "/scripts/sync.js", "--granularity", "hourly", "--date", startUs)
                : List.of("node", "/scripts/sync.js", "--granularity", "hourly", "--start", startUs, "--end", endUs);
    }

    /**
     * Find the earliest day in the last {@code windowDays} days (through
     * {@code yesterday}) that is not complete — fewer than
     * {@link #COMPLETE_NONZERO_THRESHOLD} non-zero hours, or absent entirely.
     * Empty when every day is complete. Backfills gaps left by server downtime,
     * bounded by CoServ's ~2-week retention window.
     */
    private Optional<LocalDate> findEarliestIncompleteDay(LocalDate yesterday, int windowDays) {
        LocalDate first = yesterday.minusDays(windowDays - 1);
        Map<LocalDate, Integer> nonZeroByDay = new HashMap<>();
        try (var conn = dataSource.getConnection();
             var stmt = conn.prepareStatement(
                     "SELECT timestamp::date AS day, COUNT(*) FILTER (WHERE usage_kwh > 0) AS nonzero " +
                     "FROM hourly_electric_usage " +
                     "WHERE source_provider = 'coserv' AND timestamp::date >= ?::date AND timestamp::date <= ?::date " +
                     "GROUP BY timestamp::date")) {
            stmt.setString(1, first.toString());
            stmt.setString(2, yesterday.toString());
            try (var rs = stmt.executeQuery()) {
                while (rs.next()) nonZeroByDay.put(rs.getDate(1).toLocalDate(), rs.getInt(2));
            }
        } catch (Exception e) {
            log.warn("HourlySyncScheduler backfill scan failed: {}", e.getMessage());
            return Optional.empty();
        }

        LocalDate missing = null;
        for (LocalDate d = yesterday; !d.isBefore(first); d = d.minusDays(1)) {
            if (nonZeroByDay.getOrDefault(d, 0) < COMPLETE_NONZERO_THRESHOLD) missing = d;
        }
        return Optional.ofNullable(missing);
    }

    /** Read a day's row count, non-zero reading count, and total kWh in one query. */
    private DaySnapshot readDay(String date) {
        try (var conn = dataSource.getConnection();
             var stmt = conn.prepareStatement(
                     "SELECT COUNT(*), " +
                     "       COUNT(*) FILTER (WHERE usage_kwh > 0), " +
                     "       COALESCE(SUM(usage_kwh), 0) " +
                     "FROM hourly_electric_usage " +
                     "WHERE source_provider = 'coserv' AND timestamp::date = ?::date")) {
            stmt.setString(1, date);
            try (var rs = stmt.executeQuery()) {
                if (rs.next()) {
                    return new DaySnapshot(rs.getInt(1), rs.getInt(2), rs.getDouble(3));
                }
            }
        } catch (Exception e) {
            log.warn("HourlySyncScheduler day snapshot failed: {}", e.getMessage());
        }
        return new DaySnapshot(0, 0, 0.0);
    }

    /**
     * Emit the post-sync result as an app event. A too-large row count breaks the
     * 24-row-per-day invariant and is a genuine WARN. An incomplete day (CoServ
     * hasn't posted all of yesterday's intervals yet) is an EXPECTED mid-day state
     * that the scheduler retries on its own, so it is logged at INFO — a partial
     * result is not a failure and shouldn't read as a warning in the event feed.
     */
    private void emitSyncResult(String date, DaySnapshot day, String details) {
        int zeros = day.total() - day.nonZero();

        if (day.total() > EXPECTED_ROWS_PER_DAY) {
            appEventService.log("sync", "WARN", "HourlySyncScheduler",
                    "Hourly sync " + date + ": " + day.total() + " rows — expected at most "
                            + EXPECTED_ROWS_PER_DAY + " ⚠ (data integrity)", details);
        } else if (day.nonZero() >= COMPLETE_NONZERO_THRESHOLD) {
            appEventService.log("sync", "INFO", "HourlySyncScheduler",
                    "Hourly sync " + date + ": " + day.nonZero() + "/24 non-zero · "
                            + fmtKwh(day.totalKwh()) + " kWh ✓", details);
        } else if (zeros > 0) {
            appEventService.log("sync", "INFO", "HourlySyncScheduler",
                    "Hourly sync " + date + ": " + day.nonZero() + "/24 non-zero so far ("
                            + zeros + " not posted yet) · " + fmtKwh(day.totalKwh())
                            + " kWh — will retry when CoServ posts the rest", details);
        } else {
            appEventService.log("sync", "INFO", "HourlySyncScheduler",
                    "Hourly sync " + date + ": " + day.nonZero() + "/24 readings so far · "
                            + fmtKwh(day.totalKwh()) + " kWh — waiting on CoServ (will retry)", details);
        }
    }

    /** Emit a single result event for a multi-day backfill; per-day detail lives in {@code details}. */
    private void emitBackfillResult(LocalDate start, LocalDate end, String details) {
        appEventService.log("sync", "INFO", "HourlySyncScheduler",
                "Hourly backfill " + start + " → " + end + ": completed ✓ (backfilled missed days)", details);
    }

    private static String fmtKwh(double kwh) {
        return String.format("%.2f", kwh);
    }

    /** Row count, non-zero readings, and total kWh for a single calendar day. */
    private record DaySnapshot(int total, int nonZero, double totalKwh) {}
}
