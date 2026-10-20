package com.homeplatform.homeassistant;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.homeplatform.dto.*;
import com.homeplatform.model.SmartDevice;
import com.homeplatform.model.ThermostatChange;
import com.homeplatform.model.ThermostatReading;
import com.homeplatform.model.ThermostatStatus;
import com.homeplatform.repository.SmartDeviceRepository;
import com.homeplatform.repository.ThermostatChangeRepository;
import com.homeplatform.repository.ThermostatReadingRepository;
import com.homeplatform.repository.ThermostatStatusRepository;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.Arrays;
import java.util.List;
import java.util.Set;
import java.util.UUID;

/**
 * The app-facing smart-home API behind {@code /api/home/*}: resolves public device IDs,
 * validates commands, and maps rows to DTOs. HA entity IDs never leave this layer.
 */
@Service
public class HomeDeviceService {

    /** Device ID unknown, malformed, wrong kind, or disabled → 404. */
    public static class NotFound extends RuntimeException {
        public NotFound() { super("Device not found"); }
    }

    /** The device/HA can't do what was asked → 422 (or 501 when {@code notImplemented}). */
    public static class Unsupported extends RuntimeException {
        private final boolean notImplemented;

        public Unsupported(String message, boolean notImplemented) {
            super(message);
            this.notImplemented = notImplemented;
        }

        public boolean isNotImplemented() { return notImplemented; }
    }

    static final Duration DEFAULT_HISTORY = Duration.ofHours(24);
    static final Duration MAX_HISTORY = Duration.ofDays(93);
    private static final Set<String> RANGE_MODES = Set.of("heat_cool", "auto");

    private final HomeAssistantService ha;
    private final SmartDeviceRepository deviceRepo;
    private final ThermostatStatusRepository statusRepo;
    private final ThermostatReadingRepository readingRepo;
    private final ThermostatChangeRepository changeRepo;
    private final ThermostatChangeRecorder recorder;
    private final ObjectMapper mapper;

    public HomeDeviceService(HomeAssistantService ha,
                             SmartDeviceRepository deviceRepo,
                             ThermostatStatusRepository statusRepo,
                             ThermostatReadingRepository readingRepo,
                             ThermostatChangeRepository changeRepo,
                             ThermostatChangeRecorder recorder,
                             ObjectMapper mapper) {
        this.ha = ha;
        this.deviceRepo = deviceRepo;
        this.statusRepo = statusRepo;
        this.readingRepo = readingRepo;
        this.changeRepo = changeRepo;
        this.recorder = recorder;
        this.mapper = mapper;
    }

    // ── thermostat reads (served from Postgres; 503 only when the integration is off) ──

    public List<ThermostatResponse> listThermostats() {
        requireConfigured();
        return deviceRepo.findByKindAndEnabledTrueOrderByNameAsc(SmartDevice.Kind.THERMOSTAT).stream()
                .map(this::toThermostat)
                .toList();
    }

    public ThermostatResponse getThermostat(String id) {
        requireConfigured();
        return toThermostat(device(id, SmartDevice.Kind.THERMOSTAT));
    }

    public List<ThermostatReadingResponse> history(String id, Instant from, Instant to) {
        requireConfigured();
        SmartDevice d = device(id, SmartDevice.Kind.THERMOSTAT);
        Instant end = to != null ? to : Instant.now();
        Instant start = from != null ? from : end.minus(DEFAULT_HISTORY);
        if (!start.isBefore(end)) throw new IllegalArgumentException("'from' must be before 'to'");
        if (Duration.between(start, end).compareTo(MAX_HISTORY) > 0) {
            throw new IllegalArgumentException("History range is limited to " + MAX_HISTORY.toDays() + " days");
        }
        return readingRepo.findByDeviceIdAndRecordedAtBetweenOrderByRecordedAtAsc(d.getId(), utc(start), utc(end))
                .stream().map(HomeDeviceService::toReading).toList();
    }

    /** Recent setpoint/mode/hold changes, newest first ({@code limit} capped at 100). */
    public List<ThermostatChangeResponse> changes(String id, int limit) {
        requireConfigured();
        SmartDevice d = device(id, SmartDevice.Kind.THERMOSTAT);
        int n = Math.max(1, Math.min(limit, 100));
        return changeRepo.findByDeviceIdOrderByChangedAtDesc(d.getId(), PageRequest.of(0, n))
                .stream().map(HomeDeviceService::toChange).toList();
    }

    // ── thermostat commands ──
    // Each takes the acting app user (null = unattributed) so the change it causes is
    // credited to them — see ThermostatChangeRecorder.

    public ThermostatResponse setMode(String id, String mode) {
        return setMode(id, mode, null);
    }

