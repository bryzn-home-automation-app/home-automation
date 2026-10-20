package com.homeplatform.dto;

/** {@code mode}: one of the thermostat's supported HVAC modes (e.g. off, heat, cool, heat_cool). */
public record ThermostatModeRequest(String mode) {}
