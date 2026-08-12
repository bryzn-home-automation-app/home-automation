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

/**
 * Syncs yesterday's hourly electric data from the CoServ Average Usage API.
 * Every 30 min from 6:15 AM to 11:45 PM CT — late enough for data, frequent
 * enough to fill gaps. Only considers the day "complete" at 24 hours.
 */
@Service
public class HourlySyncScheduler {

    private static final Logger log = LoggerFactory.getLogger(HourlySyncScheduler.class);
    private static final ZoneId CHICAGO = ZoneId.of("America/Chicago");

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
        String yesterday = LocalDate.now(CHICAGO).minusDays(1).format(DateTimeFormatter.ISO_LOCAL_DATE);

        // Check current record count before syncing
        int beforeCount = countRecords(yesterday);
        log.info("HourlySyncScheduler: syncing hourly data for {} (currently {} records)…",
                yesterday, beforeCount);

        // Skip only if it's complete — 24 hours means we're done
        if (beforeCount >= 24) {
            log.info("HourlySyncScheduler: {} already has 24 records — skipping", yesterday);
            return;
        }

        appEventService.info("sync", "HourlySyncScheduler",
                "Starting hourly sync for " + yesterday + " (has " + beforeCount + " of 24 records)");

        try {
            String dateArg = LocalDate.now(CHICAGO).minusDays(1)
                    .format(DateTimeFormatter.ofPattern("MM/dd/yyyy"));

            ProcessBuilder pb = new ProcessBuilder(
                    "node", "/scripts/sync-hourly.js",
                    "--date", dateArg
            );
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
            String lastLines = output.toString();
            if (lastLines.length() > 500) {
                lastLines = "…\n" + lastLines.substring(lastLines.length() - 500);
            }

            int afterCount = countRecords(yesterday);

            if (exitCode == 0) {
                if (afterCount >= 24) {
                    appEventService.info("sync", "HourlySyncScheduler",
                            "Hourly sync complete for " + yesterday + " — " + afterCount
                                    + " records ✓ (24/24)");
                } else {
                    appEventService.warn("sync", "HourlySyncScheduler",
                            "Hourly sync partial for " + yesterday + " — " + afterCount
                                    + " of 24 records ⚠ (CoServ may not have posted all hours yet)");
                }
                // Generate alerts with whatever data we have
                alertEngine.generateForAllUsers();
            } else {
                appEventService.warn("sync", "HourlySyncScheduler",
                        "Hourly sync exited " + exitCode + " for " + yesterday);
                log.warn("HourlySyncScheduler stderr: {}", lastLines);
            }

            log.info("HourlySyncScheduler output: {}", lastLines);
        } catch (Exception e) {
            log.error("HourlySyncScheduler failed", e);
            appEventService.error("sync", "HourlySyncScheduler",
                    "Hourly sync failed for " + yesterday, e.getMessage());
        }
    }

    private int countRecords(String date) {
        try (var conn = dataSource.getConnection();
             var stmt = conn.prepareStatement(
                     "SELECT COUNT(*) FROM hourly_electric_usage WHERE timestamp::date = ?::date")) {
            stmt.setString(1, date);
            try (var rs = stmt.executeQuery()) {
                return rs.next() ? rs.getInt(1) : 0;
            }
        } catch (Exception e) {
            log.warn("HourlySyncScheduler record count check failed: {}", e.getMessage());
            return 0;
        }
    }
}
