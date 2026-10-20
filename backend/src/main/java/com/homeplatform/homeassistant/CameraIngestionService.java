package com.homeplatform.homeassistant;

import com.homeplatform.model.CameraBatteryReading;
import com.homeplatform.model.CameraStatus;
import com.homeplatform.model.SmartDevice;
import com.homeplatform.repository.CameraBatteryReadingRepository;
import com.homeplatform.repository.CameraStatusRepository;
import com.homeplatform.repository.SmartDeviceRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.HashMap;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.UUID;

/**
 * Writes camera state. {@link #link} (discovery, every snapshot) stores each camera's
 * sibling entities and applies their current states; {@link #onStateChanged} applies
 * live WebSocket updates for any of them. {@code camera_battery_readings} gets a row
 * when a battery camera's level or charging state changes, and one per snapshot so the
 * chart has a steady resolution even when the level holds.
 */
@Service
public class CameraIngestionService {

    static final String SOURCE_PROVIDER = SmartDevice.PROVIDER_HOME_ASSISTANT;

    private final CameraStatusRepository statusRepo;
    private final CameraBatteryReadingRepository readingRepo;
    private final SmartDeviceRepository deviceRepo;
    private final CameraAlertService alerts;

    /** Linked HA entity → smart_devices.id; rebuilt after every link pass. */
    private volatile Map<String, Long> index;

    public CameraIngestionService(CameraStatusRepository statusRepo,
                                  CameraBatteryReadingRepository readingRepo,
                                  SmartDeviceRepository deviceRepo,
                                  CameraAlertService alerts) {
        this.statusRepo = statusRepo;
        this.readingRepo = readingRepo;
        this.deviceRepo = deviceRepo;
        this.alerts = alerts;
    }

    /** Store the camera's links and apply the current state of everything linked. */
    @Transactional
    public void link(SmartDevice camera, CameraLinker.Link link, Map<String, HaEntityState> states,
                     ThermostatIngestionService.Source source, UUID batchId) {
        CameraStatus st = statusRepo.findByDeviceId(camera.getId())
                .orElseGet(() -> CameraStatus.builder().deviceId(camera.getId()).build());
        st.setStreamName(link.streamName());
        st.setBatteryEntityId(link.batteryEntityId());
        st.setChargingEntityId(link.chargingEntityId());
        st.setMotionEntityId(link.motionEntityId());
        st.setPersonEntityId(link.personEntityId());
        if (link.batteryEntityId() == null) st.setPowerSource(CameraStatus.POWER_WIRED);

        HaEntityState cam = states.get(camera.getProviderEntityId());
        if (cam != null) setAvailable(st, cam.isAvailable());
        applyMotion(st, states.get(link.motionEntityId()), states.get(link.personEntityId()));
        boolean batteryChanged = applyBattery(st, states.get(link.batteryEntityId()), states.get(link.chargingEntityId()));
        st.setUpdatedAt(now());
        statusRepo.save(st);
        record(st, source, batteryChanged, batchId);
    }

    /** Re-read the index after a link pass (called once per discovery, not per camera). */
    public void reindex() {
        Map<String, Long> m = new HashMap<>();
        for (CameraStatus st : statusRepo.findAll()) {
            deviceRepo.findById(st.getDeviceId()).ifPresent(d -> m.put(d.getProviderEntityId(), d.getId()));
            put(m, st.getBatteryEntityId(), st.getDeviceId());
            put(m, st.getChargingEntityId(), st.getDeviceId());
            put(m, st.getMotionEntityId(), st.getDeviceId());
            put(m, st.getPersonEntityId(), st.getDeviceId());
        }
        index = Map.copyOf(m);
    }

    /** Whether a live event for this entity concerns a camera. Cheap — no DB access. */
    public boolean handles(String entityId) {
        Map<String, Long> m = index;
        if (m == null) {
            reindex();
            m = index;
        }
        return m.containsKey(entityId);
    }

