package com.homeplatform.homeassistant;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/** HA climate attributes → normalized snapshot. Fixtures mimic HA's climate state shape. */
class EntityMapperTest {

    private static final ObjectMapper JSON = new ObjectMapper();

    private static HaEntityState state(String json) throws Exception {
        return HaEntityState.fromJson(JSON.readTree(json));
    }

    @Test
    @DisplayName("heat mode: single target becomes the heat setpoint")
    void heatMode() throws Exception {
        var s = EntityMapper.toThermostat(state("""
                {"entity_id":"climate.main","state":"heat",
                 "attributes":{"current_temperature":68.4,"current_humidity":41,"temperature":70,
                   "hvac_action":"heating","preset_mode":"home","hvac_modes":["off","heat","cool","heat_cool"],
                   "preset_modes":["away","home","sleep"],"min_temp":45,"max_temp":92},
                 "last_updated":"2026-10-19T12:00:00+00:00"}"""), "°F");

        assertTrue(s.available());
        assertEquals(68.4, s.temperature());
        assertEquals(41.0, s.humidity());
        assertEquals(70.0, s.targetTemperature());
        assertEquals(70.0, s.heatSetpoint());
        assertNull(s.coolSetpoint());
        assertEquals("heat", s.hvacMode());
        assertEquals("heating", s.hvacAction());
        assertEquals("home", s.presetMode());
        assertEquals("°F", s.temperatureUnit());
        assertEquals(List.of("off", "heat", "cool", "heat_cool"), s.hvacModes());
        assertEquals(List.of("away", "home", "sleep"), s.presetModes());
        assertEquals(45.0, s.minTemp());
        assertEquals("2026-10-19T12:00:00Z", s.recordedAt().toString());
    }

    @Test
    @DisplayName("cool mode: single target becomes the cool setpoint")
    void coolMode() throws Exception {
        var s = EntityMapper.toThermostat(state("""
                {"entity_id":"climate.main","state":"cool","attributes":{"temperature":74}}"""), null);
        assertEquals(74.0, s.coolSetpoint());
        assertNull(s.heatSetpoint());
        assertEquals("°F", s.temperatureUnit(), "defaults to °F when HA unit unknown");
    }

    @Test
    @DisplayName("heat_cool mode: low/high range become heat/cool setpoints")
    void heatCoolMode() throws Exception {
        var s = EntityMapper.toThermostat(state("""
                {"entity_id":"climate.main","state":"heat_cool",
                 "attributes":{"temperature":null,"target_temp_low":68,"target_temp_high":76}}"""), "°F");
        assertNull(s.targetTemperature());
        assertEquals(68.0, s.heatSetpoint());
        assertEquals(76.0, s.coolSetpoint());
    }

    @Test
    @DisplayName("unavailable/unknown states produce no live readings")
    void unavailable() throws Exception {
        for (String st : List.of("unavailable", "unknown")) {
            var s = EntityMapper.toThermostat(state("""
                    {"entity_id":"climate.main","state":"%s","attributes":{"current_temperature":70,"hvac_modes":["heat"]}}"""
                    .formatted(st)), "°F");
            assertFalse(s.available(), st);
            assertNull(s.temperature());
            assertNull(s.hvacMode());
            assertEquals(List.of("heat"), s.hvacModes(), "capabilities retained");
        }
    }

    @Test
    @DisplayName("non-numeric, non-finite and implausible values become null")
    void invalidNumbers() throws Exception {
        var s = EntityMapper.toThermostat(state("""
                {"entity_id":"climate.main","state":"heat",
                 "attributes":{"current_temperature":"warm","current_humidity":140,"temperature":"NaN",
                   "min_temp":-500,"max_temp":"92.5","hvac_action":"unknown"}}"""), "°F");
        assertNull(s.temperature());
        assertNull(s.humidity());
        assertNull(s.targetTemperature());
        assertNull(s.minTemp());
        assertEquals(92.5, s.maxTemp(), "numeric strings are accepted");
        assertNull(s.hvacAction());
    }

    @Test
    @DisplayName("unknown hvac mode is dropped; missing attributes are tolerated")
    void unknownModeAndMissingAttributes() throws Exception {
        var s = EntityMapper.toThermostat(state("""
                {"entity_id":"climate.main","state":"turbo"}"""), "°C");
        assertTrue(s.available());
        assertNull(s.hvacMode());
        assertEquals("°C", s.temperatureUnit());
        assertEquals(List.of(), s.hvacModes());
        assertNotNull(s.recordedAt(), "falls back to now when HA omits timestamps");
    }

    @Test
    @DisplayName("state without entity_id is rejected")
    void missingEntityId() {
        assertThrows(HomeAssistantException.InvalidResponse.class, () -> state("{\"state\":\"heat\"}"));
    }
}
