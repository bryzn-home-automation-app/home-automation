package com.homeplatform.controller;

import com.homeplatform.dto.PresenceResponse;
import com.homeplatform.service.PresenceService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;
import java.util.NoSuchElementException;

/** Who's home (Admin): devices on the home Wi-Fi, each named, typed and owned by a member. Admins only. */
@RestController
@RequestMapping("/api/admin/presence")
public class PresenceController {

    private final PresenceService presence;

    public PresenceController(PresenceService presence) {
        this.presence = presence;
    }

    public record LabelRequest(String name, String type, Long ownerUserId) {}

    @GetMapping
    public PresenceResponse view(HttpServletRequest request) {
        requireAdmin(request);
        return presence.view();
    }

    /** {@code {"name": "Bryan's iPhone", "type": "MOBILE", "ownerUserId": 1}}; blank/null clears a field. */
    @PatchMapping("/devices/{id}")
    public ResponseEntity<Void> label(@PathVariable Long id, @RequestBody LabelRequest body, HttpServletRequest request) {
        requireAdmin(request);
        presence.label(id, body.name(), body.type(), body.ownerUserId());
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
