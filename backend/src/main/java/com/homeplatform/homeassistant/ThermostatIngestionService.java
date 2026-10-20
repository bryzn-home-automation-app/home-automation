package com.homeplatform.homeassistant;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.homeplatform.model.SmartDevice;
import com.homeplatform.model.ThermostatReading;
import com.homeplatform.model.ThermostatStatus;
import com.homeplatform.repository.ThermostatReadingRepository;
import com.homeplatform.repository.ThermostatStatusRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;

/**
 * Writes normalized thermostat state. Every call UPSERTs {@code thermostat_status};
 * {@code thermostat_readings} (append-only) gets a row when:
 * <ul>
 *   <li>{@link Source#EVENT} — a WebSocket {@code state_changed} actually changed a
 *       meaningful field vs. the last reading (duplicates and attribute-only noise are
 *       dropped). Timestamped with HA's {@code last_updated}.</li>
 *   <li>{@link Source#SNAPSHOT} — the periodic fallback, timestamped at sample time so
 *       history has a steady resolution even when nothing changes.</li>
 * </ul>
 * Unavailable states update status only — no all-null history rows. Setpoint/mode/hold
 * changes also go to {@link ThermostatChangeRecorder} for "set by" attribution.
 */
@Service
public class ThermostatIngestionService {

    public enum Source {
        EVENT("ha_websocket"),
        SNAPSHOT("ha_snapshot");

        final String value;

        Source(String value) { this.value = value; }
    }

    static final String SOURCE_PROVIDER = SmartDevice.PROVIDER_HOME_ASSISTANT;

    private final ThermostatStatusRepository statusRepo;
    private final ThermostatReadingRepository readingRepo;
    private final ThermostatChangeRecorder changes;
    private final ObjectMapper mapper;

    public ThermostatIngestionService(ThermostatStatusRepository statusRepo,
                                      ThermostatReadingRepository readingRepo,
                                      ThermostatChangeRecorder changes,
                                      ObjectMapper mapper) {
        this.statusRepo = statusRepo;
        this.readingRepo = readingRepo;
        this.changes = changes;
        this.mapper = mapper;
    }

    /** @return true when a history row was appended. */
    @Transactional
    public boolean ingest(SmartDevice device, HaEntityState state, String unit, Source source, UUID batchId) {
        ThermostatSnapshot snap = EntityMapper.toThermostat(state, unit);
        // Captured before upsertStatus, which mutates the same row in place.
        ThermostatChangeRecorder.ControlState before = statusRepo.findByDeviceId(device.getId())
                .map(ThermostatIngestionService::controlState).orElse(null);
        upsertStatus(device.getId(), snap, state);
        changes.onIngested(device, before, ThermostatChangeRecorder.ControlState.of(snap), state, source.value, batchId);

        if (!snap.available()) return false;

        Optional<ThermostatReading> last = readingRepo.findTopByDeviceIdOrderByRecordedAtDesc(device.getId());
        if (source == Source.EVENT && last.isPresent() && !changed(snap, last.get())) {
            return false;
        }

        Instant at = source == Source.SNAPSHOT ? Instant.now() : snap.recordedAt();
        readingRepo.save(ThermostatReading.builder()
                .deviceId(device.getId())
                .recordedAt(utc(at))
                .temperature(snap.temperature())
                .humidity(snap.humidity())
                .targetTemperature(snap.targetTemperature())
                .heatSetpoint(snap.heatSetpoint())
                .coolSetpoint(snap.coolSetpoint())
                .hvacMode(snap.hvacMode())
                .hvacAction(snap.hvacAction())
                .presetMode(snap.presetMode())
                .temperatureUnit(snap.temperatureUnit())
                .source(source.value)
                .sourceProvider(SOURCE_PROVIDER)
                .ingestionBatchId(batchId)
                .createdAt(LocalDateTime.now(ZoneOffset.UTC))
                .build());
        return true;
    }

    /** True when any field we chart or act on differs from the last stored reading. */
    static boolean changed(ThermostatSnapshot s, ThermostatReading r) {
        return !Objects.equals(s.temperature(), r.getTemperature())
                || !Objects.equals(s.humidity(), r.getHumidity())
                || !Objects.equals(s.targetTemperature(), r.getTargetTemperature())
                || !Objects.equals(s.heatSetpoint(), r.getHeatSetpoint())
                || !Objects.equals(s.coolSetpoint(), r.getCoolSetpoint())
                || !Objects.equals(s.hvacMode(), r.getHvacMode())
                || !Objects.equals(s.hvacAction(), r.getHvacAction())
                || !Objects.equals(s.presetMode(), r.getPresetMode());
    }

    private static ThermostatChangeRecorder.ControlState controlState(ThermostatStatus st) {
        return new ThermostatChangeRecorder.ControlState(st.isAvailable(), st.getTargetTemperature(),
                st.getHeatSetpoint(), st.getCoolSetpoint(), st.getHvacMode(), st.getPresetMode());
    }

    private void upsertStatus(Long deviceId, ThermostatSnapshot s, HaEntityState state) {
        ThermostatStatus st = statusRepo.findByDeviceId(deviceId)
                .orElseGet(() -> ThermostatStatus.builder().deviceId(deviceId).build());
        st.setAvailable(s.available());
        st.setTemperature(s.temperature());
        st.setHumidity(s.humidity());
        st.setTargetTemperature(s.targetTemperature());
        st.setHeatSetpoint(s.heatSetpoint());
        st.setCoolSetpoint(s.coolSetpoint());
        st.setHvacMode(s.hvacMode());
        st.setHvacAction(s.hvacAction());
        st.setPresetMode(s.presetMode());
        st.setTemperatureUnit(s.temperatureUnit());
        st.setMinTemp(s.minTemp());
        st.setMaxTemp(s.maxTemp());
        st.setHvacModes(json(s.hvacModes()));
        st.setPresetModes(json(s.presetModes()));
        st.setStateUpdatedAt(utc(s.recordedAt()));
        st.setRaw(state.raw() == null ? null : state.raw().toString());
        st.setUpdatedAt(LocalDateTime.now(ZoneOffset.UTC));
        statusRepo.save(st);
    }

    private String json(List<String> values) {
        try {
            return mapper.writeValueAsString(values == null ? List.of() : values);
        } catch (JsonProcessingException e) {
            return "[]";
        }
    }

    private static LocalDateTime utc(Instant i) {
        return i == null ? null : LocalDateTime.ofInstant(i, ZoneOffset.UTC);
    }
}
