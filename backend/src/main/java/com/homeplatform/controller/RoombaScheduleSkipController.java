package com.homeplatform.controller;

import com.homeplatform.dto.RoombaScheduleSkipRequest;
import com.homeplatform.dto.RoombaScheduleSkipResponse;
import com.homeplatform.service.RoombaScheduleSkipService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;
import java.util.NoSuchElementException;

/**
 * Skipping a scheduled clean. Anyone signed in sees the skips (the Roomba page says which
 * clean is skipped); skipping and undoing follow the robot's other commands: ADMIN only.
 */
@RestController
@RequestMapping("/api")
public class RoombaScheduleSkipController {

    private final RoombaScheduleSkipService service;

    public RoombaScheduleSkipController(RoombaScheduleSkipService service) {
        this.service = service;
    }

    private void requireAdmin(HttpServletRequest request) {
        if (!"ADMIN".equals(request.getAttribute("role"))) {
            throw new SecurityException("Admin access required");
        }
    }

    @ExceptionHandler(SecurityException.class)
    public ResponseEntity<Map<String, String>> forbidden(SecurityException e) {
        return ResponseEntity.status(HttpStatus.FORBIDDEN).body(Map.of("error", e.getMessage()));
    }

    private static String who(HttpServletRequest request) {
        Object userId = request.getAttribute("userId");
        return userId == null ? null : "user:" + userId;
    }

    /**
     * Skips under way, and those settled in the last two days. Who asked for a skip and the raw
     * cloud errors (they hold URLs with the household id) are for admins: everyone else gets the
     * skip without them.
     */
    @GetMapping("/roomba/schedule-skips")
    public ResponseEntity<List<RoombaScheduleSkipResponse>> list(HttpServletRequest request) {
        List<RoombaScheduleSkipResponse> skips = service.recent();
        if ("ADMIN".equals(request.getAttribute("role"))) return ResponseEntity.ok(skips);
        return ResponseEntity.ok(skips.stream().map(RoombaScheduleSkipController::forMember).toList());
    }

    /**
     * A skip without requestedBy and lastError. A FAILED skip's detail ends with the error in
     * brackets (roomba-poller/schedule_skips.py settle_offline); that part goes too.
     */
    static RoombaScheduleSkipResponse forMember(RoombaScheduleSkipResponse s) {
        String detail = s.detail();
        if (detail != null && s.lastError() != null) {
            int bracket = detail.indexOf(" (");
            if (bracket > 0) detail = detail.substring(0, bracket);
        }
        return new RoombaScheduleSkipResponse(
                s.id(), s.householdScheduleId(), s.scheduleId(), s.date(), s.hour(), s.minute(),
                s.scheduledFor(), s.restoreAfter(), s.state(), detail, null, s.undoRequested(), null,
                s.createdAt(), s.appliedAt(), s.finishedAt());
    }

    /** Skip today's or tomorrow's clean of one schedule. */
    @PostMapping("/admin/roomba/schedule-skips")
    public ResponseEntity<?> skip(@RequestBody RoombaScheduleSkipRequest body, HttpServletRequest request) {
        requireAdmin(request);
        try {
            return ResponseEntity.ok(service.skip(body.householdScheduleId(), body.date(), who(request)));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    /** Undo a skip still under way (the schedule goes back on, or is never switched off). */
    @PostMapping("/admin/roomba/schedule-skips/{id}/undo")
    public ResponseEntity<?> undo(@PathVariable Long id, HttpServletRequest request) {
        requireAdmin(request);
        try {
            return ResponseEntity.ok(service.undo(id, who(request)));
        } catch (NoSuchElementException e) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND).body(Map.of("error", e.getMessage()));
        } catch (IllegalStateException e) {
            return ResponseEntity.status(HttpStatus.CONFLICT).body(Map.of("error", e.getMessage()));
        }
    }
}
