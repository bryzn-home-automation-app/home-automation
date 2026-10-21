package com.homeplatform.controller;

import com.homeplatform.dto.NotificationPreferenceResponse;
import com.homeplatform.model.AlertType;
import com.homeplatform.model.Notification;
import com.homeplatform.service.AlertEngine;
import com.homeplatform.service.NotificationPreferenceService;
import com.homeplatform.service.NotificationService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/notifications")
public class NotificationController {

    private final NotificationService service;
    private final AlertEngine alertEngine;
    private final NotificationPreferenceService preferences;

    public NotificationController(NotificationService service, AlertEngine alertEngine,
                                  NotificationPreferenceService preferences) {
        this.service = service;
        this.alertEngine = alertEngine;
        this.preferences = preferences;
    }

    // ── Alert types (members only — guests get no alerts) ──

    public record PreferenceRequest(Boolean inApp, Boolean push) {}

    @GetMapping("/preferences")
    public ResponseEntity<?> preferences(HttpServletRequest request) {
        if (!isMember(request)) return forbidden();
        return ResponseEntity.ok(preferences.list(userId(request)));
    }

    /** Turn one type on/off ({@code inApp}) and choose whether it reaches the phone ({@code push}). */
    @PutMapping("/preferences/{type}")
    public ResponseEntity<?> setPreference(@PathVariable String type, @RequestBody(required = false) PreferenceRequest body,
                                           HttpServletRequest request) {
        if (!isMember(request)) return forbidden();
        AlertType t;
        try {
            t = AlertType.valueOf(type.toUpperCase());
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", "Unknown alert type"));
        }
        if (body == null || body.inApp() == null || body.push() == null) {
            return ResponseEntity.badRequest().body(Map.of("error", "'inApp' and 'push' are required"));
        }
        NotificationPreferenceResponse saved = preferences.update(userId(request), t, body.inApp(), body.push());
        return ResponseEntity.ok(saved);
    }

    @PostMapping("/preferences/reset")
    public ResponseEntity<?> resetPreferences(HttpServletRequest request) {
        if (!isMember(request)) return forbidden();
        return ResponseEntity.ok(preferences.reset(userId(request)));
    }

    private static boolean isMember(HttpServletRequest request) {
        Object role = request.getAttribute("role");
        return "ADMIN".equals(role) || "USER".equals(role);
    }

    private static Long userId(HttpServletRequest request) {
        return (Long) request.getAttribute("userId");
    }

    private static ResponseEntity<Map<String, String>> forbidden() {
        return ResponseEntity.status(403).body(Map.of("error", "Access denied"));
    }

    @GetMapping
    public ResponseEntity<List<Notification>> list(
            HttpServletRequest request,
            @RequestParam(required = false) String category,
            @RequestParam(required = false) String severity,
            @RequestParam(defaultValue = "false") boolean unread,
            @RequestParam(defaultValue = "50") int limit) {
        Long userId = (Long) request.getAttribute("userId");
        return ResponseEntity.ok(service.getNotifications(userId, category, severity, unread, limit));
    }

    @GetMapping("/unread-count")
    public ResponseEntity<Map<String, Long>> unreadCount(HttpServletRequest request) {
        Long userId = (Long) request.getAttribute("userId");
        return ResponseEntity.ok(Map.of("count", service.getUnreadCount(userId)));
    }

    @PostMapping("/{id}/read")
    public ResponseEntity<Map<String, Object>> markRead(
            @PathVariable Long id,
            HttpServletRequest request) {
        Long userId = (Long) request.getAttribute("userId");
        int updated = service.markRead(id, userId);
        return ResponseEntity.ok(Map.of("updated", updated, "unread", service.getUnreadCount(userId)));
    }

    @PostMapping("/read-all")
    public ResponseEntity<Map<String, Object>> markAllRead(HttpServletRequest request) {
        Long userId = (Long) request.getAttribute("userId");
        int updated = service.markAllRead(userId);
        return ResponseEntity.ok(Map.of("updated", updated, "unread", 0L));
    }

    @PostMapping("/seed")
    public ResponseEntity<Map<String, Object>> seed(HttpServletRequest request) {
        Long userId = (Long) request.getAttribute("userId");
        alertEngine.generateElectricAlerts(userId);
        alertEngine.generateRoombaAlerts(userId);
        return ResponseEntity.ok(Map.of("status", "generated", "unread", service.getUnreadCount(userId)));
    }
}
