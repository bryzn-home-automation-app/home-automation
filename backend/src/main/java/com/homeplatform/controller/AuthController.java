package com.homeplatform.controller;

import com.homeplatform.dto.*;
import com.homeplatform.service.UserService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/auth")
public class AuthController {

    private final UserService userService;

    public AuthController(UserService userService) {
        this.userService = userService;
    }

    /** Self-registration — enters PENDING_APPROVAL, cannot log in until approved. */
    @PostMapping("/register")
    public ResponseEntity<?> register(@Valid @RequestBody RegisterRequest req) {
        try {
            return ResponseEntity.ok(userService.register(req));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    /** Login — only ACTIVE accounts can authenticate. */
    @PostMapping("/login")
    public ResponseEntity<?> login(
            @Valid @RequestBody LoginRequest req,
            HttpServletRequest httpReq) {
        try {
            String ip = getClientIp(httpReq);
            String ua = httpReq.getHeader("User-Agent");
            return ResponseEntity.ok(userService.login(req, ip, ua));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.status(401).body(Map.of("error", e.getMessage()));
        } catch (IllegalStateException e) {
            return ResponseEntity.status(403).body(Map.of("error", e.getMessage()));
        }
    }

    /** Guest sign-in — creates an ACTIVE guest account immediately (no approval).
     *  Requires a valid invite code (blank/disabled → 403). */
    @PostMapping("/guest-login")
    public ResponseEntity<?> guestLogin(
            @Valid @RequestBody GuestLoginRequest req,
            @RequestParam(required = false) String code,
            HttpServletRequest httpReq) {
        if (!userService.isGuestInviteCodeValid(code)) {
            return ResponseEntity.status(403)
                    .body(Map.of("error", "Guest access requires a valid invite code"));
        }
        String ip = getClientIp(httpReq);
        String ua = httpReq.getHeader("User-Agent");
        GuestLoginRequest enriched = new GuestLoginRequest(req.displayName(), req.accentColor(), req.avatarUrl(), ip, ua);
        return ResponseEntity.ok(userService.guestLogin(enriched));
    }

    /** Current guest invite code — members/admins only, so guests can't invite others. */
    @GetMapping("/guest-invite-code")
    public ResponseEntity<?> guestInviteCode(HttpServletRequest request) {
        Long userId = (Long) request.getAttribute("userId");
        String role = (String) request.getAttribute("role");
        if (userId == null) {
            return ResponseEntity.status(401).build();
        }
        if ("GUEST".equals(role)) {
            return ResponseEntity.status(403).build();
        }
        return ResponseEntity.ok(Map.of("code", userService.getGuestInviteCode()));
    }

    /** Get current user info from JWT. */
    @GetMapping("/me")
    public ResponseEntity<?> me(HttpServletRequest request) {
        Long userId = (Long) request.getAttribute("userId");
        if (userId == null) {
            return ResponseEntity.status(401).build();
        }
        return ResponseEntity.ok(userService.me(userId));
    }

    /** Session heartbeat — keeps guest session alive. */
    @PostMapping("/heartbeat")
    public ResponseEntity<Map<String, String>> heartbeat(HttpServletRequest request) {
        Long userId = (Long) request.getAttribute("userId");
        if (userId != null) {
            userService.heartbeat(userId);
        }
        return ResponseEntity.ok(Map.of("status", "ok"));
    }

    /** Get all users — any authenticated user can see the household. */
    @GetMapping("/users")
    public ResponseEntity<List<com.homeplatform.dto.AdminUserResponse>> users(HttpServletRequest request) {
        Long userId = (Long) request.getAttribute("userId");
        if (userId == null) {
            return ResponseEntity.status(401).build();
        }
        return ResponseEntity.ok(userService.getAllUsers());
    }

    /** Get full user profile. */
    @GetMapping("/profile")
    public ResponseEntity<?> profile(HttpServletRequest request) {
        Long userId = (Long) request.getAttribute("userId");
        if (userId == null) {
            return ResponseEntity.status(401).build();
        }
        try {
            return ResponseEntity.ok(userService.getProfile(userId));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.notFound().build();
        }
    }

    /** Update user profile. */
    @PutMapping("/profile")
    public ResponseEntity<?> updateProfile(
            @Valid @RequestBody ProfileUpdateRequest req,
            HttpServletRequest request) {
        Long userId = (Long) request.getAttribute("userId");
        if (userId == null) {
            return ResponseEntity.status(401).build();
        }
        try {
            return ResponseEntity.ok(userService.updateProfile(userId, req));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    private String getClientIp(HttpServletRequest request) {
        // Trust only the LAST entry in X-Forwarded-For — the one appended by our
        // trusted reverse proxy (nginx). The leftmost entries are client-supplied
        // and spoofable; reading [0] there let an attacker forge a fresh IP per
        // request and bypass the login rate limiter. nginx replaces (not appends)
        // this header with $remote_addr, so in practice there is a single value.
        String xfwd = request.getHeader("X-Forwarded-For");
        if (xfwd != null && !xfwd.isBlank()) {
            String[] parts = xfwd.split(",");
            return parts[parts.length - 1].trim();
        }
        return request.getRemoteAddr();
    }
}
