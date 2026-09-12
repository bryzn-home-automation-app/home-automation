package com.homeplatform.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Syncs CoServ combined electric+gas bill PDFs from SmartHub Billing History once a day.
 *
 * <p>The bill arrives roughly monthly and its exact posting date isn't known in
 * advance, so this runs daily like {@link WaterBillSyncScheduler};
 * {@code scripts/sync-coserv-bill.js} upserts on (account, billing period), so
 * re-running before the next bill lands is a cheap no-op.
 *
 * <p>To keep the Debug Dashboard quiet, an {@code app_events} row is written only
 * when the sync actually wrote a bill or errored — ordinary no-op days log at
 * debug level only.
 */
@Service
public class CoservBillSyncScheduler {

    private static final Logger log = LoggerFactory.getLogger(CoservBillSyncScheduler.class);
    private static final Pattern WRITTEN = Pattern.compile("(\\d+)\\s+(?:row\\(s\\)\\s+)?written");

    private final AppEventService appEventService;

    public CoservBillSyncScheduler(AppEventService appEventService) {
        this.appEventService = appEventService;
    }

    /** Once a day at 11:30 AM CT — offset from the electric/gas/water syncs so logins don't overlap. */
    @Scheduled(cron = "0 30 11 * * *", zone = "America/Chicago")
    public void runCoservBillSync() {
        try {
            StringBuilder output = new StringBuilder();
            int exit = spawn(List.of("node", "/scripts/sync-coserv-bill.js"), output);
            String full = output.toString();
            String tail = full.length() > 2000 ? "…\n" + full.substring(full.length() - 2000) : full;
            int written = parseWritten(full);

            if (exit != 0) {
                appEventService.log("sync", "WARN", "CoservBillSyncScheduler",
                        "CoServ bill sync exited " + exit, tail);
                log.warn("CoservBillSyncScheduler stderr: {}", tail);
            } else if (written > 0) {
                appEventService.log("sync", "INFO", "CoservBillSyncScheduler",
                        "CoServ bill sync wrote " + written + " bill(s)", tail);
                log.info("CoservBillSyncScheduler: wrote {} CoServ bill row(s)", written);
            } else {
                // No new bill this run — stay silent in app_events to avoid daily noise.
                log.info("CoservBillSyncScheduler: ran, no new CoServ bill (0 rows written)");
            }
        } catch (Exception e) {
            log.error("CoservBillSyncScheduler failed", e);
            appEventService.error("sync", "CoservBillSyncScheduler", "CoServ bill sync failed", e.getMessage());
        }
    }

    /** Rows the child reported writing, or 0 if the output has no "written" line. */
    static int parseWritten(String output) {
        if (output == null) return 0;
        int max = 0;
        Matcher m = WRITTEN.matcher(output);
        while (m.find()) {
            try {
                max = Math.max(max, Integer.parseInt(m.group(1)));
            } catch (NumberFormatException ignored) {
                // skip
            }
        }
        return max;
    }

    /** Spawn a child process, capturing merged stdout+stderr into {@code output}. Returns exit code. */
    int spawn(List<String> command, StringBuilder output) throws Exception {
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
}
