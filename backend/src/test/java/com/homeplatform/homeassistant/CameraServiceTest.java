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

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

class CameraServiceTest {

    private static final UUID PUBLIC_ID = UUID.randomUUID();
    private static final String ID = PUBLIC_ID.toString();
    private static final Instant NOW = Instant.parse("2026-10-20T18:00:00Z");

    private HomeAssistantService ha;
    private SmartDeviceRepository deviceRepo;
    private CameraStatusRepository statusRepo;
    private CameraBatteryReadingRepository readingRepo;
    private CameraStreamTickets tickets;
    private CameraService service;
    private SmartDevice camera;
    private CameraStatus status;

    @BeforeEach
    void setUp() {
        ha = mock(HomeAssistantService.class);
        deviceRepo = mock(SmartDeviceRepository.class);
        statusRepo = mock(CameraStatusRepository.class);
        readingRepo = mock(CameraBatteryReadingRepository.class);
        tickets = new CameraStreamTickets(Clock.fixed(NOW, ZoneOffset.UTC));
        service = new CameraService(ha, deviceRepo, statusRepo, readingRepo, tickets, 32.78, -96.80,
                Clock.fixed(NOW, ZoneOffset.UTC));
        when(ha.isActive()).thenReturn(true);
        camera = SmartDevice.builder().id(3L).publicId(PUBLIC_ID).providerEntityId("camera.driveway")
                .kind(SmartDevice.Kind.CAMERA).name("Driveway").enabled(true).build();
        status = CameraStatus.builder().deviceId(3L).available(true).streamName("T8170X")
                .powerSource(CameraStatus.POWER_BATTERY).batteryPercent(64.0).charging(true)
                .chargingStatus("Solar charging").build();
        when(deviceRepo.findByPublicId(PUBLIC_ID)).thenReturn(Optional.of(camera));
        when(deviceRepo.findByKindAndEnabledTrueOrderByNameAsc(SmartDevice.Kind.CAMERA)).thenReturn(List.of(camera));
        when(statusRepo.findByDeviceId(3L)).thenReturn(Optional.of(status));
    }

    @Test
    @DisplayName("list exposes battery + live availability, never the stream name or entity ids")
    void list() {
        var cams = service.listCameras();
        assertEquals(1, cams.size());
        var c = cams.get(0);
        assertEquals(ID, c.id());
        assertEquals(64.0, c.batteryPercent());
        assertEquals(true, c.charging());
        assertTrue(c.liveAvailable());
        assertFalse(c.toString().contains("T8170X"));
        assertFalse(c.toString().contains("camera.driveway"));
    }

    @Test
    @DisplayName("wired cameras report no battery fields even if stale values are stored")
    void wired() {
        status.setPowerSource(CameraStatus.POWER_WIRED);
        var c = service.listCameras().get(0);
        assertNull(c.batteryPercent());
        assertNull(c.charging());
        assertEquals("wired", c.powerSource());
    }

    @Test
    @DisplayName("battery history: readings + daylight windows; range validated")
    void history() {
        LocalDateTime at = LocalDateTime.ofInstant(NOW.minus(1, ChronoUnit.HOURS), ZoneOffset.UTC);
        when(readingRepo.findByDeviceIdAndRecordedAtBetweenOrderByRecordedAtAsc(eq(3L), any(), any()))
                .thenReturn(List.of(CameraBatteryReading.builder().recordedAt(at).batteryPercent(63.0).charging(true).build()));

        var h = service.batteryHistory(ID, null, null);

        assertEquals(1, h.readings().size());
        assertEquals(63.0, h.readings().get(0).percent());
        assertFalse(h.daylight().isEmpty());
        assertThrows(IllegalArgumentException.class, () -> service.batteryHistory(ID, NOW, NOW.minusSeconds(1)));
        assertThrows(IllegalArgumentException.class, () -> service.batteryHistory(ID, NOW.minus(100, ChronoUnit.DAYS), NOW));
    }

    @Test
    @DisplayName("snapshots are cached briefly so several viewers share one camera wake-up")
    void snapshotCache() {
        when(ha.cameraSnapshot(camera)).thenReturn(new HomeAssistantClient.CameraImage(new byte[]{1}, "image/jpeg"));
        service.snapshot(ID);
        service.snapshot(ID);
        verify(ha, times(1)).cameraSnapshot(camera);
    }

    @Test
    @DisplayName("an older still is served instantly and refreshed in the background")
    void staleWhileRefreshing() {
        var clock = new ThermostatChangeRecorderTest.MutableClock();
        clock.now = NOW;
        service = new CameraService(ha, deviceRepo, statusRepo, readingRepo, tickets, 32.78, -96.80, clock);
        var first = new HomeAssistantClient.CameraImage(new byte[]{1}, "image/jpeg");
        var second = new HomeAssistantClient.CameraImage(new byte[]{2}, "image/jpeg");
        when(ha.cameraSnapshot(camera)).thenReturn(first, second);

        assertSame(first, service.snapshot(ID));
        clock.now = NOW.plusSeconds(120); // past the 20 s window, inside the stale window
        assertSame(first, service.snapshot(ID), "no waiting on the camera");
        verify(ha, timeout(2_000).times(2)).cameraSnapshot(camera);
    }

