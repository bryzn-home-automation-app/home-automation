package com.homeplatform.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.homeplatform.dto.RoombaMapResponse;
import com.homeplatform.dto.RoombaRunResponse;
import com.homeplatform.dto.RoombaStatusResponse;
import com.homeplatform.model.RoombaMap;
import com.homeplatform.model.RoombaRun;
import com.homeplatform.model.RoombaStatus;
import com.homeplatform.repository.RoombaMapRepository;
import com.homeplatform.repository.RoombaRunRepository;
import com.homeplatform.repository.RoombaStatusRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;
import java.util.Set;

/** Read-only access to Roomba status/runs/map for the dashboard tab. */
@Service
public class RoombaService {

    private static final Logger log = LoggerFactory.getLogger(RoombaService.class);
    private static final ObjectMapper mapper = new ObjectMapper();

    /** Phases that count as actively cleaning (everything else — charge/stop/idle — is not). */
    private static final Set<String> RUNNING_PHASES = Set.of("run", "evac");

    /** A robot is "online" if its snapshot was written within this window. */
    private static final int ONLINE_WINDOW_MINUTES = 10;

    private final RoombaStatusRepository statusRepo;
    private final RoombaRunRepository runRepo;
    private final RoombaMapRepository mapRepo;

    public RoombaService(RoombaStatusRepository statusRepo,
                         RoombaRunRepository runRepo,
                         RoombaMapRepository mapRepo) {
        this.statusRepo = statusRepo;
        this.runRepo = runRepo;
        this.mapRepo = mapRepo;
    }

    public Optional<RoombaStatusResponse> getStatus() {
        return statusRepo.findTopByOrderByUpdatedAtDesc().map(this::toStatusResponse);
    }

    public List<RoombaRunResponse> getRuns(int limit) {
        int capped = Math.max(1, Math.min(limit, 500));
        return runRepo.findAllByOrderByStartedAtDesc(PageRequest.of(0, capped))
                .stream()
                .map(this::toRunResponse)
                .toList();
    }

    public Optional<RoombaMapResponse> getMap() {
        return mapRepo.findTopByOrderByUpdatedAtDesc().map(this::toMapResponse);
    }

    // --- mapping ---

    private RoombaStatusResponse toStatusResponse(RoombaStatus s) {
        boolean running = s.getPhase() != null
                && RUNNING_PHASES.contains(s.getPhase().toLowerCase());
        boolean online = s.getUpdatedAt() != null
                && s.getUpdatedAt().isAfter(LocalDateTime.now().minusMinutes(ONLINE_WINDOW_MINUTES));

        return new RoombaStatusResponse(
                s.getRobotId(),
                s.getName(),
                s.getBatteryPct(),
                s.getPhase(),
                s.getCycle(),
                s.getError(),
                running,
                s.getBinPresent(),
                s.getTankPresent(),
                s.getCurrentMissionId(),
                iso(s.getMissionStart()),
                s.getSqft(),
                s.getRuntimeMinutes(),
                s.getDockState(),
                s.getLifetimeMissions(),
                s.getLifetimeRunMinutes(),
                s.getMapVersion(),
                online,
                iso(s.getUpdatedAt())
        );
    }

    private RoombaRunResponse toRunResponse(RoombaRun r) {
        // roomba_runs has no mission_id column yet — missionId stays null.
        return new RoombaRunResponse(
                r.getId(),
                iso(r.getStartedAt()),
                iso(r.getCompletedAt()),
                r.getDurationMinutes(),
                r.getSquareFeet(),
                r.getStatus(),
                null
        );
    }

    private RoombaMapResponse toMapResponse(RoombaMap m) {
        return new RoombaMapResponse(
                m.getRobotId(),
                m.getMapId(),
                m.getMapVersion(),
                m.getName(),
                parseJson(m.getGeojson()),
                iso(m.getUpdatedAt())
        );
    }

    private JsonNode parseJson(String raw) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        try {
            return mapper.readTree(raw);
        } catch (Exception e) {
            log.warn("Failed to parse stored roomba_map geojson: {}", e.getMessage());
            return null;
        }
    }

    private String iso(LocalDateTime dt) {
        return dt == null ? null : dt.toString();
    }
}
