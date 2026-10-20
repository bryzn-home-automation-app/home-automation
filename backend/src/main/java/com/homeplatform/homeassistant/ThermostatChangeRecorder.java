package com.homeplatform.homeassistant;

import com.homeplatform.model.SmartDevice;
import com.homeplatform.model.ThermostatChange;
import com.homeplatform.repository.ThermostatChangeRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Works out who changed a thermostat's setpoint, mode, or hold.
 *
 * <p>App commands register an expectation <em>before</em> calling HA ({@link #expect}) —
 * HA's {@code state_changed} event can reach the WebSocket before the REST call that
 * caused it returns. When ingestion then sees a control field change ({@link #onIngested}):
 * <ol>
 *   <li>a command for that device within {@link #COMMAND_WINDOW} whose kind explains the
 *       change ({@link Command#explains}) → the app user;</li>
 *   <li>else an HA context user (someone using HA's own UI) → "Home Assistant";</li>
 *   <li>else → "ecobee" (the thermostat screen, the ecobee app, or its schedule).</li>
 * </ol>
 * The window is generous because HA re-polls ecobee every 3 minutes and the hold's
 * echo (e.g. preset becoming "temp") can arrive on a later poll. Matching on the kind of
 * change keeps that window from swallowing unrelated changes — e.g. the ecobee schedule
 * switching comfort setting a minute after someone nudged the setpoint stays "ecobee".
 * Expectations live in memory: after a backend restart, an in-flight command is
 * credited to Home Assistant.
 */
@Service
public class ThermostatChangeRecorder {

    static final Duration COMMAND_WINDOW = Duration.ofMinutes(5);
    static final String ECOBEE_NAME = "ecobee";
    static final String HOME_ASSISTANT_NAME = "Home Assistant";

    /** The app user behind a command. */
    public record Actor(Long userId, String name) {}

    /** What an app command changes — and so which observed changes it can account for. */
    public enum Command {
        /** A new setpoint; ecobee echoes it as a manual hold (preset "temp"). */
        SETPOINT,
        /** A new HVAC mode; ecobee may report the new mode's setpoints alongside. */
        MODE,
        /** A comfort-setting hold, which brings that setting's setpoints. */
        HOLD,
        /** Back to the schedule: its current comfort setting and setpoints. */
        RESUME;

        boolean explains(List<String> fields, ControlState after) {
            return switch (this) {
                case SETPOINT -> only(fields, "setpoint", "preset")
                        && (!fields.contains("preset") || "temp".equals(after.presetMode()));
                case MODE -> only(fields, "mode", "setpoint");
                case HOLD, RESUME -> only(fields, "preset", "setpoint");
            };
        }

        private static boolean only(List<String> fields, String... allowed) {
            return List.of(allowed).containsAll(fields);
        }
    }

    /** Control-relevant state, captured before ingestion overwrites the status row. */
    public record ControlState(boolean available, Double targetTemperature, Double heatSetpoint,
                               Double coolSetpoint, String hvacMode, String presetMode) {

        static ControlState of(ThermostatSnapshot s) {
            return new ControlState(s.available(), s.targetTemperature(), s.heatSetpoint(),
                    s.coolSetpoint(), s.hvacMode(), s.presetMode());
        }
    }

    private record Expectation(Actor actor, Command command, Instant at) {}

    private final ThermostatChangeRepository repo;
    private final Clock clock;
    private final Map<Long, Expectation> expected = new ConcurrentHashMap<>();

    @Autowired // two constructors: tell Spring which one (the other injects a test clock)
    public ThermostatChangeRecorder(ThermostatChangeRepository repo) {
        this(repo, Clock.systemUTC());
    }

    ThermostatChangeRecorder(ThermostatChangeRepository repo, Clock clock) {
        this.repo = repo;
        this.clock = clock;
    }

    /**
     * An app user is about to change this device; credit matching changes in the next few
     * minutes to them.
     */
    public void expect(SmartDevice device, Actor actor, Command command) {
        if (actor == null) return;
        expected.put(device.getId(), new Expectation(actor, command, clock.instant()));
    }

    /** The command failed — don't credit the next ecobee-side change to this user. */
    public void cancel(SmartDevice device, Actor actor) {
        if (actor == null) return;
        expected.computeIfPresent(device.getId(), (id, e) -> e.actor().equals(actor) ? null : e);
    }

    /**
     * Records a change row when a control field differs between {@code before} and
     * {@code after}. Ignores first sightings and anything involving an unavailable state
     * (a thermostat dropping offline isn't someone changing it).
     */
    public Optional<ThermostatChange> onIngested(SmartDevice device, ControlState before, ControlState after,
                                                 HaEntityState state, String source, UUID batchId) {
        if (before == null || !before.available() || !after.available()) return Optional.empty();
        List<String> fields = changedFields(before, after);
        if (fields.isEmpty()) return Optional.empty();

        ThermostatChange.ActorType type;
        Long userId = null;
        String name;
        Optional<Actor> app = recentCommand(device.getId())
                .filter(e -> e.command().explains(fields, after))
                .map(Expectation::actor);
        if (app.isPresent()) {
            type = ThermostatChange.ActorType.APP;
            userId = app.get().userId();
            name = app.get().name();
        } else if (contextUserId(state) != null) {
            type = ThermostatChange.ActorType.HOME_ASSISTANT;
            name = HOME_ASSISTANT_NAME;
        } else {
            type = ThermostatChange.ActorType.ECOBEE;
            name = ECOBEE_NAME;
        }

        Instant at = state != null && state.lastUpdated() != null ? state.lastUpdated() : clock.instant();
        return Optional.of(repo.save(ThermostatChange.builder()
                .deviceId(device.getId())
                .changedAt(LocalDateTime.ofInstant(at, ZoneOffset.UTC))
                .changedFields(String.join(",", fields))
                .actorType(type)
                .actorUserId(userId)
                .actorName(name)
                .hvacMode(after.hvacMode())
                .presetMode(after.presetMode())
                .targetTemperature(after.targetTemperature())
                .heatSetpoint(after.heatSetpoint())
                .coolSetpoint(after.coolSetpoint())
                .source(source)
                .sourceProvider(SmartDevice.PROVIDER_HOME_ASSISTANT)
                .ingestionBatchId(batchId)
                .createdAt(LocalDateTime.now(clock.withZone(ZoneOffset.UTC)))
                .build()));
    }

    static List<String> changedFields(ControlState a, ControlState b) {
        List<String> out = new ArrayList<>(3);
        if (!Objects.equals(a.targetTemperature(), b.targetTemperature())
                || !Objects.equals(a.heatSetpoint(), b.heatSetpoint())
                || !Objects.equals(a.coolSetpoint(), b.coolSetpoint())) {
            out.add("setpoint");
        }
        if (!Objects.equals(a.hvacMode(), b.hvacMode())) out.add("mode");
        if (!Objects.equals(a.presetMode(), b.presetMode())) out.add("preset");
        return out;
    }

    private Optional<Expectation> recentCommand(Long deviceId) {
        Expectation e = expected.get(deviceId);
        if (e == null) return Optional.empty();
        if (Duration.between(e.at(), clock.instant()).compareTo(COMMAND_WINDOW) > 0) {
            expected.remove(deviceId, e);
            return Optional.empty();
        }
        return Optional.of(e);
    }

    /** {@code context.user_id} of the state — set when an HA user (or token) caused it. */
    static String contextUserId(HaEntityState state) {
        if (state == null || state.raw() == null) return null;
        var n = state.raw().path("context").path("user_id");
        return n.isTextual() && !n.asText().isBlank() ? n.asText() : null;
    }
}
