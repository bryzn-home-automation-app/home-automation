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
 * Runs the daily sync once per day at 5:15 AM CT.
 * Downloads Green Button daily data from CoServ and writes to electric_usage.
 * Complements the {@link HourlySyncScheduler} which writes to hourly_electric_usage —
 * together they provide two independent data sources for reconciliation.
 */
@Service
public class DailySyncScheduler {

    private static final Logger log = LoggerFactory.getLogger(DailySyncScheduler.class);
    private static final ZoneId CHICAGO = ZoneId.of("America/Chicago");

    private final AppEventService appEventService;
    private final AlertEngine alertEngine;

    public DailySyncScheduler(AppEventService appEventService, AlertEngine alertEngine) {
        this.appEventService = appEventService;
        this.alertEngine = alertEngine;
    }

    /** Once daily at 5:15 AM CT — after CoServ posts the previous day's Green Button data. */
    @Scheduled(cron = "0 15 5 * * *", zone = "America/Chicago")
    public void runDailySync() {
        String yesterday = LocalDate.now(CHICAGO).minusDays(1).format(DateTimeFormatter.ISO_LOCAL_DATE);
        log.info("DailySyncScheduler: starting daily sync for {}…", yesterday);

        appEventService.info("sync", "DailySyncScheduler",
                "Starting daily sync (Green Button) for " + yesterday);

        try {
            String dateArg = LocalDate.now(CHICAGO).minusDays(1)
                    .format(DateTimeFormatter.ofPattern("MM/dd/yyyy"));

            ProcessBuilder pb = new ProcessBuilder(
                    "node", "/scripts/sync.js",
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
                appEventService.info("sync", "DailySyncScheduler",
                        "Daily sync completed for " + yesterday + " — " + lastLines.lines()
                                .filter(l -> l.contains("records, total"))
                                .findFirst().orElse("ok"));
            } else {
                appEventService.warn("sync", "DailySyncScheduler",
                        "Daily sync exited " + exitCode + " for " + yesterday);
                log.warn("DailySyncScheduler stderr: {}", lastLines);
            }

            log.info("DailySyncScheduler output: {}", lastLines);
        } catch (Exception e) {
            log.error("DailySyncScheduler failed", e);
            appEventService.error("sync", "DailySyncScheduler",
                    "Daily sync failed for " + yesterday, e.getMessage());
        }
    }
}
