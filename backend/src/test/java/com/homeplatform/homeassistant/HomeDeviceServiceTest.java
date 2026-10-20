package com.homeplatform.homeassistant;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.homeplatform.dto.ThermostatTemperatureRequest;
import com.homeplatform.model.SmartDevice;
import com.homeplatform.model.ThermostatStatus;
import com.homeplatform.repository.SmartDeviceRepository;
import com.homeplatform.repository.ThermostatChangeRepository;
import com.homeplatform.repository.ThermostatReadingRepository;
import com.homeplatform.repository.ThermostatStatusRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class HomeDeviceServiceTest {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final UUID PUBLIC_ID = UUID.randomUUID();
    private static final String ID = PUBLIC_ID.toString();

    private HomeAssistantService ha;
    private SmartDeviceRepository deviceRepo;
    private ThermostatStatusRepository statusRepo;
    private ThermostatReadingRepository readingRepo;
    private ThermostatChangeRepository changeRepo;
    private ThermostatChangeRecorder recorder;
    private HomeDeviceService service;
    private SmartDevice thermostat;
    private ThermostatStatus status;

    @BeforeEach
    void setUp() {
        ha = mock(HomeAssistantService.class);
        deviceRepo = mock(SmartDeviceRepository.class);
        statusRepo = mock(ThermostatStatusRepository.class);
        readingRepo = mock(ThermostatReadingRepository.class);
        recorder = mock(ThermostatChangeRecorder.class);
        changeRepo = mock(ThermostatChangeRepository.class);
        service = new HomeDeviceService(ha, deviceRepo, statusRepo, readingRepo, changeRepo, recorder, JSON);

        when(ha.isActive()).thenReturn(true);
        thermostat = SmartDevice.builder().id(5L).publicId(PUBLIC_ID).providerEntityId("climate.main_floor")
                .kind(SmartDevice.Kind.THERMOSTAT).name("Main Floor").enabled(true).build();
        status = ThermostatStatus.builder().deviceId(5L).available(true).temperature(69.0)
                .hvacMode("heat").temperatureUnit("°F").minTemp(45.0).maxTemp(92.0)
                .hvacModes("[\"off\",\"heat\",\"cool\",\"heat_cool\"]").presetModes("[\"home\",\"away\"]").build();
        when(deviceRepo.findByPublicId(PUBLIC_ID)).thenReturn(Optional.of(thermostat));
        when(statusRepo.findByDeviceId(5L)).thenReturn(Optional.of(status));
    }

    @Test
    @DisplayName("responses never contain the HA entity id")
    void noEntityIdInResponses() throws Exception {
        when(deviceRepo.findByKindAndEnabledTrueOrderByNameAsc(SmartDevice.Kind.THERMOSTAT)).thenReturn(List.of(thermostat));
        when(deviceRepo.findAllByOrderByKindAscNameAsc()).thenReturn(List.of(thermostat));
        String json = JSON.writeValueAsString(List.of(service.listThermostats(), service.getThermostat(ID), service.listDevices()));
        assertFalse(json.contains("climate."), json);
        assertTrue(json.contains(ID));
        assertTrue(json.contains("\"hvacModes\":[\"off\",\"heat\",\"cool\",\"heat_cool\"]"));
    }

    @Test
    @DisplayName("integration off → Unavailable for app endpoints")
    void disabled() {
        when(ha.isActive()).thenReturn(false);
        assertThrows(HomeAssistantException.Unavailable.class, () -> service.listThermostats());
        assertThrows(HomeAssistantException.Unavailable.class, () -> service.setMode(ID, "heat"));
    }

    @Nested
    @DisplayName("device id validation")
    class Ids {

        @Test
        @DisplayName("malformed, unknown, disabled, or wrong-kind ids → NotFound")
        void notFound() {
            assertThrows(HomeDeviceService.NotFound.class, () -> service.getThermostat("not-a-uuid"));
            assertThrows(HomeDeviceService.NotFound.class, () -> service.getThermostat(UUID.randomUUID().toString()));
            thermostat.setEnabled(false);
            assertThrows(HomeDeviceService.NotFound.class, () -> service.getThermostat(ID));
            verifyNoInteractions(readingRepo);
        }
    }

    @Nested
    @DisplayName("commands")
    class Commands {

        @Test
        @DisplayName("mode must be one the thermostat supports")
        void mode() {
            service.setMode(ID, "cool");
            verify(ha).setHvacMode(thermostat, "cool");
            assertThrows(IllegalArgumentException.class, () -> service.setMode(ID, "dry"));
            assertThrows(IllegalArgumentException.class, () -> service.setMode(ID, " "));
        }

        @Test
        @DisplayName("single setpoint within HA's min/max")
        void singleSetpoint() {
            service.setTemperature(ID, new ThermostatTemperatureRequest(70.0, null, null));
            verify(ha).setTemperature(thermostat, 70.0);
            assertThrows(IllegalArgumentException.class, () -> service.setTemperature(ID, new ThermostatTemperatureRequest(93.0, null, null)));
            assertThrows(IllegalArgumentException.class, () -> service.setTemperature(ID, new ThermostatTemperatureRequest(Double.NaN, null, null)));
            assertThrows(IllegalArgumentException.class, () -> service.setTemperature(ID, new ThermostatTemperatureRequest(70.0, 65.0, 75.0)));
            assertThrows(IllegalArgumentException.class, () -> service.setTemperature(ID, new ThermostatTemperatureRequest(null, null, null)));
            assertThrows(IllegalArgumentException.class, () -> service.setTemperature(ID, null));
        }

        @Test
        @DisplayName("heat_cool needs an ordered low/high range")
        void range() {
            status.setHvacMode("heat_cool");
            service.setTemperature(ID, new ThermostatTemperatureRequest(null, 68.0, 76.0));
            verify(ha).setTemperatureRange(thermostat, 68.0, 76.0);
            assertThrows(IllegalArgumentException.class, () -> service.setTemperature(ID, new ThermostatTemperatureRequest(70.0, null, null)));
            assertThrows(IllegalArgumentException.class, () -> service.setTemperature(ID, new ThermostatTemperatureRequest(null, 76.0, 68.0)));
            assertThrows(IllegalArgumentException.class, () -> service.setTemperature(ID, new ThermostatTemperatureRequest(null, 68.0, null)));
        }

        @Test
        @DisplayName("setpoint while off → Unsupported (422)")
        void off() {
            status.setHvacMode("off");
            var ex = assertThrows(HomeDeviceService.Unsupported.class,
                    () -> service.setTemperature(ID, new ThermostatTemperatureRequest(70.0, null, null)));
            assertFalse(ex.isNotImplemented());
            verify(ha, never()).setTemperature(any(), anyDouble());
        }

        @Test
        @DisplayName("defaults to 45–92°F bounds when HA reports none")
        void defaultBounds() {
            status.setMinTemp(null);
            status.setMaxTemp(null);
            assertArrayEquals(new double[]{45, 92}, HomeDeviceService.bounds(status));
            status.setTemperatureUnit("°C");
            assertArrayEquals(new double[]{7, 33}, HomeDeviceService.bounds(status));
        }

        @Test
        @DisplayName("hold requires a supported preset; none exposed → Unsupported")
        void hold() {
            service.hold(ID, "away");
            verify(ha).setPreset(thermostat, "away");
            assertThrows(IllegalArgumentException.class, () -> service.hold(ID, "vacation"));
            assertThrows(IllegalArgumentException.class, () -> service.hold(ID, null));
            status.setPresetModes("[]");
            assertThrows(HomeDeviceService.Unsupported.class, () -> service.hold(ID, "away"));
        }

        @Test
        @DisplayName("resume without ecobee.resume_program → Unsupported (501)")
        void resume() {
            when(ha.resumeProgram(thermostat)).thenReturn(false);
            var ex = assertThrows(HomeDeviceService.Unsupported.class, () -> service.resume(ID));
            assertTrue(ex.isNotImplemented());
            when(ha.resumeProgram(thermostat)).thenReturn(true);
            assertNotNull(service.resume(ID));
        }
    }

    @Nested
    @DisplayName("history")
    class History {

        @Test
        @DisplayName("defaults to the last 24h")
        void defaultWindow() {
            service.history(ID, null, null);
            verify(readingRepo).findByDeviceIdAndRecordedAtBetweenOrderByRecordedAtAsc(eq(5L), any(), any());
        }

        @Test
        @DisplayName("rejects inverted and oversized ranges")
        void invalidRanges() {
            Instant now = Instant.now();
            assertThrows(IllegalArgumentException.class, () -> service.history(ID, now, now.minus(1, ChronoUnit.HOURS)));
            assertThrows(IllegalArgumentException.class, () -> service.history(ID, now.minus(200, ChronoUnit.DAYS), now));
        }
    }

    @Nested
    @DisplayName("set-by attribution")
    class Attribution {

        private final ThermostatChangeRecorder.Actor bryan = new ThermostatChangeRecorder.Actor(42L, "Bryan");

        @Test
        @DisplayName("registers the actor before calling HA (the event can beat the REST reply)")
        void expectsBeforeCall() {
            service.setTemperature(ID, new ThermostatTemperatureRequest(70.0, null, null), bryan);
            var order = inOrder(recorder, ha);
            order.verify(recorder).expect(thermostat, bryan, ThermostatChangeRecorder.Command.SETPOINT);
            order.verify(ha).setTemperature(thermostat, 70.0);
            verify(recorder, never()).cancel(any(), any());
        }

        @Test
        @DisplayName("withdraws the actor when HA rejects the command")
        void cancelsOnFailure() {
            doThrow(new HomeAssistantException.Http(500, "boom")).when(ha).setHvacMode(thermostat, "cool");
            assertThrows(HomeAssistantException.Http.class, () -> service.setMode(ID, "cool", bryan));
            verify(recorder).expect(thermostat, bryan, ThermostatChangeRecorder.Command.MODE);
            verify(recorder).cancel(thermostat, bryan);
        }

        @Test
        @DisplayName("validation failures never register an actor")
        void noExpectOnBadInput() {
            assertThrows(IllegalArgumentException.class, () -> service.setMode(ID, "dry", bryan));
            verify(recorder, never()).expect(any(), any(), any());
        }

        @Test
        @DisplayName("unsupported resume withdraws the actor")
        void resumeUnsupported() {
            when(ha.resumeProgram(thermostat)).thenReturn(false);
            assertThrows(HomeDeviceService.Unsupported.class, () -> service.resume(ID, bryan));
            verify(recorder).cancel(thermostat, bryan);
        }

        @Test
        @DisplayName("the latest change rides along on the thermostat response")
        void lastChangeInResponse() {
            when(changeRepo.findTopByDeviceIdOrderByChangedAtDesc(5L)).thenReturn(Optional.of(
                    com.homeplatform.model.ThermostatChange.builder().deviceId(5L)
                            .changedAt(java.time.LocalDateTime.of(2026, 10, 20, 5, 0))
                            .changedFields("setpoint,preset").actorType(com.homeplatform.model.ThermostatChange.ActorType.ECOBEE)
                            .actorName("ecobee").hvacMode("heat").presetMode("temp").targetTemperature(70.0).build()));
            var change = service.getThermostat(ID).lastChange();
            assertEquals("ecobee", change.actor());
            assertEquals("ecobee", change.by());
            assertNull(change.byUserId());
            assertEquals(List.of("setpoint", "preset"), change.fields());
            assertEquals("2026-10-20T05:00:00Z", change.at());
        }
    }
}
