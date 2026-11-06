package com.homeplatform.dto;

import java.util.List;

/**
 * Who changed a thermostat and to what. {@code actor}: {@code app} (a user of this app —
 * {@code by} is their display name, {@code byUserId} their ID), {@code home_assistant},
 * {@code ecobee} (someone at the thermostat or in the ecobee app), or {@code schedule}
 * (ecobee on its own: its schedule, Smart Home/Away, a hold ending).
 * {@code fields} ⊆ setpoint, mode, preset. Values are the state after the change;
 * {@code at} is a UTC ISO-8601 string.
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
