package com.homeplatform.controller;

import com.homeplatform.dto.*;
import com.homeplatform.service.LoginRateLimiter;
import com.homeplatform.service.PasswordResetService;
import com.homeplatform.service.UserService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDate;
import java.time.format.DateTimeParseException;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/auth")
public class AuthController {

    /** Family accounts sign in through home SSO only; password sign-in and self-registration are retired. */
    static final Map<String, String> PASSWORD_LOGIN_OFF =
            Map.of("error", "Password sign-in has been replaced by Sign in with Home.");
    static final Map<String, String> RESET_OFF = Map.of("error", "Password reset isn't turned on.");

    private final UserService userService;
    private final LoginRateLimiter rateLimiter;
    private final PasswordResetService passwordReset;
    private final boolean passwordLoginEnabled;

    public AuthController(UserService userService, LoginRateLimiter rateLimiter, PasswordResetService passwordReset,
                          @Value("${app.auth.password-login-enabled:true}") boolean passwordLoginEnabled) {
        this.userService = userService;
        this.rateLimiter = rateLimiter;
        this.passwordReset = passwordReset;
        this.passwordLoginEnabled = passwordLoginEnabled;
    }

    /** Self-registration — enters PENDING_APPROVAL, cannot log in until approved. */
    @PostMapping("/register")
    public ResponseEntity<?> register(@Valid @RequestBody RegisterRequest req) {
        if (!passwordLoginEnabled) return ResponseEntity.status(403).body(PASSWORD_LOGIN_OFF);
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
        if (!passwordLoginEnabled) return ResponseEntity.status(403).body(PASSWORD_LOGIN_OFF);
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

    /**
     * Forgot password: a member proves who they are with the birthday an admin stored for them and
     * chooses a new Home password, the one "Sign in with Home" asks for (PasswordResetService).
     * Public, and independent of the password sign-in switch. Every kind of no-match gets the same
     * 401 and body. 404 while it's off (no Home users file configured).
     */
    @PostMapping("/reset-password")
    public ResponseEntity<?> resetPassword(@RequestBody(required = false) PasswordResetRequest req,
                                           HttpServletRequest httpReq) {
        if (!passwordReset.isEnabled()) return ResponseEntity.status(404).body(RESET_OFF);
        if (req == null) return ResponseEntity.badRequest().body(Map.of("error", "Enter your username and birthday."));
        LocalDate birthDate = null;
        if (req.birthDate() != null) {
            try {
                birthDate = LocalDate.parse(req.birthDate().trim());
            } catch (DateTimeParseException e) {
                return ResponseEntity.badRequest().body(Map.of("error", "Enter your birthday."));
            }
        }
        var result = passwordReset.reset(req.username(), birthDate, req.newPassword(), getClientIp(httpReq));
        return switch (result.outcome()) {
            case RESET -> ResponseEntity.ok(Map.of("status", "reset"));
            case INVALID -> ResponseEntity.badRequest().body(Map.of("error", result.error()));
            case NO_MATCH -> ResponseEntity.status(401).body(Map.of("error", PasswordResetService.NO_MATCH));
            case THROTTLED -> ResponseEntity.status(429)
                    .header(HttpHeaders.RETRY_AFTER, String.valueOf(result.retryAfterSeconds()))
                    .body(Map.of("error", "Too many tries. Password reset is paused for now.",
                            "retryAfterSeconds", result.retryAfterSeconds()));
            case UNAVAILABLE -> ResponseEntity.status(503)
                    .body(Map.of("error", "Password reset isn't available right now. Try again later."));
            case OFF -> ResponseEntity.status(404).body(RESET_OFF);
        };
    }

    /** Guest sign-in — creates an ACTIVE guest account immediately (no approval).
     *  Requires a valid invite code (blank/disabled → 403). */
    @PostMapping("/guest-login")
    public ResponseEntity<?> guestLogin(
            @Valid @RequestBody GuestLoginRequest req,
            @RequestParam(required = false) String code,
            HttpServletRequest httpReq) {
        // Throttled like password login, so the invite code can't be brute-forced.
        String ip = getClientIp(httpReq);
        String limiterKey = "guest-login:" + ip;
        if (rateLimiter.isBlocked(limiterKey)) {
            return ResponseEntity.status(429)
                    .body(Map.of("error", "Too many attempts. Try again later."));
        }
        if (!userService.isGuestInviteCodeValid(code)) {
            rateLimiter.recordFailure(limiterKey);
            return ResponseEntity.status(403)
                    .body(Map.of("error", "Guest access requires a valid invite code"));
        }
        String ua = httpReq.getHeader("User-Agent");
        GuestLoginRequest enriched = new GuestLoginRequest(req.displayName(), req.accentColor(), req.avatarUrl(), ip, ua);
        try {
            return ResponseEntity.ok(userService.guestLogin(enriched));
        } catch (IllegalStateException e) {
            return ResponseEntity.status(403).body(Map.of("error", e.getMessage()));
        }
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

    /**
     * Session heartbeat, once a minute while the app is open — keeps guest session alive. Like any
     * signed-in request it also keeps the person online (JwtAuthFilter → OnlineTracker).
     */
    @PostMapping("/heartbeat")
    public ResponseEntity<Map<String, String>> heartbeat(HttpServletRequest request) {
        Long userId = (Long) request.getAttribute("userId");
        if (userId != null) {
            userService.heartbeat(userId);
        }
        return ResponseEntity.ok(Map.of("status", "ok"));
    }

    /**
     * Sign-out: the person reads offline at once instead of a few minutes later. Tokens are
     * stateless, so nothing is revoked; the app drops its copy.
     */
    @PostMapping("/logout")
    public ResponseEntity<Map<String, String>> logout(HttpServletRequest request) {
        Long userId = (Long) request.getAttribute("userId");
        if (userId != null) {
            userService.signOut(userId);
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
        // In the running app this header is never seen here. server.forward-headers-strategy:
        // framework installs Spring's ForwardedHeaderFilter, which turns the forwarded headers into
        // getRemoteAddr() (an RFC 7239 "Forwarded: for=" first, else X-Forwarded-For's FIRST entry)
        // and then hides them, so this falls through to getRemoteAddr(). That is only as good as
        // what nginx sends: it replaces X-Forwarded-For with its own $remote_addr and drops any
        // client "Forwarded" header (nginx/default.conf); without that, "Forwarded: for=<anything>"
        // would pick the address and escape every per-address limit. Behind Docker, $remote_addr
        // is the same gateway address for every client. The header branch below only runs where
        // that filter isn't installed (standalone controller tests); it takes the LAST entry, the
        // one a proxy appends.
        String xfwd = request.getHeader("X-Forwarded-For");
        if (xfwd != null && !xfwd.isBlank()) {
            String[] parts = xfwd.split(",");
            return parts[parts.length - 1].trim();
        }
        return request.getRemoteAddr();
    }
}
