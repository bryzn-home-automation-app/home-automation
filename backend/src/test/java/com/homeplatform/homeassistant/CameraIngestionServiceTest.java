package com.homeplatform.homeassistant;

import com.homeplatform.model.CameraBatteryReading;
import com.homeplatform.model.CameraStatus;
import com.homeplatform.model.SmartDevice;
import com.homeplatform.repository.CameraBatteryReadingRepository;
import com.homeplatform.repository.CameraStatusRepository;
import com.homeplatform.repository.SmartDeviceRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static com.homeplatform.homeassistant.CameraLinkerTest.state;
import static com.homeplatform.homeassistant.ThermostatIngestionService.Source.SNAPSHOT;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

class CameraIngestionServiceTest {

    private CameraStatusRepository statusRepo;
    private CameraBatteryReadingRepository readingRepo;
    private SmartDeviceRepository deviceRepo;
    private CameraAlertService alerts;
    private CameraIngestionService service;
    private final SmartDevice camera = SmartDevice.builder().id(3L).publicId(UUID.randomUUID())
            .providerEntityId("camera.driveway").kind(SmartDevice.Kind.CAMERA).enabled(true).build();
    private final CameraLinker.Link link = new CameraLinker.Link("camera.driveway", "T8170X",
            "sensor.driveway_battery", "binary_sensor.driveway_charging", "binary_sensor.driveway_motion",
            "binary_sensor.driveway_person");
    private CameraStatus stored;

    @BeforeEach
    void setUp() {
        statusRepo = mock(CameraStatusRepository.class);
        readingRepo = mock(CameraBatteryReadingRepository.class);
        deviceRepo = mock(SmartDeviceRepository.class);
        alerts = mock(CameraAlertService.class);
        service = new CameraIngestionService(statusRepo, readingRepo, deviceRepo, alerts);
        // The repository hands back whatever was last saved, like the real one.
        when(statusRepo.findByDeviceId(3L)).thenAnswer(i -> Optional.ofNullable(stored));
        when(statusRepo.save(any())).thenAnswer(i -> stored = i.getArgument(0));
        when(statusRepo.findAll()).thenAnswer(i -> stored == null ? List.of() : List.of(stored));
        when(deviceRepo.findById(3L)).thenReturn(Optional.of(camera));
        when(readingRepo.findTopByDeviceIdOrderByRecordedAtDesc(3L)).thenReturn(Optional.empty());
    }

    private Map<String, HaEntityState> current(String battery, String charging) throws Exception {
        Map<String, HaEntityState> m = new HashMap<>();
        m.put("camera.driveway", state("camera.driveway", "idle", null));
        m.put("sensor.driveway_battery", state("sensor.driveway_battery", battery, "battery"));
        m.put("binary_sensor.driveway_charging", state("binary_sensor.driveway_charging", charging, "battery_charging"));
        m.put("binary_sensor.driveway_motion", state("binary_sensor.driveway_motion", "off", "motion"));
        return m;
    }

    @Test
    @DisplayName("link stores links + state and writes a snapshot reading for a battery camera")
    void linkBatteryCamera() throws Exception {
        service.link(camera, link, current("87", "on"), SNAPSHOT, UUID.randomUUID());

        assertEquals("T8170X", stored.getStreamName());
        assertEquals(CameraStatus.POWER_BATTERY, stored.getPowerSource());
        assertEquals(87.0, stored.getBatteryPercent());
        assertEquals(true, stored.getCharging());
        assertTrue(stored.isAvailable());
        ArgumentCaptor<CameraBatteryReading> r = ArgumentCaptor.forClass(CameraBatteryReading.class);
        verify(readingRepo).save(r.capture());
        assertEquals(87.0, r.getValue().getBatteryPercent());
        assertEquals("ha_snapshot", r.getValue().getSource());
    }

    @Test
    @DisplayName("a camera with no battery entity is wired and never gets readings")
    void wiredCamera() throws Exception {
        var wired = new CameraLinker.Link("camera.driveway", "T8417X", null, null, null, null);
        service.link(camera, wired, current("87", "on"), SNAPSHOT, UUID.randomUUID());
        assertEquals(CameraStatus.POWER_WIRED, stored.getPowerSource());
        assertNull(stored.getBatteryPercent());
        verify(readingRepo, never()).save(any());
    }

    @Test
    @DisplayName("live events: index covers linked entities; readings only on real changes")
    void liveEvents() throws Exception {
        service.link(camera, link, current("87", "on"), SNAPSHOT, UUID.randomUUID());
        service.reindex();
        clearInvocations(readingRepo);

        assertTrue(service.handles("sensor.driveway_battery"));
        assertTrue(service.handles("camera.driveway"));
        assertFalse(service.handles("sensor.something_else"));

        service.onStateChanged(state("sensor.driveway_battery", "87", "battery"), UUID.randomUUID());
        verify(readingRepo, never()).save(any()); // same level

        service.onStateChanged(state("sensor.driveway_battery", "88", "battery"), UUID.randomUUID());
        service.onStateChanged(state("binary_sensor.driveway_charging", "off", "battery_charging"), UUID.randomUUID());
        ArgumentCaptor<CameraBatteryReading> r = ArgumentCaptor.forClass(CameraBatteryReading.class);
        verify(readingRepo, times(2)).save(r.capture());
        assertEquals(88.0, r.getAllValues().get(0).getBatteryPercent());
        assertEquals(false, r.getAllValues().get(1).getCharging());
        assertEquals("ha_websocket", r.getAllValues().get(1).getSource());
    }

