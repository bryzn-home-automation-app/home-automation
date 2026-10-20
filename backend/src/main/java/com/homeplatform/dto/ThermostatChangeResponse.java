package com.homeplatform.dto;

import java.util.List;

/**
 * Who changed a thermostat and to what. {@code actor}: {@code app} (a user of this app —
 * {@code by} is their display name, {@code byUserId} their ID), {@code home_assistant}, or {@code ecobee} (the
 * thermostat, the ecobee app, or its schedule). {@code fields} ⊆ setpoint, mode, preset.
 * Values are the state after the change; {@code at} is a UTC ISO-8601 string.
 */
public record ThermostatChangeResponse(
        String at,
        String actor,
        String by,
        Long byUserId,
        List<String> fields,
        String hvacMode,
        String presetMode,
        Double targetTemperature,
        Double heatSetpoint,
        Double coolSetpoint
) {}
