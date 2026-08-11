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
 * Polls every 30 minutes between 5 AM and 11 PM CT to backfill yesterday's
 * hourly electric data if missing. Spawns sync-hourly.js as a child process.
 */
@Service
public class HourlySyncScheduler {

    private static final Logger log = LoggerFactory.getLogger(HourlySyncScheduler.class);
    private static final ZoneId CHICAGO = ZoneId.of("America/Chicago");

    private final DataSource dataSource;
    private final AppEventService appEventService;
    private final AlertEngine alertEngine;

    public HourlySyncScheduler(DataSource dataSource, AppEventService appEventService,
                               AlertEngine alertEngine) {
        this.dataSource = dataSource;
        this.appEventService = appEventService;
        this.alertEngine = alertEngine;
    }

    /** Every 30 minutes on the half-hour from 5 AM to 11 PM CT. */
    @Scheduled(cron = "0 0,15,30,45 5-23 * * *", zone = "America/Chicago")
    public void checkAndSync() {
        String yesterday = LocalDate.now(CHICAGO).minusDays(1).format(DateTimeFormatter.ISO_LOCAL_DATE);
        log.info("HourlySyncScheduler: checking for {}…", yesterday);

        boolean populated = isDatePopulated(yesterday);
        if (populated) {
            log.info("HourlySyncScheduler: {} already populated — skipping", yesterday);
            return;
        }

        appEventService.info("sync", "HourlySyncScheduler",
                "Yesterday (" + yesterday + ") not populated — starting hourly sync");

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

            if (exitCode == 0) {
                appEventService.info("sync", "HourlySyncScheduler",
                        "Sync completed for " + yesterday + " — " + lastLines.lines()
                                .filter(l -> l.contains("records, total"))
                                .findFirst().orElse("ok"));
                // Generate alerts from fresh data
                alertEngine.generateForAllUsers();
            } else {
                appEventService.warn("sync", "HourlySyncScheduler",
                        "Sync exited " + exitCode + " for " + yesterday);
                log.warn("HourlySyncScheduler stderr: {}", lastLines);
            }

            log.info("HourlySyncScheduler output: {}", lastLines);
        } catch (Exception e) {
            log.error("HourlySyncScheduler failed", e);
            appEventService.error("sync", "HourlySyncScheduler",
                    "Sync failed for " + yesterday, e.getMessage());
        }
    }

    private boolean isDatePopulated(String date) {
        try (var conn = dataSource.getConnection();
             var stmt = conn.prepareStatement(
                     "SELECT 1 FROM hourly_electric_usage WHERE timestamp::date = ?::date AND usage_kwh > 0 LIMIT 1")) {
            stmt.setString(1, date);
            try (var rs = stmt.executeQuery()) {
                return rs.next();
            }
        } catch (Exception e) {
            log.warn("HourlySyncScheduler DB check failed: {}", e.getMessage());
            return false;
        }
    }
}