    @Test
    @DisplayName("motion 'on' records the event time; camera unavailability is tracked")
    void motionAndAvailability() throws Exception {
        service.link(camera, link, current("50", "off"), SNAPSHOT, UUID.randomUUID());
        service.reindex();

        service.onStateChanged(state("binary_sensor.driveway_motion", "on", "motion"), UUID.randomUUID());
        assertNotNull(stored.getLastMotionAt());
        service.onStateChanged(state("camera.driveway", "unavailable", null), UUID.randomUUID());
        assertFalse(stored.isAvailable());
    }

    @Test
    @DisplayName("a live person 'on' edge raises the alert; the link pass never does")
    void personAlert() throws Exception {
        Map<String, HaEntityState> m = current("50", "off");
        m.put("binary_sensor.driveway_person", state("binary_sensor.driveway_person", "on", "occupancy"));
        service.link(camera, link, m, SNAPSHOT, UUID.randomUUID());
        service.reindex();
        verifyNoInteractions(alerts);

        service.onStateChanged(stateAt("binary_sensor.driveway_person", "on", "2026-10-20T18:00:00+00:00"), UUID.randomUUID());
        verify(alerts).personDetected(camera, stored);
        service.onStateChanged(stateAt("binary_sensor.driveway_person", "off", "2026-10-20T18:00:30+00:00"), UUID.randomUUID());
        verify(alerts, times(1)).personDetected(any(), any());
    }

    @Test
    @DisplayName("offline time starts when the camera goes unavailable and clears when it's back")
    void unavailableSince() throws Exception {
        service.link(camera, link, current("50", "off"), SNAPSHOT, UUID.randomUUID());
        service.reindex();
        assertNull(stored.getUnavailableSince());
        service.onStateChanged(state("camera.driveway", "unavailable", null), UUID.randomUUID());
        var since = stored.getUnavailableSince();
        assertNotNull(since);
        service.onStateChanged(state("camera.driveway", "unavailable", null), UUID.randomUUID());
        assertEquals(since, stored.getUnavailableSince(), "still offline keeps the original time");
        service.onStateChanged(state("camera.driveway", "idle", null), UUID.randomUUID());
        assertNull(stored.getUnavailableSince());
    }

    private static HaEntityState stateAt(String id, String state, String changedAt) throws Exception {
        return HaEntityState.fromJson(new com.fasterxml.jackson.databind.ObjectMapper().readTree(
                "{\"entity_id\":\"" + id + "\",\"state\":\"" + state + "\",\"attributes\":{},"
                        + "\"last_changed\":\"" + changedAt + "\",\"last_updated\":\"" + changedAt + "\"}"));
    }

    @Test
    @DisplayName("controls are stored on link; a preset saved later in the eufy app updates the slots")
    void presetSlotsFollowEvents() throws Exception {
        var controls = new CameraLinker.Controls("select.driveway_preset", "button.driveway_go_to_preset",
                "button.driveway_pan_left", "button.driveway_pan_right", "button.driveway_tilt_up", "button.driveway_tilt_down");
        var withControls = new CameraLinker.Link("camera.driveway", "T8170X", "sensor.driveway_battery",
                "binary_sensor.driveway_charging", "binary_sensor.driveway_motion", null, controls);
        Map<String, HaEntityState> m = current("80", "off");
        m.put("select.driveway_preset", CameraLinkerTest.presetSelect("select.driveway_preset", "0 · HOME", "1 · empty"));

        service.link(camera, withControls, m, SNAPSHOT, UUID.randomUUID());
        service.reindex();
        assertTrue(stored.getControls().contains("button.driveway_go_to_preset"));
        assertTrue(stored.getPresetSlots().contains("0 · HOME"));
        assertFalse(stored.getPresetSlots().contains("\"index\":1"));

        assertTrue(service.handles("select.driveway_preset"));
        service.onStateChanged(CameraLinkerTest.presetSelect("select.driveway_preset", "0 · HOME", "1"), UUID.randomUUID());
        assertTrue(stored.getPresetSlots().contains("\"index\":1"));
    }

    @Test
    @DisplayName("events for a disabled camera are ignored")
    void disabledCamera() throws Exception {
        service.link(camera, link, current("50", "off"), SNAPSHOT, UUID.randomUUID());
        service.reindex();
        camera.setEnabled(false);
        clearInvocations(statusRepo, readingRepo);
        service.onStateChanged(state("sensor.driveway_battery", "10", "battery"), UUID.randomUUID());
        verify(statusRepo, never()).save(any());
        verify(readingRepo, never()).save(any());
    }
}
