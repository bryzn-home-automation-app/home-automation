package com.homeplatform.controller;

import com.homeplatform.dto.AdminUserResponse;
import com.homeplatform.dto.GuestSessionResponse;
import com.homeplatform.service.UserService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/admin")
public class AdminController {

    private final UserService userService;

    public AdminController(UserService userService) {
        this.userService = userService;
    }

    private void requireAdmin(HttpServletRequest request) {
        String role = (String) request.getAttribute("role");
        if (role == null || !role.equals("ADMIN")) {
            throw new SecurityException("Admin access required");
        }
    }

    // ── All users ──

    @GetMapping("/users")
    public ResponseEntity<List<AdminUserResponse>> getAllUsers(HttpServletRequest request) {
        requireAdmin(request);
        return ResponseEntity.ok(userService.getAllUsers());
    }

    // ── Pending approval ──

    @GetMapping("/users/pending")
    public ResponseEntity<List<AdminUserResponse>> getPendingUsers(HttpServletRequest request) {
        requireAdmin(request);
        return ResponseEntity.ok(userService.getPendingUsers());
    }

    @GetMapping("/users/pending/count")
    public ResponseEntity<Map<String, Long>> getPendingCount(HttpServletRequest request) {
        requireAdmin(request);
        return ResponseEntity.ok(Map.of("count", userService.getPendingCount()));
    }

    @PostMapping("/users/{userId}/approve")
    public ResponseEntity<AdminUserResponse> approveUser(
            @PathVariable Long userId,
            @RequestBody Map<String, String> body,
            HttpServletRequest request) {
        requireAdmin(request);
        Long approvedBy = (Long) request.getAttribute("userId");
        String role = body.getOrDefault("role", "USER");
        return ResponseEntity.ok(userService.approveUser(userId, role, approvedBy));
    }

    @PostMapping("/users/{userId}/deny")
    public ResponseEntity<Map<String, String>> denyUser(
            @PathVariable Long userId,
            HttpServletRequest request) {
        requireAdmin(request);
        Long deniedBy = (Long) request.getAttribute("userId");
        userService.denyUser(userId, deniedBy);
        return ResponseEntity.ok(Map.of("status", "denied"));
    }

    // ── Role management ──

    @PutMapping("/users/{userId}/role")
    public ResponseEntity<AdminUserResponse> updateUserRole(
            @PathVariable Long userId,
            @RequestBody Map<String, String> body,
            HttpServletRequest request) {
        requireAdmin(request);
        String role = body.get("role");
        if (role == null || role.isBlank()) {
            return ResponseEntity.badRequest().build();
        }
        return ResponseEntity.ok(userService.updateUserRole(userId, role));
    }

    // ── Enable / Disable ──

    @PostMapping("/users/{userId}/disable")
    public ResponseEntity<Map<String, String>> disableUser(
            @PathVariable Long userId,
            HttpServletRequest request) {
        requireAdmin(request);
        userService.disableUser(userId);
        return ResponseEntity.ok(Map.of("status", "disabled"));
    }

    @PostMapping("/users/{userId}/reactivate")
    public ResponseEntity<Map<String, String>> reactivateUser(
            @PathVariable Long userId,
            HttpServletRequest request) {
        requireAdmin(request);
        userService.reactivateUser(userId);
        return ResponseEntity.ok(Map.of("status", "reactivated"));
    }

    // ── Guest sessions ──

    @GetMapping("/guest-sessions")
    public ResponseEntity<List<GuestSessionResponse>> getActiveGuestSessions(HttpServletRequest request) {
        requireAdmin(request);
        return ResponseEntity.ok(userService.getActiveGuestSessions());
    }

    @GetMapping("/guest-sessions/count")
    public ResponseEntity<Map<String, Long>> getGuestCount(HttpServletRequest request) {
        requireAdmin(request);
        return ResponseEntity.ok(Map.of("count", userService.getActiveGuestCount()));
    }

    @PostMapping("/guest-sessions/expire")
    public ResponseEntity<Map<String, String>> expireGuestSessions(HttpServletRequest request) {
        requireAdmin(request);
        userService.expireGuestSessions();
        return ResponseEntity.ok(Map.of("status", "ok"));
    }

    // ── Stats ──

    @GetMapping("/stats")
    public ResponseEntity<Map<String, Object>> getStats(HttpServletRequest request) {
        requireAdmin(request);
        return ResponseEntity.ok(Map.of(
                "activeGuests", userService.getActiveGuestCount(),
                "pendingApprovals", userService.getPendingCount(),
                "timestamp", System.currentTimeMillis()
        ));
    }
}
