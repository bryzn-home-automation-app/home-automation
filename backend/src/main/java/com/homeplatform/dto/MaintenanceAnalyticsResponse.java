package com.homeplatform.dto;

import java.math.BigDecimal;
import java.util.List;
import java.util.Map;

public record MaintenanceAnalyticsResponse(
        long openCount,
        long scheduledCount,
        long completedCount,
        BigDecimal totalLifetimeCost,
        BigDecimal thisYearCost,
        BigDecimal averageMonthlyCost,
        String lastActivity,
        String lastActivityDate,
        List<Map<String, Object>> costByYear,
        List<Map<String, Object>> costByCategory,
        List<Map<String, Object>> topExpensive
) {}
