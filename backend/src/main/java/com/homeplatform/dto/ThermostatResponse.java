package com.homeplatform.dto;

import java.util.List;

/**
 * Current thermostat state. {@code id} is the stable app device ID — never the HA
 * entity ID. Temperatures are in {@code temperatureUnit}; any reading may be null
 * (unavailable/unknown in HA). {@code updatedAt} is a UTC ISO-8601 string.
 */
public record ThermostatResponse(
        String id,
        String name,
        boolean available,
        Double temperature,
        Double humidity,
        Double targetTemperature,
        Double heatSetpoint,
        Double coolSetpoint,
        String hvacMode,
        String hvacAction,
        String presetMode,
        String temperatureUnit,
        Double minTemp,
        Double maxTemp,
        List<String> hvacModes,
        List<String> presetModes,
        String updatedAt
) {}