    @Test
    @DisplayName("after a motion event the viewer waits for the new frame instead")
    void eventForcesFreshStill() {
        var clock = new ThermostatChangeRecorderTest.MutableClock();
        clock.now = NOW;
        service = new CameraService(ha, deviceRepo, statusRepo, readingRepo, tickets, 32.78, -96.80, clock);
        var before = new HomeAssistantClient.CameraImage(new byte[]{1}, "image/jpeg");
        var after = new HomeAssistantClient.CameraImage(new byte[]{2}, "image/jpeg");
        when(ha.cameraSnapshot(camera)).thenReturn(before, after);

        service.snapshot(ID);
        clock.now = NOW.plusSeconds(120);
        status.setLastMotionAt(LocalDateTime.ofInstant(NOW.plusSeconds(60), ZoneOffset.UTC));
        assertSame(after, service.snapshot(ID));
    }

    @Test
    @DisplayName("live: ticket URL resolves back to the stream; none without a stream name")
    void live() {
        var live = service.startLive(ID);
        assertTrue(live.url().startsWith("/camera-stream/") && live.url().endsWith("/ws"));
        String ticket = live.url().substring("/camera-stream/".length(), live.url().length() - "/ws".length());
        assertEquals(Optional.of("T8170X"), service.streamForTicket(ticket));

        camera.setEnabled(false);
        assertTrue(service.streamForTicket(ticket).isEmpty(), "disabled after issue");
        camera.setEnabled(true);

        // iPhone path: an HLS playlist URL with a longer-lived ticket.
        var hls = service.startLive(ID, "hls");
        assertTrue(hls.url().endsWith("/stream.m3u8"));
        assertEquals(NOW.plus(CameraStreamTickets.HLS_TTL).toString(), hls.expiresAt());

        status.setStreamName(null);
        assertThrows(HomeDeviceService.Unsupported.class, () -> service.startLive(ID));
    }

    private void withControls() {
        status.setControls("{\"presetSelect\":\"select.front_preset\",\"gotoPreset\":\"button.front_go_to_preset\","
                + "\"panLeft\":\"button.front_pan_left\",\"panRight\":\"button.front_pan_right\","
                + "\"tiltUp\":\"button.front_tilt_up\",\"tiltDown\":\"button.front_tilt_down\"}");
        status.setPresetSlots("[{\"index\":0,\"option\":\"0 · HOME\",\"home\":true},{\"index\":2,\"option\":\"2\",\"home\":false}]");
    }

    @Test
    @DisplayName("presets: listed with names, and going to one selects the slot then presses go-to")
    void presets() {
        withControls();
        var c = service.listCameras().get(0);
        assertEquals(List.of("Home", "Position 2"), c.presets().stream().map(com.homeplatform.dto.CameraPreset::name).toList());
        assertTrue(c.canPanTilt());

        service.goToPreset(ID, 2);
        var order = inOrder(ha);
        order.verify(ha).selectOption("select.front_preset", "2");
        order.verify(ha).pressButton("button.front_go_to_preset");

        assertThrows(IllegalArgumentException.class, () -> service.goToPreset(ID, 5), "empty slot");
    }

    @Test
    @DisplayName("pan/tilt nudges press the matching button; cameras without controls refuse")
    void nudge() {
        withControls();
        service.nudge(ID, CameraService.Direction.LEFT);
        service.nudge(ID, CameraService.Direction.DOWN);
        verify(ha).pressButton("button.front_pan_left");
        verify(ha).pressButton("button.front_tilt_down");

        status.setControls(null);
        assertThrows(HomeDeviceService.Unsupported.class, () -> service.nudge(ID, CameraService.Direction.UP));
        assertThrows(HomeDeviceService.Unsupported.class, () -> service.goToPreset(ID, 0));
        assertFalse(service.listCameras().get(0).canPanTilt());
    }

    @Test
    @DisplayName("bad ids, thermostats, and integration-off are rejected")
    void guards() {
        assertThrows(HomeDeviceService.NotFound.class, () -> service.snapshot("nope"));
        camera.setKind(SmartDevice.Kind.THERMOSTAT);
        assertThrows(HomeDeviceService.NotFound.class, () -> service.startLive(ID));
        when(ha.isActive()).thenReturn(false);
        assertThrows(HomeAssistantException.Unavailable.class, () -> service.listCameras());
    }
}
