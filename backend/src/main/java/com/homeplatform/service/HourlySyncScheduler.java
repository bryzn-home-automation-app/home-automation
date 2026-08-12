package com.homeplatform.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;

/**
 * Syncs yesterday's hourly electric data from the CoServ Average Usage API.
 * Runs twice daily: 6:15 AM CT (primary — all 24 hours should be posted)
 * and 12:15 PM CT (safety net for gaps). Always syncs — ON CONFLICT DO UPDATE
 * handles idempotency in sync-hourly.js.
 */
@Service
public class HourlySyncScheduler {

    private static final Logger log = LoggerFactory.getLogger(HourlySyncScheduler.class);
    private static final ZoneId CHICAGO = ZoneId.of("America/Chicago");

    private final AppEventService appEventService;
    private final AlertEngine alertEngine;

    public HourlySyncScheduler(AppEventService appEventService,
                               AlertEngine alertEngine) {
        this.appEventService = appEventService;
        this.alertEngine = alertEngine;
    }

    /** Every 30 min from 6:15 AM to 11:45 PM CT — late enough for CoServ data, frequent enough to fill gaps. */
    @Scheduled(cron = "0 15,45 6-23 * * *", zone = "America/Chicago")
    public void checkAndSync() {
        String yesterday = LocalDate.now(CHICAGO).minusDays(1).format(DateTimeFormatter.ISO_LOCAL_DATE);
        log.info("HourlySyncScheduler: syncing hourly data for {}…", yesterday);

        appEventService.info("sync", "HourlySyncScheduler",
                "Starting hourly sync for " + yesterday);

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
                        "Hourly sync completed for " + yesterday + " — " + lastLines.lines()
                                .filter(l -> l.contains("records, total"))
                                .findFirst().orElse("ok"));
                // Generate alerts from fresh data
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
}
