package com.homeplatform.dto;

import java.time.LocalDate;

/**
 * Pre-aggregated daily kWh from hourly records. Used by the chart endpoints
 * to deliver ~60 rows instead of 1,440+ individual hourly records.
 */
public record DailyUsagePoint(
        LocalDate date,
        double totalKwh,
        int readingCount,
        String sourceProvider
) {}
