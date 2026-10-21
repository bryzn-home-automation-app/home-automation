package com.homeplatform.homeassistant;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

class CameraLinkerTest {

    private static final ObjectMapper JSON = new ObjectMapper();

    static HaEntityState state(String id, String state, String deviceClass) throws Exception {
        String attrs = deviceClass == null ? "{}" : "{\"device_class\":\"" + deviceClass + "\"}";
        return HaEntityState.fromJson(JSON.readTree(
                "{\"entity_id\":\"" + id + "\",\"state\":\"" + state + "\",\"attributes\":" + attrs + "}"));
    }

    private static Map<String, HaEntityState> states(HaEntityState... s) {
        Map<String, HaEntityState> m = new HashMap<>();
        for (HaEntityState e : s) m.put(e.entityId(), e);
        return m;
    }

    @Test
    @DisplayName("picks battery, charging, motion and person siblings by device class / name")
    void linksSiblings() throws Exception {
        var m = states(
                state("camera.driveway", "idle", null),
                state("sensor.driveway_battery", "87", "battery"),
                // Real eufy-sdk entity: pack health also carries the battery class.
                state("sensor.driveway_battery_health", "91", "battery"),
                state("binary_sensor.driveway_charging", "on", "battery_charging"),
                state("binary_sensor.driveway_motion", "off", "motion"),
                state("binary_sensor.driveway_person", "off", "occupancy"),
                state("sensor.driveway_wifi_signal", "-60", "signal_strength"));
        String rendered = """
                [{"camera":"camera.driveway","serial":"T8170P20231234",
                  "entities":["sensor.driveway_battery_health","sensor.driveway_wifi_signal","binary_sensor.driveway_person","camera.driveway",
                              "sensor.driveway_battery","binary_sensor.driveway_motion",
                              "binary_sensor.driveway_charging","sensor.disabled_entity"]}]""";

        List<CameraLinker.Link> links = CameraLinker.parse(rendered, JSON, m);

        assertEquals(1, links.size());
        CameraLinker.Link l = links.get(0);
        assertEquals("camera.driveway", l.cameraEntityId());
        assertEquals("T8170P20231234", l.streamName());
        assertEquals("sensor.driveway_battery", l.batteryEntityId());
        assertEquals("binary_sensor.driveway_charging", l.chargingEntityId());
        assertEquals("binary_sensor.driveway_motion", l.motionEntityId());
        assertEquals("binary_sensor.driveway_person", l.personEntityId());
    }

    @Test
    @DisplayName("falls back to an enum charging sensor; wired camera has no battery; odd serials dropped")
    void fallbacks() throws Exception {
        var m = states(
                state("sensor.yard_battery", "55", "battery"),
                state("sensor.yard_charging_status", "Solar charging", "enum"),
                state("camera.indoor", "streaming", null));
        String rendered = """
                [{"camera":"camera.yard","serial":"T8170 P2","entities":["sensor.yard_charging_status","sensor.yard_battery"]},
                 {"camera":"camera.indoor","serial":null,"entities":[]},
                 {"camera":"not_a_camera","serial":"X","entities":[]}]""";

        List<CameraLinker.Link> links = CameraLinker.parse(rendered, JSON, m);

        assertEquals(2, links.size());
        assertEquals("sensor.yard_charging_status", links.get(0).chargingEntityId());
        assertNull(links.get(0).streamName(), "serial with a space is not a safe stream name");
        assertNull(links.get(1).batteryEntityId());
        assertNull(links.get(1).streamName());
    }

    static HaEntityState presetSelect(String id, String... options) throws Exception {
        String opts = String.join(",", java.util.Arrays.stream(options).map(o -> "\"" + o + "\"").toList());
        return HaEntityState.fromJson(JSON.readTree(
                "{\"entity_id\":\"" + id + "\",\"state\":\"" + options[0] + "\",\"attributes\":{\"options\":[" + opts + "]}}"));
    }

