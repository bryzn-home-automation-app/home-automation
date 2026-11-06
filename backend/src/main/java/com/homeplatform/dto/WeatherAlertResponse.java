package com.homeplatform.dto;

import com.homeplatform.service.WeatherAlertRule.Option;

import java.util.List;

/**
 * One weather alert with this member's settings. {@code inApp}/{@code push} work like every
 * other alert type. The forecast alerts ({@code scheduled}) are checked daily at
 * {@code checkAt} for the hours until {@code until} ("HH:mm", Central time); {@code threshold}
 * is one of {@code thresholdOptions}, or null for alerts without a limit.
 */
public record WeatherAlertResponse(
        String type,
        String label,
        String description,
        boolean inApp,
        boolean push,
        boolean scheduled,
        String checkAt,
        String until,
        Integer threshold,
        String thresholdLabel,
        List<Option> thresholdOptions
) {}