    public ThermostatResponse setMode(String id, String mode, ThermostatChangeRecorder.Actor actor) {
        requireConfigured();
        SmartDevice d = device(id, SmartDevice.Kind.THERMOSTAT);
        ThermostatStatus st = status(d);
        if (mode == null || mode.isBlank()) throw new IllegalArgumentException("'mode' is required");
        List<String> supported = st == null ? List.of() : list(st.getHvacModes());
        boolean ok = supported.isEmpty() ? EntityMapper.KNOWN_HVAC_MODES.contains(mode) : supported.contains(mode);
        if (!ok) throw new IllegalArgumentException("Unsupported mode: " + mode);
        attributed(d, actor, () -> ha.setHvacMode(d, mode));
        return toThermostat(d);
    }

    public ThermostatResponse setTemperature(String id, ThermostatTemperatureRequest req) {
        return setTemperature(id, req, null);
    }

    public ThermostatResponse setTemperature(String id, ThermostatTemperatureRequest req,
                                             ThermostatChangeRecorder.Actor actor) {
        requireConfigured();
        SmartDevice d = device(id, SmartDevice.Kind.THERMOSTAT);
        ThermostatStatus st = status(d);
        if (req == null) throw new IllegalArgumentException("Request body is required");
        String mode = st == null ? null : st.getHvacMode();
        if ("off".equals(mode)) throw new Unsupported("Thermostat is off — change the mode first", false);

        boolean single = req.temperature() != null;
        boolean range = req.low() != null || req.high() != null;
        if (single == range) {
            throw new IllegalArgumentException("Provide either 'temperature' or both 'low' and 'high'");
        }
        double[] bounds = bounds(st);
        if (single) {
            if (mode != null && RANGE_MODES.contains(mode)) {
                throw new IllegalArgumentException("Mode " + mode + " needs 'low' and 'high'");
            }
            double t = checkTemp(req.temperature(), bounds);
            attributed(d, actor, () -> ha.setTemperature(d, t));
        } else {
            if (req.low() == null || req.high() == null) {
                throw new IllegalArgumentException("Both 'low' and 'high' are required");
            }
            if (mode != null && !RANGE_MODES.contains(mode)) {
                throw new IllegalArgumentException("Mode " + mode + " takes a single 'temperature'");
            }
            double low = checkTemp(req.low(), bounds);
            double high = checkTemp(req.high(), bounds);
            if (low >= high) throw new IllegalArgumentException("'low' must be below 'high'");
            attributed(d, actor, () -> ha.setTemperatureRange(d, low, high));
        }
        return toThermostat(d);
    }

    public ThermostatResponse hold(String id, String preset) {
        return hold(id, preset, null);
    }

    public ThermostatResponse hold(String id, String preset, ThermostatChangeRecorder.Actor actor) {
        requireConfigured();
        SmartDevice d = device(id, SmartDevice.Kind.THERMOSTAT);
        ThermostatStatus st = status(d);
        List<String> presets = st == null ? List.of() : list(st.getPresetModes());
        if (presets.isEmpty()) throw new Unsupported("This thermostat exposes no presets to hold", false);
        if (preset == null || preset.isBlank()) throw new IllegalArgumentException("'preset' is required");
        if (!presets.contains(preset)) throw new IllegalArgumentException("Unsupported preset: " + preset);
        attributed(d, actor, () -> ha.setPreset(d, preset));
        return toThermostat(d);
    }

    public ThermostatResponse resume(String id) {
        return resume(id, null);
    }

    public ThermostatResponse resume(String id, ThermostatChangeRecorder.Actor actor) {
        requireConfigured();
        SmartDevice d = device(id, SmartDevice.Kind.THERMOSTAT);
        boolean[] supported = {false};
        attributed(d, actor, () -> supported[0] = ha.resumeProgram(d));
        if (!supported[0]) {
            recorder.cancel(d, actor);
            throw new Unsupported("Home Assistant has no ecobee.resume_program service", true);
        }
        return toThermostat(d);
    }

    /**
     * Registers the actor before calling HA — the resulting state_changed event can
     * arrive before the call returns — and withdraws it if the call fails.
     */
    private void attributed(SmartDevice d, ThermostatChangeRecorder.Actor actor, Runnable call) {
        recorder.expect(d, actor);
        try {
            call.run();
        } catch (RuntimeException e) {
            recorder.cancel(d, actor);
            throw e;
        }
    }

    // ── cameras ──

    public List<CameraResponse> listCameras() {
        requireConfigured();
        return deviceRepo.findByKindAndEnabledTrueOrderByNameAsc(SmartDevice.Kind.CAMERA).stream()
                .map(d -> new CameraResponse(d.getPublicId().toString(), d.getName(), iso(d.getLastSeenAt())))
                .toList();
    }

    public HomeAssistantClient.CameraImage cameraSnapshot(String id) {
        requireConfigured();
        return ha.cameraSnapshot(device(id, SmartDevice.Kind.CAMERA));
    }

    // ── admin ──

