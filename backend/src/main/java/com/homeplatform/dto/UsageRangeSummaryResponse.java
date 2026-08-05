package com.homeplatform.dto;

import java.time.LocalDateTime;

public record UsageRangeSummaryResponse(
        Long meterId,
        LocalDateTime start,
        LocalDateTime end,
        double totalKwh,
        double averageKwh,
        long readingCount,
        UsagePoint highest,
        UsagePoint lowest
) {
    public record UsagePoint(
            LocalDateTime timestamp,
            double usageKwh
    ) {}
}