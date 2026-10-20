package com.homeplatform.homeassistant;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.homeplatform.model.SmartDevice;
import com.homeplatform.repository.SmartDeviceRepository;
import com.homeplatform.service.AppEventService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * Application-level Home Assistant operations: discovery, snapshot ingestion, live
 * event ingestion, and the HA calls behind thermostat commands. Queries and request
 * validation live in {@link HomeDeviceService}; this class is what touches HA.
 */
@Service
public class HomeAssistantService {

    private static final Logger log = LoggerFactory.getLogger(HomeAssistantService.class);
    static final String EVENT_CATEGORY = "home-assistant";

    private final HomeAssistantClient client;
    private final DeviceDiscoveryService discovery;
    private final ThermostatIngestionService ingestion;
    private final CameraIngestionService cameras;
    private final SmartDeviceRepository deviceRepo;
    private final AppEventService appEventService;
    private final ObjectMapper mapper;

    /**
     * Serializes every write of HA state into Postgres. Ingestion runs on three threads -
     * the WebSocket worker, the snapshot scheduler, and the request thread's post-command
     * refresh - and each does read-then-write (status "before", insert-if-missing). Run
     * concurrently, one command was recorded twice in "set by" history, and two discovery
     * passes could both insert the same new camera. HA calls happen outside the lock.
     */
    private final Object ingestLock = new Object();

    /** HA's configured temperature unit, fetched once per process (null until known). */
    private volatile String temperatureUnit;

    public HomeAssistantService(HomeAssistantClient client,
                                DeviceDiscoveryService discovery,
                                ThermostatIngestionService ingestion,
                                CameraIngestionService cameras,
                                SmartDeviceRepository deviceRepo,
                                AppEventService appEventService,
                                ObjectMapper mapper) {
        this.client = client;
        this.discovery = discovery;
        this.ingestion = ingestion;
        this.cameras = cameras;
        this.deviceRepo = deviceRepo;
        this.appEventService = appEventService;
        this.mapper = mapper;
    }

    public boolean isActive() {
        return client.isActive();
    }

    /**
     * Pull all HA states, upsert devices, record a snapshot reading for each enabled
     * thermostat, and refresh camera links + battery snapshots.
     */
    public SyncResult discoverAndSnapshot() {
        // HA calls first, outside the lock.
        List<HaEntityState> states = client.getStates();
        String unit = unit();
        String cameraLinks = states.stream().anyMatch(s -> "camera".equals(s.domain())) ? renderCameraLinks() : null;

        synchronized (ingestLock) {
            DeviceDiscoveryService.Result found = discovery.upsertAll(states);
            if (found.added() > 0) {
                appEventService.info(EVENT_CATEGORY, "HomeAssistantService",
                        "Discovered " + found.added() + " new device(s) — " + found.thermostats()
                                + " thermostat(s), " + found.cameras() + " camera(s) total");
            }
            UUID batch = UUID.randomUUID();
            int written = 0;
            for (HaEntityState s : states) {
                if (!"climate".equals(s.domain())) continue;
                SmartDevice d = deviceRepo.findByProviderEntityId(s.entityId()).orElse(null);
                if (d == null || !d.isEnabled()) continue;
                if (ingestion.ingest(d, s, unit, ThermostatIngestionService.Source.SNAPSHOT, batch)) written++;
            }
            if (found.cameras() > 0) linkCameras(states, cameraLinks, batch);
            return new SyncResult(found, written, batch);
        }
    }

    /** The device-registry template for camera links, or null when HA can't render it. */
    private String renderCameraLinks() {
        try {
            return client.renderTemplate(CameraLinker.TEMPLATE);
        } catch (HomeAssistantException e) {
            log.warn("Could not resolve camera entities: {}", e.getMessage());
            return null;
        }
    }

