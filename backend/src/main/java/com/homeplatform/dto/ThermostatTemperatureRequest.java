package com.homeplatform.dto;

/**
 * Either {@code temperature} (heat or cool mode) or {@code low}+{@code high}
 * (heat_cool/auto range), in the thermostat's unit.
 */
public record ThermostatTemperatureRequest(Double temperature, Double low, Double high) {}
