package com.homeplatform.controller;

import com.homeplatform.dto.PresenceResponse;
import com.homeplatform.service.PresenceService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;
import java.util.NoSuchElementException;

/** Who's home (Admin): devices on the home Wi-Fi, labeled by person. Admins only. */
@RestController
@RequestMapping("/api/admin/presence")
public class PresenceController {

    private final PresenceService presence;

    public PresenceController(PresenceService presence) {
        this.presence = presence;
    }

    public record LabelRequest(String label, String person) {}

    @GetMapping
    public PresenceResponse view(HttpServletRequest request) {
        requireAdmin(request);
        return presence.view();
    }

    /** {@code {"label": "Bryan's iPhone", "person": "Bryan"}}; blank clears a field. */
    @PatchMapping("/devices/{id}")
    public ResponseEntity<Void> label(@PathVariable Long id, @RequestBody LabelRequest body, HttpServletRequest request) {
        requireAdmin(request);
        presence.label(id, body.label(), body.person());
        return ResponseEntity.noContent().build();
    }

    private static void requireAdmin(HttpServletRequest request) {
        if (!"ADMIN".equals(request.getAttribute("role"))) throw new SecurityException("Admin access required");
    }

    @ExceptionHandler(SecurityException.class)
    public ResponseEntity<Map<String, String>> forbidden(SecurityException e) {
        return ResponseEntity.status(403).body(Map.of("error", e.getMessage()));
    }

    @ExceptionHandler(NoSuchElementException.class)
    public ResponseEntity<Map<String, String>> notFound(NoSuchElementException e) {
        return ResponseEntity.status(404).body(Map.of("error", e.getMessage()));
    }

    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<Map<String, String>> badRequest(IllegalArgumentException e) {
        return ResponseEntity.status(400).body(Map.of("error", e.getMessage()));
    }
}