    /** Apply one live state change. Ignores entities no camera links to. */
    @Transactional
    public void onStateChanged(HaEntityState s, UUID batchId) {
        Map<String, Long> m = index;
        Long deviceId = m == null ? null : m.get(s.entityId());
        if (deviceId == null) return;
        Optional<SmartDevice> device = deviceRepo.findById(deviceId).filter(SmartDevice::isEnabled);
        Optional<CameraStatus> found = statusRepo.findByDeviceId(deviceId);
        if (device.isEmpty() || found.isEmpty()) return;
        CameraStatus st = found.get();
        String id = s.entityId();
        boolean batteryChanged = false;
        LocalDateTime personBefore = st.getLastPersonAt();
        if (id.equals(device.get().getProviderEntityId())) {
            setAvailable(st, s.isAvailable());
        } else if (id.equals(st.getBatteryEntityId())) {
            batteryChanged = applyBattery(st, s, null);
        } else if (id.equals(st.getChargingEntityId())) {
            batteryChanged = applyCharging(st, s);
        } else if (id.equals(st.getMotionEntityId())) {
            applyMotion(st, s, null);
        } else if (id.equals(st.getPersonEntityId())) {
            applyMotion(st, null, s);
        }
        st.setUpdatedAt(now());
        statusRepo.save(st);
        record(st, ThermostatIngestionService.Source.EVENT, batteryChanged, batchId);
        // Only a live "on" edge is an event — never the state re-read by a link pass.
        if (st.getLastPersonAt() != null && !st.getLastPersonAt().equals(personBefore)) {
            alerts.personDetected(device.get(), st);
        }
    }

    /** Tracks when a camera went offline, for the offline alert's grace period. */
    private static void setAvailable(CameraStatus st, boolean available) {
        if (available) st.setUnavailableSince(null);
        else if (st.getUnavailableSince() == null || st.isAvailable()) st.setUnavailableSince(now());
        st.setAvailable(available);
    }

    // ── state application (mutates st; returns whether battery state changed) ──

    private static boolean applyBattery(CameraStatus st, HaEntityState battery, HaEntityState charging) {
        boolean changed = false;
        Double pct = CameraLinker.batteryPercent(battery);
        if (pct != null) {
            changed = !Objects.equals(pct, st.getBatteryPercent());
            st.setBatteryPercent(pct);
            st.setBatteryUpdatedAt(utc(stamp(battery)));
            // Only a camera on battery reports a level — wired models report none.
            st.setPowerSource(CameraStatus.POWER_BATTERY);
        }
        if (charging != null) changed |= applyCharging(st, charging);
        return changed;
    }

    private static boolean applyCharging(CameraStatus st, HaEntityState s) {
        Boolean charging = CameraLinker.charging(s);
        String label = CameraLinker.chargingLabel(s);
        boolean changed = !Objects.equals(charging, st.getCharging()) || !Objects.equals(label, st.getChargingStatus());
        st.setCharging(charging);
        st.setChargingStatus(label);
        return changed;
    }

    /** Motion/person sensors are push-driven: "on" marks the moment of the event. */
    private static void applyMotion(CameraStatus st, HaEntityState motion, HaEntityState person) {
        if (motion != null && "on".equals(motion.state())) st.setLastMotionAt(utc(changedAt(motion)));
        if (person != null && "on".equals(person.state())) st.setLastPersonAt(utc(changedAt(person)));
    }

    private void record(CameraStatus st, ThermostatIngestionService.Source source, boolean changed, UUID batchId) {
        if (!CameraStatus.POWER_BATTERY.equals(st.getPowerSource()) || st.getBatteryPercent() == null) return;
        if (source == ThermostatIngestionService.Source.EVENT) {
            if (!changed) return;
            Optional<CameraBatteryReading> last = readingRepo.findTopByDeviceIdOrderByRecordedAtDesc(st.getDeviceId());
            if (last.isPresent() && Objects.equals(last.get().getBatteryPercent(), st.getBatteryPercent())
                    && Objects.equals(last.get().getCharging(), st.getCharging())
                    && Objects.equals(last.get().getChargingStatus(), st.getChargingStatus())) {
                return;
            }
        }
        // Ingest time, not HA's last_updated: a charging-only change would otherwise
        // be stamped with the level's older time and land out of order.
        readingRepo.save(CameraBatteryReading.builder()
                .deviceId(st.getDeviceId())
                .recordedAt(now())
                .batteryPercent(st.getBatteryPercent())
                .charging(st.getCharging())
                .chargingStatus(st.getChargingStatus())
                .source(source.value)
                .sourceProvider(SOURCE_PROVIDER)
                .ingestionBatchId(batchId)
                .createdAt(now())
                .build());
    }

    private static Instant stamp(HaEntityState s) {
        return s.lastUpdated() != null ? s.lastUpdated() : s.lastChanged() != null ? s.lastChanged() : Instant.now();
    }

    private static Instant changedAt(HaEntityState s) {
        return s.lastChanged() != null ? s.lastChanged() : stamp(s);
    }

    private static void put(Map<String, Long> m, String entityId, Long deviceId) {
        if (entityId != null) m.put(entityId, deviceId);
    }

    private static LocalDateTime now() {
        return LocalDateTime.now(ZoneOffset.UTC);
    }

    private static LocalDateTime utc(Instant i) {
        return i == null ? null : LocalDateTime.ofInstant(i, ZoneOffset.UTC);
    }
}
