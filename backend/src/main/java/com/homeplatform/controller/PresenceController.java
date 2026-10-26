package com.homeplatform.controller;

import com.homeplatform.dto.PresenceResponse;
import com.homeplatform.service.PresenceService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;
import java.util.NoSuchElementException;

/**
 * Who's home. Admins see every device and label them (each named, typed and owned by a
 * member); any member can link the device they're using to themselves.
 */
@RestController
public class PresenceController {

    private final PresenceService presence;

    public PresenceController(PresenceService presence) {
        this.presence = presence;
    }

    public record LabelRequest(String name, String type, Long ownerUserId) {}

    @GetMapping("/api/admin/presence")
    public PresenceResponse view(HttpServletRequest request) {
        requireAdmin(request);
        return presence.view();
    }

    /** {@code {"name": "Bryan's iPhone", "type": "MOBILE", "ownerUserId": 1}}; blank/null clears a field. */
    @PatchMapping("/api/admin/presence/devices/{id}")
    public ResponseEntity<Void> label(@PathVariable Long id, @RequestBody LabelRequest body, HttpServletRequest request) {
        requireAdmin(request);
        presence.label(id, body.name(), body.type(), body.ownerUserId());
        return ResponseEntity.noContent().build();
    }

    /** Start linking the device this member is using: open the returned URL on it, on the home Wi-Fi. */
    @PostMapping("/api/presence/link")
    public PresenceService.LinkStart startLink(HttpServletRequest request) {
        return presence.startLink(requireMember(request));
    }

    /** PENDING until the device opens the link, then LINKED (it's now theirs) or EXPIRED. */
    @GetMapping("/api/presence/link/{token}")
    public PresenceService.LinkStatus checkLink(@PathVariable String token, HttpServletRequest request) {
        return presence.checkLink(requireMember(request), token, request.getHeader("User-Agent"));
    }

    private static void requireAdmin(HttpServletRequest request) {
        if (!"ADMIN".equals(request.getAttribute("role"))) throw new SecurityException("Admin access required");
    }

    private static Long requireMember(HttpServletRequest request) {
        Object role = request.getAttribute("role");
        if (!"ADMIN".equals(role) && !"USER".equals(role)) throw new SecurityException("Members only");
        return (Long) request.getAttribute("userId");
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

    @ExceptionHandler(IllegalStateException.class)
    public ResponseEntity<Map<String, String>> unavailable(IllegalStateException e) {
        return ResponseEntity.status(503).body(Map.of("error", e.getMessage()));
    }
}
