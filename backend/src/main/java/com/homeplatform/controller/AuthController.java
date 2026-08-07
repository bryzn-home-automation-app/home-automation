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

    /** Guest sign-in — creates an ACTIVE guest account immediately (no approval). */
    @PostMapping("/guest-login")
    public ResponseEntity<LoginResponse> guestLogin(
            @Valid @RequestBody GuestLoginRequest req,
            HttpServletRequest httpReq) {
        String ip = getClientIp(httpReq);
        String ua = httpReq.getHeader("User-Agent");
        GuestLoginRequest enriched = new GuestLoginRequest(req.displayName(), req.accentColor(), req.avatarUrl(), ip, ua);
        return ResponseEntity.ok(userService.guestLogin(enriched));
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
        String xfwd = request.getHeader("X-Forwarded-For");
        if (xfwd != null && !xfwd.isBlank()) {
            return xfwd.split(",")[0].trim();
        }
        return request.getRemoteAddr();
    }
}
