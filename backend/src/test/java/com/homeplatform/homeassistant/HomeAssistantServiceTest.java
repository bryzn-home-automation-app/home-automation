package com.homeplatform.homeassistant;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.homeplatform.model.SmartDevice;
import com.homeplatform.repository.SmartDeviceRepository;
import com.homeplatform.service.AppEventService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class HomeAssistantServiceTest {

    private static final ObjectMapper JSON = new ObjectMapper();

    private HomeAssistantClient client;
    private DeviceDiscoveryService discovery;
    private ThermostatIngestionService ingestion;
    private CameraIngestionService cameras;
    private SmartDeviceRepository deviceRepo;
    private AppEventService events;
    private HomeAssistantService service;
    private SmartDevice thermostat;

    @BeforeEach
    void setUp() {
        client = mock(HomeAssistantClient.class);
        discovery = mock(DeviceDiscoveryService.class);
        ingestion = mock(ThermostatIngestionService.class);
        cameras = mock(CameraIngestionService.class);
        deviceRepo = mock(SmartDeviceRepository.class);
        events = mock(AppEventService.class);
        service = new HomeAssistantService(client, discovery, ingestion, cameras, deviceRepo, events, JSON);
        thermostat = SmartDevice.builder().id(5L).publicId(UUID.randomUUID()).providerEntityId("climate.main")
                .kind(SmartDevice.Kind.THERMOSTAT).enabled(true).build();
        when(deviceRepo.findByProviderEntityId("climate.main")).thenReturn(Optional.of(thermostat));
        when(client.getTemperatureUnit()).thenReturn("°F");
    }

    private static HaEntityState state(String entityId) throws Exception {
        return HaEntityState.fromJson(JSON.readTree("{\"entity_id\":\"" + entityId + "\",\"state\":\"heat\",\"attributes\":{}}"));
    }

    @Test
    @DisplayName("live events reach ingestion only for enabled thermostats")
    void handleStateChangedFilters() throws Exception {
        UUID batch = UUID.randomUUID();
        service.handleStateChanged(state("climate.main"), batch);
        verify(ingestion).ingest(eq(thermostat), any(), eq("°F"), eq(ThermostatIngestionService.Source.EVENT), eq(batch));

        service.handleStateChanged(state("sensor.outdoor"), batch);
        service.handleStateChanged(state("climate.unknown"), batch);
        thermostat.setEnabled(false);
        service.handleStateChanged(state("climate.main"), batch);
        verify(ingestion, times(1)).ingest(any(), any(), any(), any(), any());
    }

    @Test
    @DisplayName("ingestion failures on live events never propagate")
    void handleStateChangedSwallowsErrors() throws Exception {
        when(ingestion.ingest(any(), any(), any(), any(), any())).thenThrow(new RuntimeException("db down"));
        assertDoesNotThrow(() -> service.handleStateChanged(state("climate.main"), UUID.randomUUID()));
    }

    @Test
    @DisplayName("discoverAndSnapshot upserts devices and snapshots enabled thermostats under one batch")
    void discoverAndSnapshot() throws Exception {
        var states = List.of(state("climate.main"), state("camera.door"), state("sensor.x"));
        when(client.getStates()).thenReturn(states);
        when(discovery.upsertAll(states)).thenReturn(new DeviceDiscoveryService.Result(1, 1, 2));
        when(ingestion.ingest(any(), any(), any(), eq(ThermostatIngestionService.Source.SNAPSHOT), any())).thenReturn(true);

        var r = service.discoverAndSnapshot();

        assertEquals(1, r.readingsWritten());
        assertNotNull(r.batchId());
        verify(ingestion).ingest(eq(thermostat), same(states.get(0)), eq("°F"),
                eq(ThermostatIngestionService.Source.SNAPSHOT), eq(r.batchId()));
        verify(events).info(eq("home-assistant"), anyString(), contains("2 new device"));
    }

    @Test
    @DisplayName("camera entities: live events go to camera ingestion only when linked")
    void cameraEventsRouted() throws Exception {
        UUID batch = UUID.randomUUID();
        when(cameras.handles("sensor.porch_battery")).thenReturn(true);
        service.handleStateChanged(state("sensor.porch_battery"), batch);
        service.handleStateChanged(state("sensor.outdoor"), batch);
        verify(cameras).onStateChanged(argThat(s -> s.entityId().equals("sensor.porch_battery")), eq(batch));
        verify(cameras, times(1)).onStateChanged(any(), any());
        verifyNoInteractions(ingestion);

        doThrow(new RuntimeException("db down")).when(cameras).onStateChanged(any(), any());
        assertDoesNotThrow(() -> service.handleStateChanged(state("sensor.porch_battery"), batch));
    }

    @Test
    @DisplayName("discovery links enabled cameras from the rendered device-registry template")
    void linksCameras() throws Exception {
        var states = List.of(state("camera.porch"), state("sensor.porch_battery"));
        SmartDevice porch = SmartDevice.builder().id(9L).publicId(UUID.randomUUID()).providerEntityId("camera.porch")
                .kind(SmartDevice.Kind.CAMERA).enabled(true).build();
        when(client.getStates()).thenReturn(states);
        when(discovery.upsertAll(states)).thenReturn(new DeviceDiscoveryService.Result(0, 1, 0));
        when(deviceRepo.findByProviderEntityId("camera.porch")).thenReturn(Optional.of(porch));
        when(client.renderTemplate(CameraLinker.TEMPLATE)).thenReturn(
                "[{\"camera\":\"camera.porch\",\"serial\":\"T8170P1234\",\"entities\":[\"camera.porch\",\"sensor.porch_battery\"]}]");

        var r = service.discoverAndSnapshot();

        verify(cameras).link(same(porch), argThat(l -> "T8170P1234".equals(l.streamName())), anyMap(),
                eq(ThermostatIngestionService.Source.SNAPSHOT), eq(r.batchId()));
        verify(cameras).reindex();
    }

    @Test
    @DisplayName("a failing camera template never fails discovery")
    void cameraTemplateFailure() throws Exception {
        var states = List.of(state("camera.porch"));
        when(client.getStates()).thenReturn(states);
        when(discovery.upsertAll(states)).thenReturn(new DeviceDiscoveryService.Result(0, 1, 0));
        when(client.renderTemplate(any())).thenThrow(new HomeAssistantException.Http(400, "bad template"));

        assertDoesNotThrow(() -> service.discoverAndSnapshot());
        verify(cameras, never()).link(any(), any(), any(), any(), any());
        verify(cameras).reindex();
    }

    @Test
    @DisplayName("no app_event when discovery finds nothing new")
    void quietDiscovery() {
        when(client.getStates()).thenReturn(List.of());
        when(discovery.upsertAll(any())).thenReturn(new DeviceDiscoveryService.Result(0, 0, 0));
        service.discoverAndSnapshot();
        verifyNoInteractions(events);
    }

    @Test
    @DisplayName("commands call the right HA services with the internal entity id")
    void commands() {
        service.setHvacMode(thermostat, "cool");
        verify(client).callService("climate", "set_hvac_mode", Map.of("entity_id", "climate.main", "hvac_mode", "cool"));
        service.setTemperatureRange(thermostat, 68, 76);
        verify(client).callService("climate", "set_temperature",
                Map.of("entity_id", "climate.main", "target_temp_low", 68.0, "target_temp_high", 76.0));
        service.setPreset(thermostat, "away");
        verify(client).callService("climate", "set_preset_mode", Map.of("entity_id", "climate.main", "preset_mode", "away"));
        verify(client, times(3)).getState("climate.main"); // post-command refresh
    }

    @Test
    @DisplayName("resume uses ecobee.resume_program only when HA exposes it")
    void resume() {
        when(client.hasService("ecobee", "resume_program")).thenReturn(false);
        assertFalse(service.resumeProgram(thermostat));
        verify(client, never()).callService(eq("ecobee"), any(), any());

        when(client.hasService("ecobee", "resume_program")).thenReturn(true);
        assertTrue(service.resumeProgram(thermostat));
        verify(client).callService("ecobee", "resume_program", Map.of("entity_id", "climate.main", "resume_all", false));
    }

    @Test
    @DisplayName("temperature unit is fetched once, defaults to °F when HA is unreachable")
    void unitCaching() {
        when(client.getTemperatureUnit()).thenThrow(new HomeAssistantException.Unavailable("down"));
        assertEquals("°F", service.unit());
        reset(client);
        when(client.getTemperatureUnit()).thenReturn("°C");
        assertEquals("°C", service.unit());
        assertEquals("°C", service.unit());
        verify(client, times(1)).getTemperatureUnit();
    }

    @Test
    @DisplayName("snapshot scheduler: no-op when inactive; logs only on failure/recovery transitions")
    void schedulerTransitions() {
        HomeAssistantService svc = mock(HomeAssistantService.class);
        CameraAlertService alerts = mock(CameraAlertService.class);
        CameraService cameraService = mock(CameraService.class);
        var scheduler = new HomeAssistantSnapshotScheduler(svc, events, alerts, cameraService);

        when(svc.isActive()).thenReturn(false);
        scheduler.snapshot();
        verify(svc, never()).discoverAndSnapshot();
        verifyNoInteractions(alerts);

        when(svc.isActive()).thenReturn(true);
        when(svc.discoverAndSnapshot()).thenThrow(new HomeAssistantException.Unavailable("down"));
        scheduler.snapshot();
        scheduler.snapshot();
        verify(events, times(1)).warn(eq("home-assistant"), anyString(), contains("failed"));

        reset(svc);
        when(svc.isActive()).thenReturn(true);
        when(svc.discoverAndSnapshot()).thenReturn(new HomeAssistantService.SyncResult(
                new DeviceDiscoveryService.Result(1, 0, 0), 1, UUID.randomUUID()));
        scheduler.snapshot();
        scheduler.snapshot();
        verify(events, times(1)).info(eq("home-assistant"), anyString(), contains("recovered"));
        verify(alerts, times(2)).evaluate(); // only after successful snapshots
        verify(cameraService, times(2)).prewarmSnapshots();
    }

    @Test
    @DisplayName("WebSocket reconnect backoff doubles from 5s and caps at 5 min")
    void backoff() {
        assertEquals(Duration.ofSeconds(5), HomeAssistantWebSocket.backoff(0));
        assertEquals(Duration.ofSeconds(10), HomeAssistantWebSocket.backoff(1));
        assertEquals(Duration.ofSeconds(160), HomeAssistantWebSocket.backoff(5));
        assertEquals(Duration.ofMinutes(5), HomeAssistantWebSocket.backoff(6));
        assertEquals(Duration.ofMinutes(5), HomeAssistantWebSocket.backoff(500));
    }
}
