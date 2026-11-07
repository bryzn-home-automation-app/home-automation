package com.homeplatform.controller;

import com.homeplatform.dto.HostHealthResponse;
import com.homeplatform.dto.HostHistoryResponse;
import com.homeplatform.service.HostMetricsService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

/** Admin → NUC Health: the NUC's health now, and over the last day, week or month. Admins only. */
@RestController
public class HostHealthController {

    private final HostMetricsService metrics;

    public HostHealthController(HostMetricsService metrics) {
        this.metrics = metrics;
    }

    @GetMapping("/api/admin/host")
    public HostHealthResponse view(HttpServletRequest request) {
        requireAdmin(request);
        return metrics.view();
    }

    /** {@code range}: 24h (5-minute points), 7d (30-minute) or 30d (2-hour). */
    @GetMapping("/api/admin/host/history")
    public HostHistoryResponse history(@RequestParam(defaultValue = "24h") String range, HttpServletRequest request) {
        requireAdmin(request);
        return metrics.history(range);
    }

    private static void requireAdmin(HttpServletRequest request) {
        if (!"ADMIN".equals(request.getAttribute("role"))) throw new SecurityException("Admin access required");
    }

    @ExceptionHandler(SecurityException.class)
    public ResponseEntity<Map<String, String>> forbidden(SecurityException e) {
        return ResponseEntity.status(403).body(Map.of("error", e.getMessage()));
    }

    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<Map<String, String>> badRequest(IllegalArgumentException e) {
        return ResponseEntity.status(400).body(Map.of("error", e.getMessage()));
    }
}
