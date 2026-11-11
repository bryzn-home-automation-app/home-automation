package com.homeplatform.controller;

import com.homeplatform.dto.AdminUserResponse;
import com.homeplatform.dto.GuestSessionResponse;
import com.homeplatform.service.PasswordResetService;
import com.homeplatform.service.UserService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.List;
import java.util.Map;
import java.util.NoSuchElementException;

@RestController
@RequestMapping("/api/admin")
public class AdminController {

    private final UserService userService;
    private final PasswordResetService passwordReset;

    public AdminController(UserService userService, PasswordResetService passwordReset) {
        this.userService = userService;
        this.passwordReset = passwordReset;
    }

    private void requireAdmin(HttpServletRequest request) {
        String role = (String) request.getAttribute("role");
        if (role == null || !role.equals("ADMIN")) {
            throw new SecurityException("Admin access required");
        }
    }

    /** A non-admin caller is a 403, not a server error. */
    @ExceptionHandler(SecurityException.class)
    public ResponseEntity<Map<String, String>> forbidden(SecurityException e) {
        return ResponseEntity.status(403).body(Map.of("error", e.getMessage()));
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

    // ── Reset birthdays ("Forgot password?" for members) ──
    // The only place a stored birthday is ever returned: /api/auth/users, /me and /profile never
    // carry it, and the entity field is @JsonIgnore.

    @GetMapping("/users/birthdays")
    public ResponseEntity<List<PasswordResetService.Birthday>> birthdays(HttpServletRequest request) {
        requireAdmin(request);
        return ResponseEntity.ok(passwordReset.birthdays());
    }

    /** Body {"birthDate": "yyyy-MM-dd"} sets it (members only); {"birthDate": null} clears it. */
    @PutMapping("/users/{userId}/birthday")
    public ResponseEntity<?> setBirthday(
            @PathVariable Long userId,
            @RequestBody(required = false) Map<String, String> body,
            HttpServletRequest request) {
        requireAdmin(request);
        String raw = body == null ? null : body.get("birthDate");
        LocalDate date = null;
        if (raw != null && !raw.isBlank()) {
            try {
                date = LocalDate.parse(raw.trim());
            } catch (DateTimeParseException e) {
                return ResponseEntity.badRequest().body(Map.of("error", "Enter a date like 1990-03-04."));
            }
        }
        String admin = request.getAttribute("username") instanceof String u ? u : "An admin";
        try {
            return ResponseEntity.ok(passwordReset.setBirthday(userId, date, admin));
        } catch (NoSuchElementException e) {
            return ResponseEntity.status(404).body(Map.of("error", e.getMessage()));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
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
