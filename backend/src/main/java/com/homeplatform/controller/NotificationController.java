package com.homeplatform.controller;

import com.homeplatform.model.Notification;
import com.homeplatform.service.AlertEngine;
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

    public NotificationController(NotificationService service, AlertEngine alertEngine) {
        this.service = service;
        this.alertEngine = alertEngine;
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
        int updated = service.markRead(id);
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
