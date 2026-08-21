package com.homeplatform.controller;

import com.homeplatform.dto.RoombaCommandRequest;
import com.homeplatform.dto.RoombaCommandResponse;
import com.homeplatform.dto.RoombaRenameRoomRequest;
import com.homeplatform.service.RoombaService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

/**
 * ADMIN-only Roomba control. Commands are enqueued here; the poller (which owns the
 * single robot connection) executes them. A returned/queued command being "OK" means
 * the broker accepted it — not that the robot necessarily acted on it.
 */
@RestController
@RequestMapping("/api/admin/roomba")
public class RoombaCommandController {

    private final RoombaService roombaService;

    public RoombaCommandController(RoombaService roombaService) {
        this.roombaService = roombaService;
    }

    private void requireAdmin(HttpServletRequest request) {
        if (!"ADMIN".equals(request.getAttribute("role"))) {
            throw new SecurityException("Admin access required");
        }
    }

    @PostMapping("/command")
    public ResponseEntity<?> enqueue(@RequestBody RoombaCommandRequest body, HttpServletRequest request) {
        requireAdmin(request);
        Object userId = request.getAttribute("userId");
        try {
            RoombaCommandResponse resp = roombaService.enqueueCommand(
                    body.command(), body.arg(), userId == null ? null : "user:" + userId);
            return ResponseEntity.ok(resp);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    @GetMapping("/commands")
    public ResponseEntity<List<RoombaCommandResponse>> recent(HttpServletRequest request) {
        requireAdmin(request);
        return ResponseEntity.ok(roombaService.recentCommands());
    }

    /** Rename a mapped room (and optionally set its category). Queued for the poller. */
    @PostMapping("/rooms/rename")
    public ResponseEntity<?> renameRoom(@RequestBody RoombaRenameRoomRequest body, HttpServletRequest request) {
        requireAdmin(request);
        Object userId = request.getAttribute("userId");
        try {
            RoombaCommandResponse resp = roombaService.enqueueRenameRoom(
                    body.roomId(), body.name(), body.roomType(),
                    userId == null ? null : "user:" + userId);
            return ResponseEntity.ok(resp);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }
}
