package com.homeplatform.dto;

import java.time.Instant;
import java.util.List;

/**
 * NUC Health over a range (24h, 7d or 30d), averaged into {@code bucketMinutes} buckets.
 * A bucket with no sample has nulls, so a chart shows the gap instead of bridging it.
 *
 * @param firstSampleAt the oldest sample in the range: when it's recent, the monitor is new
 * @param gaps          stretches of 5+ minutes without a sample (NUC off, asleep or frozen,
 *                      or the backend down), oldest first
 */
public record HostHistoryResponse(
        String range,
        int bucketMinutes,
        Instant from,
        Instant to,
        Instant firstSampleAt,
        List<Point> points,
        Summary summary,
        List<Gap> gaps) {

    /** Averages over the bucket, except {@code cpuMax} (its busiest minute). Network in Mbps. */
    public record Point(Instant t, Double cpuAvg, Double cpuMax, Double memPct, Double cpuTempC,
                        Double diskTempC, Double rxMbps, Double txMbps) {}

    /** Over the whole range. {@code rxBytes}/{@code txBytes}: the home network traffic in total. */
    public record Summary(int samples, Double cpuAvg, Double cpuPeak, Double memAvgPct, Double memPeakPct,
                          Double cpuTempPeak, Double rxBytes, Double txBytes) {}

    /** {@code restarted}: Windows started again during the gap. */
    public record Gap(Instant from, Instant to, long minutes, boolean restarted) {}
}