    /**
     * Resolve each camera's battery/charging/motion/person entities and stream name.
     * Best-effort: a failure leaves cameras listed, just without battery or live view.
     */
    void linkCameras(List<HaEntityState> states, String rendered, UUID batch) {
        Map<String, HaEntityState> byId = new HashMap<>();
        for (HaEntityState s : states) byId.put(s.entityId(), s);
        try {
            if (rendered == null) return;
            for (CameraLinker.Link link : CameraLinker.parse(rendered, mapper, byId)) {
                deviceRepo.findByProviderEntityId(link.cameraEntityId())
                        .filter(SmartDevice::isEnabled)
                        .filter(d -> d.getKind() == SmartDevice.Kind.CAMERA)
                        .ifPresent(d -> cameras.link(d, link, byId, ThermostatIngestionService.Source.SNAPSHOT, batch));
            }
        } catch (HomeAssistantException e) {
            log.warn("Could not resolve camera entities: {}", e.getMessage());
        } finally {
            cameras.reindex();
        }
    }

    public record SyncResult(DeviceDiscoveryService.Result devices, int readingsWritten, UUID batchId) {}

    /** Live WebSocket update for an enabled thermostat or a camera's entities. Never throws. */
    public void handleStateChanged(HaEntityState state, UUID sessionBatchId) {
        if (!"climate".equals(state.domain())) {
            try {
                if (!cameras.handles(state.entityId())) return;
                synchronized (ingestLock) {
                    cameras.onStateChanged(state, sessionBatchId);
                }
            } catch (Exception e) {
                log.warn("Failed to ingest HA state for a camera: {}", e.getMessage());
            }
            return;
        }
        try {
            Optional<SmartDevice> device = deviceRepo.findByProviderEntityId(state.entityId())
                    .filter(SmartDevice::isEnabled)
                    .filter(d -> d.getKind() == SmartDevice.Kind.THERMOSTAT);
            if (device.isEmpty()) return;
            String unit = unit();
            synchronized (ingestLock) {
                ingestion.ingest(device.get(), state, unit, ThermostatIngestionService.Source.EVENT, sessionBatchId);
            }
        } catch (Exception e) {
            log.warn("Failed to ingest HA state for a thermostat: {}", e.getMessage());
        }
    }

    // ── commands (validated by HomeDeviceService before reaching here) ──

    public void setHvacMode(SmartDevice d, String mode) {
        client.callService("climate", "set_hvac_mode", Map.of("entity_id", d.getProviderEntityId(), "hvac_mode", mode));
        refresh(d);
    }

    public void setTemperature(SmartDevice d, double temperature) {
        client.callService("climate", "set_temperature", Map.of("entity_id", d.getProviderEntityId(), "temperature", temperature));
        refresh(d);
    }

    public void setTemperatureRange(SmartDevice d, double low, double high) {
        client.callService("climate", "set_temperature", Map.of(
                "entity_id", d.getProviderEntityId(), "target_temp_low", low, "target_temp_high", high));
        refresh(d);
    }

    public void setPreset(SmartDevice d, String preset) {
        client.callService("climate", "set_preset_mode", Map.of("entity_id", d.getProviderEntityId(), "preset_mode", preset));
        refresh(d);
    }

    /** ecobee-specific "resume schedule". Returns false when HA has no such service. */
    public boolean resumeProgram(SmartDevice d) {
        if (!client.hasService("ecobee", "resume_program")) return false;
        client.callService("ecobee", "resume_program", Map.of("entity_id", d.getProviderEntityId(), "resume_all", false));
        refresh(d);
        return true;
    }

    public HomeAssistantClient.CameraImage cameraSnapshot(SmartDevice d) {
        return client.getCameraSnapshot(d.getProviderEntityId());
    }

    /** Re-read one thermostat after a command so the API reflects it without waiting for the WebSocket. */
    private void refresh(SmartDevice d) {
        try {
            Optional<HaEntityState> state = client.getState(d.getProviderEntityId());
            if (state.isEmpty()) return;
            String unit = unit();
            synchronized (ingestLock) {
                ingestion.ingest(d, state.get(), unit, ThermostatIngestionService.Source.EVENT, UUID.randomUUID());
            }
        } catch (HomeAssistantException e) {
            log.debug("Post-command refresh failed: {}", e.getMessage());
        }
    }

    String unit() {
        String u = temperatureUnit;
        if (u != null) return u;
        try {
            u = client.getTemperatureUnit();
        } catch (HomeAssistantException e) {
            log.debug("Could not read HA temperature unit: {}", e.getMessage());
        }
        if (u == null) return EntityMapper.DEFAULT_UNIT;
        temperatureUnit = u;
        return u;
    }
}
