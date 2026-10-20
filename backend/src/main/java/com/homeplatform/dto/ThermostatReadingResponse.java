package com.homeplatform.dto;

/** One history point. {@code recordedAt} is a UTC ISO-8601 string (with 'Z'). */
public record ThermostatReadingResponse(
        String recordedAt,
        Double temperature,
        Double humidity,
        Double targetTemperature,
        Double heatSetpoint,
        Double coolSetpoint,
        String hvacMode,
        String hvacAction,
        String presetMode,
        String source
) {}
