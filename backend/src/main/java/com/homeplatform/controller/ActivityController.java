package com.homeplatform.controller;

import com.homeplatform.dto.TabUsageResponse;
import com.homeplatform.model.TabActivity;
import com.homeplatform.service.TabActivityService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

/**
 * Tab usage. Members report each tab they open and each active minute on it; admins see
 * the totals. Guests aren't tracked.
 */
@RestController
public class ActivityController {

    private final TabActivityService activity;

    public ActivityController(TabActivityService activity) {
        this.activity = activity;
    }

    public record ActivityRequest(String tab, String kind) {}

    /** {@code {"tab": "cameras", "kind": "view" | "active"}}. From a guest it's a 204 and nothing is kept. */
    @PostMapping("/api/activity")
    public ResponseEntity<Void> record(@RequestBody(required = false) ActivityRequest body, HttpServletRequest request) {
        Object role = request.getAttribute("role");
        if (!"ADMIN".equals(role) && !"USER".equals(role)) return ResponseEntity.noContent().build();
        TabActivity.Kind kind;
        try {
            kind = TabActivity.Kind.valueOf(String.valueOf(body == null ? null : body.kind()).toUpperCase());
        } catch (IllegalArgumentException e) {
            throw new IllegalArgumentException("'kind' must be view or active");
        }
        activity.record((Long) request.getAttribute("userId"), body.tab(), kind);
        return ResponseEntity.noContent().build();
    }

    /** Per-member and household tab usage over the last {@code days} (default 30). Admins only. */
    @GetMapping("/api/admin/activity")
    public TabUsageResponse usage(@RequestParam(required = false) Integer days, HttpServletRequest request) {
        if (!"ADMIN".equals(request.getAttribute("role"))) throw new SecurityException("Admin access required");
        return activity.usage(days);
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
