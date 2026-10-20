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
    private CameraIngestionService service;
    private final SmartDevice camera = SmartDevice.builder().id(3L).publicId(UUID.randomUUID())
            .providerEntityId("camera.driveway").kind(SmartDevice.Kind.CAMERA).enabled(true).build();
    private final CameraLinker.Link link = new CameraLinker.Link("camera.driveway", "T8170X",
            "sensor.driveway_battery", "binary_sensor.driveway_charging", "binary_sensor.driveway_motion", null);
    private CameraStatus stored;

    @BeforeEach
    void setUp() {
        statusRepo = mock(CameraStatusRepository.class);
        readingRepo = mock(CameraBatteryReadingRepository.class);
        deviceRepo = mock(SmartDeviceRepository.class);
        service = new CameraIngestionService(statusRepo, readingRepo, deviceRepo);
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
