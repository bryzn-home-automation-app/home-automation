package com.homeplatform.controller;

import com.homeplatform.dto.RoombaMapResponse;
import com.homeplatform.dto.RoombaRunResponse;
import com.homeplatform.dto.RoombaStatusResponse;
import com.homeplatform.service.RoombaService;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/**
 * Read-only Roomba dashboard API. All routes sit under {@code /api/*}, so they
 * are authenticated by {@code JwtAuthFilter} (none are in its public allowlist).
 */
@RestController
@RequestMapping("/api/roomba")
public class RoombaController {

    private final RoombaService service;

    public RoombaController(RoombaService service) {
        this.service = service;
    }

    /** Latest live status, or 204 if the poller hasn't written a snapshot yet. */
    @GetMapping("/status")
    public ResponseEntity<RoombaStatusResponse> getStatus() {
        return service.getStatus()
                .map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.noContent().build());
    }

    /** Run history, newest first. */
    @GetMapping("/runs")
    public ResponseEntity<List<RoombaRunResponse>> getRuns(
            @RequestParam(defaultValue = "50") int limit) {
        return ResponseEntity.ok(service.getRuns(limit));
    }

    /** Current floor-plan map, or 204 if none exists yet. */
    @GetMapping("/map")
    public ResponseEntity<RoombaMapResponse> getMap() {
        return service.getMap()
                .map(ResponseEntity::ok)
                .orElseGet(() -> ResponseEntity.noContent().build());
    }
}
