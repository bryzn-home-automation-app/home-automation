package com.homeplatform.homeassistant;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.homeplatform.model.SmartDevice;
import com.homeplatform.model.ThermostatReading;
import com.homeplatform.model.ThermostatStatus;
import com.homeplatform.repository.ThermostatReadingRepository;
import com.homeplatform.repository.ThermostatStatusRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.util.Optional;
import java.util.UUID;

import static com.homeplatform.homeassistant.ThermostatIngestionService.Source.EVENT;
import static com.homeplatform.homeassistant.ThermostatIngestionService.Source.SNAPSHOT;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

class ThermostatIngestionServiceTest {

    private static final ObjectMapper JSON = new ObjectMapper();

    private ThermostatStatusRepository statusRepo;
    private ThermostatReadingRepository readingRepo;
    private ThermostatIngestionService service;
    private ThermostatChangeRecorder recorder;
    private final SmartDevice device = SmartDevice.builder().id(7L).providerEntityId("climate.main")
            .kind(SmartDevice.Kind.THERMOSTAT).enabled(true).build();

    @BeforeEach
    void setUp() {
        statusRepo = mock(ThermostatStatusRepository.class);
        readingRepo = mock(ThermostatReadingRepository.class);
        when(statusRepo.findByDeviceId(7L)).thenReturn(Optional.empty());
        when(readingRepo.findTopByDeviceIdOrderByRecordedAtDesc(7L)).thenReturn(Optional.empty());
        recorder = mock(ThermostatChangeRecorder.class);
        service = new ThermostatIngestionService(statusRepo, readingRepo, recorder, JSON);
    }

    private static HaEntityState heat(double temp, double target, String action) throws Exception {
        return HaEntityState.fromJson(JSON.readTree("""
                {"entity_id":"climate.main","state":"heat",
                 "attributes":{"current_temperature":%s,"temperature":%s,"hvac_action":"%s","hvac_modes":["heat","off"]},
                 "last_updated":"2026-10-19T12:00:00+00:00"}""".formatted(temp, target, action)));
    }

    private void lastReadingIs(double temp, double target, String action) {
        when(readingRepo.findTopByDeviceIdOrderByRecordedAtDesc(7L)).thenReturn(Optional.of(
                ThermostatReading.builder().deviceId(7L).temperature(temp).targetTemperature(target)
                        .heatSetpoint(target).hvacMode("heat").hvacAction(action).build()));
    }

    @Test
    @DisplayName("first event writes status and a reading with provenance")
    void firstEventWrites() throws Exception {
        UUID batch = UUID.randomUUID();
        assertTrue(service.ingest(device, heat(68.5, 70, "heating"), "°F", EVENT, batch));

        var status = ArgumentCaptor.forClass(ThermostatStatus.class);
        verify(statusRepo).save(status.capture());
        assertTrue(status.getValue().isAvailable());
        assertEquals(68.5, status.getValue().getTemperature());
        assertEquals("[\"heat\",\"off\"]", status.getValue().getHvacModes());
        assertNotNull(status.getValue().getRaw());

        var reading = ArgumentCaptor.forClass(ThermostatReading.class);
        verify(readingRepo).save(reading.capture());
        ThermostatReading r = reading.getValue();
        assertEquals(7L, r.getDeviceId());
        assertEquals("ha_websocket", r.getSource());
        assertEquals("home-assistant", r.getSourceProvider());
        assertEquals(batch, r.getIngestionBatchId());
        assertEquals("2026-10-19T12:00", r.getRecordedAt().toString(), "HA last_updated, UTC");
        assertEquals(70.0, r.getHeatSetpoint());
    }

    @Test
    @DisplayName("duplicate event (no meaningful change) updates status but appends nothing")
    void duplicateDropped() throws Exception {
        lastReadingIs(68.5, 70, "heating");
        assertFalse(service.ingest(device, heat(68.5, 70, "heating"), "°F", EVENT, UUID.randomUUID()));
        verify(statusRepo).save(any());
        verify(readingRepo, never()).save(any());
    }

