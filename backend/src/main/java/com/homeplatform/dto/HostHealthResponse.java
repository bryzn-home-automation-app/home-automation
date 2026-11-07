package com.homeplatform.dto;

import java.time.Instant;
import java.util.List;

/**
 * Admin → NUC Health, right now.
 *
 * @param status       ONLINE (a sample in the last 5 minutes), OFFLINE (the monitor stopped
 *                     reporting) or NOT_SET_UP (it never has)
 * @param lastReportAt the newest sample's time
 * @param latest       the newest sample in full; null until one arrives after a backend restart
 * @param checks       problems worth acting on, worst first; empty when all is well
 * @param app          this app's own footprint: database and backend
 */
public record HostHealthResponse(
        String status,
        Instant lastReportAt,
        Instant now,
        HostSnapshot latest,
        List<Check> checks,
        AppStats app) {

    /** {@code level}: critical or warning. {@code key} groups a kind (disk, docker, …). */
    public record Check(String key, String level, String title, String detail) {}

    public record AppStats(Long databaseBytes, List<TableSize> largestTables, Long heapUsedBytes,
                           Long heapMaxBytes, Long uptimeSeconds, Integer threads, Long samplesStored) {}

    public record TableSize(String name, Long bytes) {}
}
