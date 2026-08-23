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
 * Syncs NATURAL GAS usage from CoServ once a day.
 *
 * <p>Unlike electric, CoServ exposes gas ONLY as a monthly billing figure — there
 * is no daily/hourly interval gas data — so this shells out to the dedicated
 * {@code scripts/sync-gas.js} (MONTHLY poll → {@code gas_usage}) rather than the
 * electric {@code sync.js}. It runs daily because the billing-post date isn't yet
 * known; the script upserts, so re-running before the next cycle is a cheap no-op.
 *
 * <p>To keep the Debug Dashboard quiet, an {@code app_events} row is written only
 * when the sync actually wrote a reading or errored — ordinary no-op days log at
 * debug level only.
 */
@Service
public class GasSyncScheduler {

    private static final Logger log = LoggerFactory.getLogger(GasSyncScheduler.class);
    private static final Pattern WRITTEN = Pattern.compile("(\\d+)\\s+(?:row\\(s\\)\\s+)?written");

    private final AppEventService appEventService;

    public GasSyncScheduler(AppEventService appEventService) {
        this.appEventService = appEventService;
    }

    /** Once a day at 10:30 AM CT — after CoServ's morning posting window, offset
     *  from the electric syncs so the browser logins don't overlap. */
    @Scheduled(cron = "0 30 10 * * *", zone = "America/Chicago")
    public void runGasSync() {
        try {
            StringBuilder output = new StringBuilder();
            int exit = spawn(List.of("node", "/scripts/sync-gas.js"), output);
            String full = output.toString();
            String tail = full.length() > 2000 ? "…\n" + full.substring(full.length() - 2000) : full;
            int written = parseWritten(full);

            if (exit != 0) {
                appEventService.log("sync", "WARN", "GasSyncScheduler",
                        "Gas sync exited " + exit, tail);
                log.warn("GasSyncScheduler stderr: {}", tail);
            } else if (written > 0) {
                appEventService.log("sync", "INFO", "GasSyncScheduler",
                        "Gas sync wrote " + written + " monthly reading(s)", tail);
                log.info("GasSyncScheduler: wrote {} gas row(s)", written);
            } else {
                // No new gas data this run — stay silent in app_events to avoid daily noise.
                log.info("GasSyncScheduler: ran, no new gas data (0 rows written)");
            }
        } catch (Exception e) {
            log.error("GasSyncScheduler failed", e);
            appEventService.error("sync", "GasSyncScheduler", "Gas sync failed", e.getMessage());
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
