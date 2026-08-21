package com.homeplatform.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.homeplatform.dto.RoombaCommandResponse;
import com.homeplatform.dto.RoombaDeviceResponse;
import com.homeplatform.dto.RoombaMapResponse;
import com.homeplatform.dto.RoombaPositionResponse;
import com.homeplatform.dto.RoombaRunResponse;
import com.homeplatform.dto.RoombaStatusResponse;
import com.homeplatform.model.RoombaCommand;
import com.homeplatform.model.RoombaDevice;
import com.homeplatform.model.RoombaMap;
import com.homeplatform.model.RoombaRun;
import com.homeplatform.model.RoombaStatus;
import com.homeplatform.repository.RoombaCommandRepository;
import com.homeplatform.repository.RoombaDeviceRepository;
import com.homeplatform.repository.RoombaMapRepository;
import com.homeplatform.repository.RoombaPositionRepository;
import com.homeplatform.repository.RoombaRunRepository;
import com.homeplatform.repository.RoombaStatusRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;

import java.time.LocalDateTime;
import java.util.ArrayList;
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

    /** A live position older than this is treated as stale (→ 204, hide the dot). */
    private static final int POSITION_STALE_SECONDS = 15;

    /** Control commands the poller knows how to execute. */
    private static final Set<String> ALLOWED_COMMANDS =
            Set.of("start", "stop", "pause", "resume", "dock", "find", "evac", "favorite");

    private final RoombaStatusRepository statusRepo;
    private final RoombaRunRepository runRepo;
    private final RoombaMapRepository mapRepo;
    private final RoombaCommandRepository commandRepo;
    private final RoombaDeviceRepository deviceRepo;
    private final RoombaPositionRepository positionRepo;

    public RoombaService(RoombaStatusRepository statusRepo,
                         RoombaRunRepository runRepo,
                         RoombaMapRepository mapRepo,
                         RoombaCommandRepository commandRepo,
                         RoombaDeviceRepository deviceRepo,
                         RoombaPositionRepository positionRepo) {
        this.statusRepo = statusRepo;
        this.runRepo = runRepo;
        this.mapRepo = mapRepo;
        this.commandRepo = commandRepo;
        this.deviceRepo = deviceRepo;
        this.positionRepo = positionRepo;
    }

    /**
     * Latest live position, but only while fresh — a row older than
     * {@link #POSITION_STALE_SECONDS} is treated as absent so the frontend hides
     * the dot rather than pinning it to a stale spot after a mission ends.
     */
    public Optional<RoombaPositionResponse> getPosition() {
        LocalDateTime cutoff = LocalDateTime.now().minusSeconds(POSITION_STALE_SECONDS);
        return positionRepo.findTopByOrderByUpdatedAtDesc()
                .filter(p -> p.getUpdatedAt() != null && p.getUpdatedAt().isAfter(cutoff))
                .map(p -> new RoombaPositionResponse(
                        p.getRobotId(), p.getX(), p.getY(), p.getTheta(), iso(p.getUpdatedAt())));
    }

    public Optional<RoombaDeviceResponse> getDevice() {
        return deviceRepo.findTopByOrderByUpdatedAtDesc().map(d -> new RoombaDeviceResponse(
                d.getRobotId(), d.getSku(), d.getSeries(), d.getFamily(),
                d.getSerialNumber(), d.getFirmware(), iso(d.getUpdatedAt())));
    }

    /** Validate + enqueue a control command for the poller to execute. */
    public RoombaCommandResponse enqueueCommand(String command, String arg, String requestedBy) {
        if (command == null || command.isBlank()) {
            throw new IllegalArgumentException("command is required");
        }
        String c = command.trim().toLowerCase();
        if (!ALLOWED_COMMANDS.contains(c)) {
            throw new IllegalArgumentException("Unsupported command: " + command);
        }
        boolean favorite = c.equals("favorite");
        if (favorite && (arg == null || arg.isBlank())) {
            throw new IllegalArgumentException("favorite requires an id");
        }
        String robotId = statusRepo.findTopByOrderByUpdatedAtDesc()
                .map(RoombaStatus::getRobotId).orElse(null);
        RoombaCommand cmd = RoombaCommand.builder()
                .robotId(robotId)
                .command(c)
                .arg(favorite ? arg.trim() : null)
                .status("PENDING")
                .requestedBy(requestedBy)
                .createdAt(LocalDateTime.now())
                .build();
        return toCommandResponse(commandRepo.save(cmd));
    }

    public List<RoombaCommandResponse> recentCommands() {
        return commandRepo.findTop20ByOrderByIdDesc().stream()
                .map(this::toCommandResponse).toList();
    }

    private RoombaCommandResponse toCommandResponse(RoombaCommand c) {
        return new RoombaCommandResponse(
                c.getId(), c.getCommand(), c.getArg(), c.getStatus(),
                c.getDetail(), c.getRequestedBy(), iso(c.getCreatedAt()), iso(c.getProcessedAt()));
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

        List<String> reasons = new ArrayList<>();
        if (s.getError() != null && s.getError() != 0) {
            reasons.add(s.getErrorText() != null ? s.getErrorText() : "Error " + s.getError());
        }
        if (s.getDockError() != null && s.getDockError() != 0) {
            reasons.add("Dock error " + s.getDockError());
        }
        if (s.getNotReady() != null && s.getNotReady() != 0) {
            reasons.add("Not ready (code " + s.getNotReady() + ")");
        }
        if (Boolean.FALSE.equals(s.getBinPresent())) {
            reasons.add("Bin removed");
        }
        if (Boolean.FALSE.equals(s.getTankPresent())) {
            reasons.add("Water tank removed");
        }
        if (s.getChargeErrors() != null && s.getChargeErrors() > 0) {
            reasons.add("Charging faults (" + s.getChargeErrors() + ")");
        }
        if (s.getFaultText() != null && !s.getFaultText().isBlank()) {
            reasons.add(s.getFaultText());
        }
        boolean needsAttention = !reasons.isEmpty();

        return new RoombaStatusResponse(
                s.getRobotId(),
                s.getName(),
                s.getBatteryPct(),
                s.getPhase(),
                s.getCycle(),
                s.getError(),
                s.getErrorText(),
                running,
                s.getBinPresent(),
                s.getTankPresent(),
                s.getCurrentMissionId(),
                iso(s.getMissionStart()),
                s.getSqft(),
                s.getRuntimeMinutes(),
                s.getDockState(),
                s.getDockError(),
                s.getDockText(),
                s.getNotReady(),
                s.getInitiator(),
                s.getDetectedPad(),
                s.getChargeCycles(),
                s.getChargeErrors(),
                s.getFaultText(),
                parseJson(s.getWear()),
                s.getLifetimeMissions(),
                s.getLifetimeRunMinutes(),
                s.getMapVersion(),
                online,
                needsAttention,
                reasons,
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