    @Test
    @DisplayName("hvac_action change is meaningful and appends")
    void actionChangeAppends() throws Exception {
        lastReadingIs(68.5, 70, "heating");
        assertTrue(service.ingest(device, heat(68.5, 70, "idle"), "°F", EVENT, UUID.randomUUID()));
        verify(readingRepo).save(any());
    }

    @Test
    @DisplayName("unavailable state marks status unavailable and writes no reading")
    void unavailableNoReading() throws Exception {
        var s = HaEntityState.fromJson(JSON.readTree(
                "{\"entity_id\":\"climate.main\",\"state\":\"unavailable\",\"attributes\":{}}"));
        assertFalse(service.ingest(device, s, "°F", EVENT, UUID.randomUUID()));
        var status = ArgumentCaptor.forClass(ThermostatStatus.class);
        verify(statusRepo).save(status.capture());
        assertFalse(status.getValue().isAvailable());
        verify(readingRepo, never()).save(any());
    }

    @Test
    @DisplayName("snapshot appends even when unchanged, timestamped at sample time")
    void snapshotAppends() throws Exception {
        lastReadingIs(68.5, 70, "heating");
        assertTrue(service.ingest(device, heat(68.5, 70, "heating"), "°F", SNAPSHOT, UUID.randomUUID()));
        var reading = ArgumentCaptor.forClass(ThermostatReading.class);
        verify(readingRepo).save(reading.capture());
        assertEquals("ha_snapshot", reading.getValue().getSource());
        assertNotEquals("2026-10-19T12:00", reading.getValue().getRecordedAt().toString());
    }

    @Test
    @DisplayName("existing status row is updated in place (upsert)")
    void statusUpsert() throws Exception {
        ThermostatStatus existing = ThermostatStatus.builder().id(3L).deviceId(7L).build();
        when(statusRepo.findByDeviceId(7L)).thenReturn(Optional.of(existing));
        service.ingest(device, heat(66, 69, "heating"), "°F", EVENT, UUID.randomUUID());
        verify(statusRepo).save(same(existing));
        assertEquals(66.0, existing.getTemperature());
    }

    @Test
    @DisplayName("hands the previous and new control state to the change recorder")
    void passesControlStateToRecorder() throws Exception {
        ThermostatStatus existing = ThermostatStatus.builder().id(3L).deviceId(7L).available(true)
                .targetTemperature(69.0).heatSetpoint(69.0).hvacMode("heat").presetMode("home").build();
        when(statusRepo.findByDeviceId(7L)).thenReturn(Optional.of(existing));
        HaEntityState s = heat(66, 71, "heating");
        UUID batch = UUID.randomUUID();
        service.ingest(device, s, "°F", EVENT, batch);
        ArgumentCaptor<ThermostatChangeRecorder.ControlState> before = ArgumentCaptor.forClass(ThermostatChangeRecorder.ControlState.class);
        ArgumentCaptor<ThermostatChangeRecorder.ControlState> after = ArgumentCaptor.forClass(ThermostatChangeRecorder.ControlState.class);
        verify(recorder).onIngested(same(device), before.capture(), after.capture(), same(s), eq("ha_websocket"), eq(batch));
        assertEquals(69.0, before.getValue().targetTemperature());   // captured before the upsert overwrote it
        assertEquals("home", before.getValue().presetMode());
        assertEquals(71.0, after.getValue().targetTemperature());
    }

    @Test
    @DisplayName("first sighting passes a null previous state")
    void firstSightingNullBefore() throws Exception {
        service.ingest(device, heat(66, 71, "heating"), "°F", SNAPSHOT, UUID.randomUUID());
        verify(recorder).onIngested(same(device), isNull(), any(), any(), eq("ha_snapshot"), any());
    }
}
