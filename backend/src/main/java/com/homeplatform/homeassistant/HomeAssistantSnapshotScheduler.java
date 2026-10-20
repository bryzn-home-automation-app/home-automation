package com.homeplatform.homeassistant;

import com.homeplatform.service.AppEventService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Profile;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Periodic fallback ingestion: every 15 minutes, re-discover HA devices and append a
 * snapshot reading per enabled thermostat, so history keeps a steady resolution even
 * when the WebSocket is down or nothing changed, then run the camera alert checks
 * (battery, not charging, offline). No-op while the integration is inactive.
 *
 * <p>To keep the Debug Dashboard quiet, {@code app_events} rows are written only when
 * HA becomes unreachable and when it recovers — not on every failed tick.
 */
@Component
@Profile("!test")
public class HomeAssistantSnapshotScheduler {

    private static final Logger log = LoggerFactory.getLogger(HomeAssistantSnapshotScheduler.class);

    private final HomeAssistantService service;
    private final AppEventService appEventService;
    private final CameraAlertService cameraAlerts;
    private boolean failing;

    public HomeAssistantSnapshotScheduler(HomeAssistantService service, AppEventService appEventService,
                                          CameraAlertService cameraAlerts) {
        this.service = service;
        this.appEventService = appEventService;
        this.cameraAlerts = cameraAlerts;
    }

    @Scheduled(initialDelayString = "PT2M", fixedDelayString = "PT15M")
    public void snapshot() {
        if (!service.isActive()) return;
        try {
            HomeAssistantService.SyncResult r = service.discoverAndSnapshot();
            log.debug("HA snapshot: {} thermostat reading(s), batch {}", r.readingsWritten(), r.batchId());
            cameraAlerts.evaluate();
            if (failing) {
                failing = false;
                appEventService.info("home-assistant", "HomeAssistantSnapshotScheduler", "Home Assistant snapshot recovered");
            }
        } catch (HomeAssistantException e) {
            if (!failing) {
                failing = true;
                appEventService.warn("home-assistant", "HomeAssistantSnapshotScheduler",
                        "Home Assistant snapshot failed: " + e.getMessage());
            } else {
                log.debug("HA snapshot still failing: {}", e.getMessage());
            }
        } catch (Exception e) {
            log.error("HomeAssistantSnapshotScheduler failed", e);
            appEventService.error("home-assistant", "HomeAssistantSnapshotScheduler", "Snapshot crashed", e.getMessage());
        }
    }
}
