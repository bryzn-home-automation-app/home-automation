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
import java.util.List;

/**
 * Runs the daily sync every 30 min from 6:30 AM to 11:45 PM CT.
 * Downloads Green Button daily data from CoServ and writes to electric_usage.
 * Skips if yesterday's daily reading is already populated (idempotent).
 *
 * Complements the {@link HourlySyncScheduler} which writes to hourly_electric_usage —
 * together they provide two independent data sources for reconciliation.
 */
@Service
public class DailySyncScheduler {

    private static final Logger log = LoggerFactory.getLogger(DailySyncScheduler.class);
    private static final ZoneId CHICAGO = ZoneId.of("America/Chicago");
    private static final DateTimeFormatter US_DATE = DateTimeFormatter.ofPattern("MM/dd/yyyy");

    private final DataSource dataSource;
    private final AppEventService appEventService;
    private final AlertEngine alertEngine;

    public DailySyncScheduler(DataSource dataSource, AppEventService appEventService, AlertEngine alertEngine) {
        this.dataSource = dataSource;
        this.appEventService = appEventService;
        this.alertEngine = alertEngine;
    }

    /** Every 30 min from 6:30 AM to 11:45 PM CT. Same window as hourly but
     *  offset by 15 min to avoid both browser logins at the exact same second. */
    @Scheduled(cron = "0 0,30 6-23 * * *", zone = "America/Chicago")
    public void runDailySync() {
        String yesterday = LocalDate.now(CHICAGO).minusDays(1).format(DateTimeFormatter.ISO_LOCAL_DATE);
        log.info("DailySyncScheduler: checking for {}…", yesterday);

        // Skip if yesterday already has a non-zero daily reading
        if (isYesterdayPopulated(yesterday)) {
            log.info("DailySyncScheduler: {} already populated — skipping", yesterday);
            return;
        }

        appEventService.info("sync", "DailySyncScheduler",
                "Starting daily sync (Green Button) for " + yesterday);

        String dateArg = LocalDate.now(CHICAGO).minusDays(1).format(US_DATE);
        runSync(List.of("node", "/scripts/sync.js", "--date", dateArg), yesterday);
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
                "Starting manual daily sync (Green Button) for " + label);

        List<String> command = start.equals(end)
                ? List.of("node", "/scripts/sync.js", "--date", start)
                : List.of("node", "/scripts/sync.js", "--start", start, "--end", end);

        runSync(command, label);
    }

    /** Spawn sync.js and record the result as an app event (with full output in details). */
    private void runSync(List<String> command, String label) {
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

    /** Extract a human-readable summary line (per-service record counts / no-data) from script output. */
    private String summarize(String output) {
        String summary = output.lines()
                .map(String::trim)
                .filter(l -> l.contains("records written") || l.contains("No usage data") || l.contains("records (dry-run)"))
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

    private boolean isYesterdayPopulated(String date) {
        try (var conn = dataSource.getConnection();
             var stmt = conn.prepareStatement(
                     "SELECT 1 FROM electric_usage WHERE timestamp::date = ?::date AND usage_kwh > 0 LIMIT 1")) {
            stmt.setString(1, date);
            try (var rs = stmt.executeQuery()) {
                return rs.next();
            }
        } catch (Exception e) {
            log.warn("DailySyncScheduler DB check failed: {}", e.getMessage());
            return false;
        }
    }
}