    @Test
    @DisplayName("pan/tilt controls and the preset select are linked; occupied slots parsed")
    void controlsAndPresets() throws Exception {
        var m = states(
                presetSelect("select.front_preset", "0 · HOME", "1", "2", "3 · empty"),
                state("button.front_go_to_preset", "unknown", null),
                state("button.front_pan_left", "unknown", null),
                state("button.front_pan_right", "unknown", null),
                state("button.front_tilt_up", "unknown", null),
                state("button.front_tilt_down", "unknown", null));
        String rendered = """
                [{"camera":"camera.front","serial":"T8170X","entities":["select.front_preset","button.front_go_to_preset",
                  "button.front_pan_left","button.front_pan_right","button.front_tilt_up","button.front_tilt_down"]}]""";

        var c = CameraLinker.parse(rendered, JSON, m).get(0).controls();

        assertEquals("select.front_preset", c.presetSelect());
        assertEquals("button.front_go_to_preset", c.gotoPreset());
        assertTrue(c.canPanTilt());
        var slots = CameraLinker.presetSlots(m.get("select.front_preset"));
        assertEquals(List.of(0, 1, 2), slots.stream().map(CameraLinker.PresetSlot::index).toList());
        assertTrue(slots.get(0).home());
        assertEquals("0 · HOME", slots.get(0).option());
        assertTrue(CameraLinker.presetSlots(presetSelect("select.x_preset", "0 · empty", "1 · empty")).isEmpty());
        assertTrue(CameraLinker.presetSlots(null).isEmpty());
    }

    @Test
    @DisplayName("non-JSON or non-array output is an InvalidResponse")
    void badTemplateOutput() {
        assertThrows(HomeAssistantException.InvalidResponse.class, () -> CameraLinker.parse("oops", JSON, Map.of()));
        assertThrows(HomeAssistantException.InvalidResponse.class, () -> CameraLinker.parse("{}", JSON, Map.of()));
        assertTrue(CameraLinker.parse("[]", JSON, Map.of()).isEmpty());
    }

    @Test
    @DisplayName("battery level parsing rejects unknown and out-of-range states")
    void batteryPercent() throws Exception {
        assertEquals(87.0, CameraLinker.batteryPercent(state("sensor.b", "87", "battery")));
        assertNull(CameraLinker.batteryPercent(state("sensor.b", "unavailable", "battery")));
        assertNull(CameraLinker.batteryPercent(state("sensor.b", "120", "battery")));
        assertNull(CameraLinker.batteryPercent(state("sensor.b", "low", "battery")));
        assertNull(CameraLinker.batteryPercent(null));
    }

    @Test
    @DisplayName("charging from binary on/off and from enum labels")
    void charging() throws Exception {
        assertEquals(true, CameraLinker.charging(state("binary_sensor.c", "on", "battery_charging")));
        assertEquals(false, CameraLinker.charging(state("binary_sensor.c", "off", "battery_charging")));
        assertEquals(true, CameraLinker.charging(state("sensor.c", "Solar charging", null)));
        assertEquals(true, CameraLinker.charging(state("sensor.c", "Charging", null)));
        assertEquals(false, CameraLinker.charging(state("sensor.c", "Not charging", null)));
        assertEquals(false, CameraLinker.charging(state("sensor.c", "Discharging", null)));
        assertEquals(false, CameraLinker.charging(state("sensor.c", "Unplugged", null)));
        assertEquals(false, CameraLinker.charging(state("sensor.c", "Plugged", null)));
        assertEquals(false, CameraLinker.charging(state("sensor.c", "Fully charged", null)));
        assertEquals(false, CameraLinker.charging(state("sensor.c", "Charged", null)));
        assertNull(CameraLinker.charging(state("sensor.c", "Mystery", null)));
        assertNull(CameraLinker.charging(state("sensor.c", "unknown", null)));

        assertEquals("Solar charging", CameraLinker.chargingLabel(state("sensor.c", "Solar charging", null)));
        assertNull(CameraLinker.chargingLabel(state("binary_sensor.c", "on", null)));
    }
}
