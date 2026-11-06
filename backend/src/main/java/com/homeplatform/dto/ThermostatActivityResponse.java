package com.homeplatform.dto;

/** One change someone made to a thermostat, for the activity log: which thermostat, and the change. */
public record ThermostatActivityResponse(
        String thermostatId,
        String thermostat,
        ThermostatChangeResponse change
) {}