    public List<SmartDeviceResponse> listDevices() {
        return deviceRepo.findAllByOrderByKindAscNameAsc().stream().map(HomeDeviceService::toAdmin).toList();
    }

    public SmartDeviceResponse setEnabled(String id, boolean enabled) {
        SmartDevice d = deviceRepo.findByPublicId(parse(id)).orElseThrow(NotFound::new);
        d.setEnabled(enabled);
        d.setUpdatedAt(LocalDateTime.now(ZoneOffset.UTC));
        return toAdmin(deviceRepo.save(d));
    }

    public HomeAssistantService.SyncResult discover() {
        requireConfigured();
        return ha.discoverAndSnapshot();
    }

    // ── helpers ──

    private void requireConfigured() {
        if (!ha.isActive()) throw new HomeAssistantException.Unavailable("Home Assistant integration is not configured");
    }

    private SmartDevice device(String id, SmartDevice.Kind kind) {
        return deviceRepo.findByPublicId(parse(id))
                .filter(SmartDevice::isEnabled)
                .filter(d -> d.getKind() == kind)
                .orElseThrow(NotFound::new);
    }

    private static UUID parse(String id) {
        try {
            return UUID.fromString(id);
        } catch (IllegalArgumentException | NullPointerException e) {
            throw new NotFound();
        }
    }

    private ThermostatStatus status(SmartDevice d) {
        return statusRepo.findByDeviceId(d.getId()).orElse(null);
    }

    /** [min, max] from HA if reported, else sane defaults for the unit. */
    static double[] bounds(ThermostatStatus st) {
        boolean celsius = st != null && "°C".equals(st.getTemperatureUnit());
        double min = st != null && st.getMinTemp() != null ? st.getMinTemp() : (celsius ? 7 : 45);
        double max = st != null && st.getMaxTemp() != null ? st.getMaxTemp() : (celsius ? 33 : 92);
        return new double[]{min, max};
    }

    private static double checkTemp(Double t, double[] bounds) {
        if (t == null || !Double.isFinite(t)) throw new IllegalArgumentException("Temperature must be a number");
        if (t < bounds[0] || t > bounds[1]) {
            throw new IllegalArgumentException("Temperature must be between " + bounds[0] + " and " + bounds[1]);
        }
        return t;
    }

    private ThermostatResponse toThermostat(SmartDevice d) {
        ThermostatStatus st = status(d);
        ThermostatChangeResponse lastChange = changeRepo.findTopByDeviceIdOrderByChangedAtDesc(d.getId())
                .map(HomeDeviceService::toChange).orElse(null);
        if (st == null) {
            return new ThermostatResponse(d.getPublicId().toString(), d.getName(), false,
                    null, null, null, null, null, null, null, null, null, null, null, List.of(), List.of(), null,
                    lastChange);
        }
        return new ThermostatResponse(
                d.getPublicId().toString(), d.getName(), st.isAvailable(),
                st.getTemperature(), st.getHumidity(), st.getTargetTemperature(),
                st.getHeatSetpoint(), st.getCoolSetpoint(),
                st.getHvacMode(), st.getHvacAction(), st.getPresetMode(), st.getTemperatureUnit(),
                st.getMinTemp(), st.getMaxTemp(),
                list(st.getHvacModes()), list(st.getPresetModes()),
                iso(st.getUpdatedAt()), lastChange);
    }

    private static ThermostatChangeResponse toChange(ThermostatChange c) {
        return new ThermostatChangeResponse(iso(c.getChangedAt()),
                c.getActorType().name().toLowerCase(), c.getActorName(), c.getActorUserId(),
                Arrays.asList(c.getChangedFields().split(",")),
                c.getHvacMode(), c.getPresetMode(),
                c.getTargetTemperature(), c.getHeatSetpoint(), c.getCoolSetpoint());
    }

    private static ThermostatReadingResponse toReading(ThermostatReading r) {
        return new ThermostatReadingResponse(iso(r.getRecordedAt()), r.getTemperature(), r.getHumidity(),
                r.getTargetTemperature(), r.getHeatSetpoint(), r.getCoolSetpoint(),
                r.getHvacMode(), r.getHvacAction(), r.getPresetMode(), r.getSource());
    }

    private static SmartDeviceResponse toAdmin(SmartDevice d) {
        return new SmartDeviceResponse(d.getPublicId().toString(), d.getKind().name(), d.getName(),
                d.isEnabled(), iso(d.getLastSeenAt()));
    }

    private List<String> list(String json) {
        if (json == null || json.isBlank()) return List.of();
        try {
            return mapper.readValue(json, new TypeReference<List<String>>() {});
        } catch (Exception e) {
            return List.of();
        }
    }

    private static LocalDateTime utc(Instant i) {
        return LocalDateTime.ofInstant(i, ZoneOffset.UTC);
    }

    private static String iso(LocalDateTime t) {
        return t == null ? null : t.toInstant(ZoneOffset.UTC).toString();
    }
}
