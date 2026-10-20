package com.homeplatform.homeassistant;

import java.time.Instant;
import java.util.List;

/**
 * Normalized thermostat state, independent of HA's attribute names. Any field may be
 * null when HA doesn't report it or reports something invalid. Temperatures are in
 * {@code temperatureUnit} (HA's configured unit — °F for this home).
 */
public record ThermostatSnapshot(
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
        Instant recordedAt
) {}
