package com.homeplatform.homeassistant;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.homeplatform.model.SmartDevice;
import com.homeplatform.model.ThermostatChange;
import com.homeplatform.repository.ThermostatChangeRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.List;
import java.util.UUID;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

class ThermostatChangeRecorderTest {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final Instant T0 = Instant.parse("2026-10-20T05:00:00Z");

    private final SmartDevice device = SmartDevice.builder().id(3L).providerEntityId("climate.upstairs")
            .kind(SmartDevice.Kind.THERMOSTAT).enabled(true).build();
    private final ThermostatChangeRecorder.Actor bryan = new ThermostatChangeRecorder.Actor(42L, "Bryan");

    private ThermostatChangeRepository repo;
    private MutableClock clock;
    private ThermostatChangeRecorder recorder;

    /** Minimal settable clock so the command window can be crossed in a test. */
    static final class MutableClock extends Clock {
        Instant now = T0;
        @Override public ZoneId getZone() { return ZoneOffset.UTC; }
        @Override public Clock withZone(ZoneId zone) { return this; }
        @Override public Instant instant() { return now; }
    }

    @BeforeEach
    void setUp() {
        repo = mock(ThermostatChangeRepository.class);
        when(repo.save(any())).thenAnswer(inv -> inv.getArgument(0));
        clock = new MutableClock();
        recorder = new ThermostatChangeRecorder(repo, clock);
    }

    private static ThermostatChangeRecorder.ControlState cool(double setpoint, String preset) {
        return new ThermostatChangeRecorder.ControlState(true, setpoint, null, setpoint, "cool", preset);
    }

    private static HaEntityState state(String contextUserId) throws Exception {
        String ctx = contextUserId == null ? "null" : "\"" + contextUserId + "\"";
        return HaEntityState.fromJson(JSON.readTree("""
                {"entity_id":"climate.upstairs","state":"cool","attributes":{},
                 "last_updated":"2026-10-20T05:01:00+00:00",
                 "context":{"id":"01J","parent_id":null,"user_id":%s}}""".formatted(ctx)));
    }

    private ThermostatChange record(ThermostatChangeRecorder.ControlState before,
                                    ThermostatChangeRecorder.ControlState after,
                                    String contextUserId) throws Exception {
        return recorder.onIngested(device, before, after, state(contextUserId), "ha_websocket", UUID.randomUUID())
                .orElse(null);
    }

    @Test
    @DisplayName("a change after an app command is credited to that user")
    void appUser() throws Exception {
        recorder.expect(device, bryan);
        clock.now = T0.plusSeconds(4);
        ThermostatChange c = record(cool(72, "sleep"), cool(73, "temp"), "ha-token-user");
        assertNotNull(c);
        assertEquals(ThermostatChange.ActorType.APP, c.getActorType());
        assertEquals("Bryan", c.getActorName());
        assertEquals(42L, c.getActorUserId());
        assertEquals("setpoint,preset", c.getChangedFields());
        assertEquals(73.0, c.getCoolSetpoint());
        assertEquals(Instant.parse("2026-10-20T05:01:00Z"), c.getChangedAt().toInstant(ZoneOffset.UTC));
        assertEquals("ha_websocket", c.getSource());
    }

    @Test
    @DisplayName("the hold's later echo (next ecobee poll) is still credited to the app user")
    void echoWithinWindow() throws Exception {
        recorder.expect(device, bryan);
        clock.now = T0.plus(Duration.ofMinutes(3));
        assertEquals("Bryan", record(cool(73, "sleep"), cool(73, "temp"), null).getActorName());
    }

    @Test
    @DisplayName("without an app command: HA user → Home Assistant, otherwise → ecobee")
    void otherSources() throws Exception {
        assertEquals(ThermostatChange.ActorType.HOME_ASSISTANT,
                record(cool(72, null), cool(70, null), "some-ha-user").getActorType());
        ThermostatChange ecobee = record(cool(72, null), cool(74, null), null);
        assertEquals(ThermostatChange.ActorType.ECOBEE, ecobee.getActorType());
        assertEquals("ecobee", ecobee.getActorName());
        assertNull(ecobee.getActorUserId());
    }

    @Test
    @DisplayName("an app command older than the window no longer claims changes")
    void windowExpires() throws Exception {
        recorder.expect(device, bryan);
        clock.now = T0.plus(ThermostatChangeRecorder.COMMAND_WINDOW).plusSeconds(1);
        assertEquals(ThermostatChange.ActorType.ECOBEE, record(cool(72, null), cool(74, null), null).getActorType());
    }

    @Test
    @DisplayName("a failed command is withdrawn")
    void cancelled() throws Exception {
        recorder.expect(device, bryan);
        recorder.cancel(device, bryan);
        assertEquals(ThermostatChange.ActorType.ECOBEE, record(cool(72, null), cool(74, null), null).getActorType());
    }

    @Test
    @DisplayName("cancel leaves another user's newer command alone")
    void cancelOnlyOwn() throws Exception {
        ThermostatChangeRecorder.Actor kim = new ThermostatChangeRecorder.Actor(7L, "Kim");
        recorder.expect(device, bryan);
        recorder.expect(device, kim);
        recorder.cancel(device, bryan);
        assertEquals("Kim", record(cool(72, null), cool(74, null), null).getActorName());
    }

    @Test
    @DisplayName("no row for first sightings, offline transitions, or temperature-only updates")
    void ignored() throws Exception {
        assertNull(record(null, cool(72, null), null));
        var offline = new ThermostatChangeRecorder.ControlState(false, null, null, null, null, null);
        assertNull(record(offline, cool(72, null), null));
        assertNull(record(cool(72, null), offline, null));
        assertNull(record(cool(72, "home"), cool(72, "home"), null));
        verify(repo, never()).save(any());
    }

    @Test
    @DisplayName("mode and range changes are named")
    void fields() {
        var auto = new ThermostatChangeRecorder.ControlState(true, null, 68.0, 75.0, "heat_cool", "home");
        assertEquals(List.of("setpoint", "mode"), ThermostatChangeRecorder.changedFields(cool(72, "home"), auto));
        var auto2 = new ThermostatChangeRecorder.ControlState(true, null, 69.0, 75.0, "heat_cool", "home");
        assertEquals(List.of("setpoint"), ThermostatChangeRecorder.changedFields(auto, auto2));
    }

    @Test
    @DisplayName("context user is read from the raw state; absent/blank → null")
    void contextUser() throws Exception {
        assertEquals("abc", ThermostatChangeRecorder.contextUserId(state("abc")));
        assertNull(ThermostatChangeRecorder.contextUserId(state(null)));
        assertNull(ThermostatChangeRecorder.contextUserId(state("")));
        assertNull(ThermostatChangeRecorder.contextUserId(null));
    }
}
