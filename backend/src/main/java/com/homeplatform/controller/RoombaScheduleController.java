package com.homeplatform.controller;

import com.homeplatform.dto.RoombaScheduleRequest;
import com.homeplatform.dto.RoombaScheduleResponse;
import com.homeplatform.service.RoombaScheduleService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

/**
 * ADMIN-only CRUD for recurring cleaning schedules. Schedules are app-managed
 * records; the {@code RoombaScheduleScheduler} fires them by enqueuing the same
 * commands the manual clean UI uses. Same {@code requireAdmin(...)} gate as the
 * other admin roomba endpoints.
 */
@RestController
@RequestMapping("/api/roomba/schedules")
public class RoombaScheduleController {

    private final RoombaScheduleService service;

    public RoombaScheduleController(RoombaScheduleService service) {
        this.service = service;
    }

    private void requireAdmin(HttpServletRequest request) {
        if (!"ADMIN".equals(request.getAttribute("role"))) {
            throw new SecurityException("Admin access required");
        }
    }

    @GetMapping
    public ResponseEntity<List<RoombaScheduleResponse>> list(HttpServletRequest request) {
        requireAdmin(request);
        return ResponseEntity.ok(service.list());
    }

    @PostMapping
    public ResponseEntity<?> create(@RequestBody RoombaScheduleRequest body, HttpServletRequest request) {
        requireAdmin(request);
        try {
            return ResponseEntity.ok(service.create(body));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    @PutMapping("/{id}")
    public ResponseEntity<?> update(@PathVariable Long id, @RequestBody RoombaScheduleRequest body,
                                    HttpServletRequest request) {
        requireAdmin(request);
        try {
            return ResponseEntity.ok(service.update(id, body));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    @PostMapping("/{id}/enable")
    public ResponseEntity<?> enable(@PathVariable Long id, HttpServletRequest request) {
        requireAdmin(request);
        try {
            return ResponseEntity.ok(service.setEnabled(id, true));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    @PostMapping("/{id}/disable")
    public ResponseEntity<?> disable(@PathVariable Long id, HttpServletRequest request) {
        requireAdmin(request);
        try {
            return ResponseEntity.ok(service.setEnabled(id, false));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<?> delete(@PathVariable Long id, HttpServletRequest request) {
        requireAdmin(request);
        try {
            service.delete(id);
            return ResponseEntity.ok(Map.of("status", "deleted"));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }
}
