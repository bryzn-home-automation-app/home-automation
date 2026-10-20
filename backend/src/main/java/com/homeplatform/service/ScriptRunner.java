package com.homeplatform.service;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.time.Duration;
import java.util.List;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Runs a sync script (node + Playwright) with a hard deadline. Without one, a hung
 * headless browser or a stalled SmartHub request blocked readLine/waitFor forever —
 * and since the schedulers run on fixed crons, that scheduler never ran again until
 * the container restarted.
 */
public final class ScriptRunner {

    /** Generous: a multi-week admin backfill is the slowest legitimate run. */
    public static final Duration DEFAULT_TIMEOUT = Duration.ofMinutes(30);

    /** Exit code reported when the deadline killed the script (same as coreutils timeout). */
    public static final int TIMED_OUT = 124;

    private static final ScheduledExecutorService WATCHDOG = Executors.newSingleThreadScheduledExecutor(r -> {
        Thread t = new Thread(r, "script-watchdog");
        t.setDaemon(true);
        return t;
    });

    private ScriptRunner() {}

    /** {@link #run(List, StringBuilder, Duration)} with {@link #DEFAULT_TIMEOUT}. */
    public static int run(List<String> command, StringBuilder output) throws Exception {
        return run(command, output, DEFAULT_TIMEOUT);
    }

    /**
     * Spawn the command, capturing merged stdout+stderr into {@code output}. Returns the
     * exit code, or {@link #TIMED_OUT} after killing a script that ran past {@code timeout}.
     */
    public static int run(List<String> command, StringBuilder output, Duration timeout) throws Exception {
        ProcessBuilder pb = new ProcessBuilder(command);
        pb.redirectErrorStream(true);
        Process process = pb.start();
        AtomicBoolean killed = new AtomicBoolean();
        // Killing the process closes its stdout, which also unblocks readLine below.
        ScheduledFuture<?> watchdog = WATCHDOG.schedule(() -> {
            if (process.isAlive()) {
                killed.set(true);
                process.descendants().forEach(ProcessHandle::destroyForcibly);
                process.destroyForcibly();
            }
        }, timeout.toMillis(), TimeUnit.MILLISECONDS);
        try {
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(process.getInputStream()))) {
                String line;
                while ((line = reader.readLine()) != null) {
                    output.append(line).append("\n");
                }
            }
            if (!process.waitFor(timeout.toMillis(), TimeUnit.MILLISECONDS)) {
                killed.set(true);
                process.destroyForcibly();
            }
        } finally {
            watchdog.cancel(false);
        }
        if (killed.get()) {
            output.append("[killed: still running after ").append(timeout.toMinutes()).append(" min]\n");
            return TIMED_OUT;
        }
        return process.exitValue();
    }
}
