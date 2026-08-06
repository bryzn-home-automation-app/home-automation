package com.homeplatform.service;

import com.homeplatform.dto.*;
import com.homeplatform.model.GuestSession;
import com.homeplatform.model.User;
import com.homeplatform.model.User.AccountStatus;
import com.homeplatform.model.User.Role;
import com.homeplatform.repository.GuestSessionRepository;
import com.homeplatform.repository.UserRepository;
import com.homeplatform.security.JwtUtil;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.security.MessageDigest;
import java.security.SecureRandom;
import java.time.LocalDateTime;
import java.util.*;
import java.util.stream.Collectors;

@Service
public class UserService {

    private static final Logger log = LoggerFactory.getLogger(UserService.class);
    private static final int GUEST_EXPIRY_DAYS = 30;

    private final UserRepository userRepo;
    private final GuestSessionRepository sessionRepo;
    private final JwtUtil jwtUtil;

    public UserService(UserRepository userRepo,
                       GuestSessionRepository sessionRepo,
                       JwtUtil jwtUtil) {
        this.userRepo = userRepo;
        this.sessionRepo = sessionRepo;
        this.jwtUtil = jwtUtil;
    }

    // ═══════════════════════════════════════════════════════════
    // Registration (self-service, enters PENDING_APPROVAL)
    // ═══════════════════════════════════════════════════════════

    @Transactional
    public AdminUserResponse register(RegisterRequest req) {
        if (userRepo.existsByUsername(req.username())) {
            throw new IllegalArgumentException("Username already taken");
        }
        if (userRepo.existsByEmail(req.email())) {
            throw new IllegalArgumentException("Email already registered");
        }

        User user = User.builder()
                .email(req.email())
                .username(req.username())
                .displayName(req.displayName() != null ? req.displayName() : req.username())
                .passwordHash(hashPassword(req.password()))
                .role(Role.USER)
                .status(AccountStatus.PENDING_APPROVAL)
                .loginCount(0)
                .build();
        user = userRepo.save(user);

        log.info("New registration: {} ({}), status=PENDING_APPROVAL", user.getUsername(), user.getEmail());
        return toResponse(user, false);
    }

    // ═══════════════════════════════════════════════════════════
    // Login (must be ACTIVE — pending users can't log in)
    // ═══════════════════════════════════════════════════════════

    public LoginResponse login(LoginRequest req, String ipAddress, String userAgent) {
        User user = userRepo.findByUsername(req.username())
                .orElseThrow(() -> new IllegalArgumentException("Invalid credentials"));

        if (user.getPasswordHash() == null || !verifyPassword(req.password(), user.getPasswordHash())) {
            throw new IllegalArgumentException("Invalid credentials");
        }

        if (user.getStatus() == AccountStatus.PENDING_APPROVAL) {
            throw new IllegalStateException("Account is pending approval. Please wait for an admin to approve your account.");
        }
        if (user.getStatus() == AccountStatus.DISABLED) {
            throw new IllegalStateException("Account has been disabled. Contact the admin.");
        }
        if (user.getStatus() == AccountStatus.EXPIRED) {
            throw new IllegalStateException("Guest account has expired.");
        }

        // Update login stats
        user.setLastLoginAt(LocalDateTime.now());
        user.setLoginCount(user.getLoginCount() + 1);
        userRepo.save(user);

        String token = jwtUtil.generateToken(user.getId(), user.getUsername(), user.getRole().name());

        // Only create guest sessions for GUEST users
        if (user.getRole() == Role.GUEST) {
            GuestSession session = GuestSession.builder()
                    .user(user)
                    .ipAddress(ipAddress)
                    .userAgent(userAgent)
                    .connectedAt(LocalDateTime.now())
                    .lastSeenAt(LocalDateTime.now())
                    .expiresAt(LocalDateTime.now().plusDays(GUEST_EXPIRY_DAYS))
                    .status(GuestSession.Status.ACTIVE)
                    .build();
            sessionRepo.save(session);
        }

        log.info("User '{}' (role={}) logged in", user.getUsername(), user.getRole());
        return new LoginResponse(token, user.getId(), user.getUsername(),
                user.getDisplayName() != null ? user.getDisplayName() : user.getUsername(),
                user.getRole().name());
    }

    // ═══════════════════════════════════════════════════════════
    // Guest login — find-or-reuse by display name, track connection count
    // ═══════════════════════════════════════════════════════════

    @Transactional
    public LoginResponse guestLogin(GuestLoginRequest req) {
        String baseUsername = "guest_" + req.displayName().toLowerCase()
                .replaceAll("[^a-z0-9]", "_")
                .replaceAll("_+", "_");

        // Find existing guest by display name, or create new
        Optional<User> existing = userRepo.findByDisplayName(req.displayName())
                .filter(u -> u.getRole() == Role.GUEST);

        User user;
        if (existing.isPresent()) {
            user = existing.get();
            user.setConnectionCount(user.getConnectionCount() + 1);
            user.setLastLoginAt(LocalDateTime.now());
            user.setLoginCount(user.getLoginCount() + 1);
            user.setStatus(AccountStatus.ACTIVE); // re-activate if expired
        } else {
            String username = baseUsername;
            if (userRepo.existsByUsername(username)) {
                username = username + "_" + (int) (Math.random() * 9000 + 1000);
            }
            user = User.builder()
                    .email(username + "@guest.local")
                    .username(username)
                    .displayName(req.displayName())
                    .role(Role.GUEST)
                    .status(AccountStatus.ACTIVE)
                    .lastLoginAt(LocalDateTime.now())
                    .loginCount(1)
                    .connectionCount(1)
                    .build();
        }
        user = userRepo.save(user);

        GuestSession session = GuestSession.builder()
                .user(user)
                .ipAddress(req.ipAddress())
                .userAgent(req.userAgent())
                .connectedAt(LocalDateTime.now())
                .lastSeenAt(LocalDateTime.now())
                .expiresAt(LocalDateTime.now().plusDays(GUEST_EXPIRY_DAYS))
                .status(GuestSession.Status.ACTIVE)
                .build();
        sessionRepo.save(session);

        String token = jwtUtil.generateToken(user.getId(), user.getUsername(), user.getRole().name());

        log.info("Guest '{}' connected from {}", user.getDisplayName(), req.ipAddress());
        return new LoginResponse(token, user.getId(), user.getUsername(),
                user.getDisplayName(), user.getRole().name());
    }

    // ═══════════════════════════════════════════════════════════
    // Current user
    // ═══════════════════════════════════════════════════════════

    public LoginResponse me(Long userId) {
        User user = userRepo.findById(userId)
                .orElseThrow(() -> new IllegalArgumentException("User not found"));
        return new LoginResponse(null, user.getId(), user.getUsername(),
                user.getDisplayName() != null ? user.getDisplayName() : user.getUsername(),
                user.getRole().name());
    }

    // ═══════════════════════════════════════════════════════════
    // Admin: User management
    // ═══════════════════════════════════════════════════════════

    public List<AdminUserResponse> getAllUsers() {
        Set<Long> onlineUserIds = sessionRepo.findByStatus(GuestSession.Status.ACTIVE)
                .stream().map(s -> s.getUser().getId()).collect(Collectors.toSet());

        return userRepo.findAll().stream()
                .map(u -> toResponse(u, onlineUserIds.contains(u.getId())))
                .sorted(Comparator.comparing(AdminUserResponse::createdAt).reversed())
                .collect(Collectors.toList());
    }

    public List<AdminUserResponse> getPendingUsers() {
        return userRepo.findByStatus(AccountStatus.PENDING_APPROVAL).stream()
                .map(u -> toResponse(u, false))
                .sorted(Comparator.comparing(AdminUserResponse::createdAt))
                .collect(Collectors.toList());
    }

    public long getPendingCount() {
        return userRepo.countByStatus(AccountStatus.PENDING_APPROVAL);
    }

    @Transactional
    public AdminUserResponse approveUser(Long userId, String role, Long approvedBy) {
        User user = userRepo.findById(userId)
                .orElseThrow(() -> new IllegalArgumentException("User not found"));

        if (user.getStatus() != AccountStatus.PENDING_APPROVAL) {
            throw new IllegalStateException("User is not in pending approval state");
        }

        user.setStatus(AccountStatus.ACTIVE);
        user.setRole(Role.valueOf(role.toUpperCase()));
        user.setApprovedBy(approvedBy);
        user.setApprovedAt(LocalDateTime.now());
        user = userRepo.save(user);

        log.info("User '{}' approved as {}", user.getUsername(), role);
        return toResponse(user, false);
    }

    @Transactional
    public void denyUser(Long userId, Long deniedBy) {
        User user = userRepo.findById(userId)
                .orElseThrow(() -> new IllegalArgumentException("User not found"));

        log.info("User '{}' registration denied by admin {}", user.getUsername(), deniedBy);
        userRepo.delete(user);
    }

    public AdminUserResponse updateUserRole(Long userId, String newRole) {
        User user = userRepo.findById(userId)
                .orElseThrow(() -> new IllegalArgumentException("User not found"));
        user.setRole(Role.valueOf(newRole.toUpperCase()));
        user = userRepo.save(user);
        log.info("User '{}' role updated to {}", user.getUsername(), newRole);
        return toResponse(user, false);
    }

    @Transactional
    public void disableUser(Long userId) {
        User user = userRepo.findById(userId)
                .orElseThrow(() -> new IllegalArgumentException("User not found"));
        user.setStatus(AccountStatus.DISABLED);
        userRepo.save(user);

        sessionRepo.findByUserIdAndStatus(userId, GuestSession.Status.ACTIVE)
                .forEach(s -> {
                    s.setStatus(GuestSession.Status.REVOKED);
                    sessionRepo.save(s);
                });

        log.info("User '{}' disabled", user.getUsername());
    }

    @Transactional
    public void reactivateUser(Long userId) {
        User user = userRepo.findById(userId)
                .orElseThrow(() -> new IllegalArgumentException("User not found"));
        user.setStatus(AccountStatus.ACTIVE);
        userRepo.save(user);
        log.info("User '{}' reactivated", user.getUsername());
    }

    // ═══════════════════════════════════════════════════════════
    // Admin: Guest sessions
    // ═══════════════════════════════════════════════════════════

    public List<GuestSessionResponse> getActiveGuestSessions() {
        return sessionRepo.findByStatus(GuestSession.Status.ACTIVE).stream()
                .map(this::toSessionResponse)
                .sorted(Comparator.comparing(GuestSessionResponse::connectedAt).reversed())
                .collect(Collectors.toList());
    }

    public long getActiveGuestCount() {
        return sessionRepo.countByStatus(GuestSession.Status.ACTIVE);
    }

    @Transactional
    public void expireGuestSessions() {
        List<GuestSession> expired = sessionRepo.findByStatus(GuestSession.Status.ACTIVE).stream()
                .filter(s -> s.getExpiresAt().isBefore(LocalDateTime.now()))
                .collect(Collectors.toList());

        expired.forEach(s -> {
            s.setStatus(GuestSession.Status.EXPIRED);
            sessionRepo.save(s);
            // Also expire the user
            User u = s.getUser();
            if (u.getRole() == Role.GUEST) {
                u.setStatus(AccountStatus.EXPIRED);
                userRepo.save(u);
            }
        });

        if (!expired.isEmpty()) {
            log.info("Expired {} guest sessions", expired.size());
        }
    }

    public void heartbeat(Long userId) {
        sessionRepo.findByUserIdAndStatus(userId, GuestSession.Status.ACTIVE)
                .forEach(s -> {
                    s.setLastSeenAt(LocalDateTime.now());
                    sessionRepo.save(s);
                });
    }

    // ═══════════════════════════════════════════════════════════
    // Seed admin
    // ═══════════════════════════════════════════════════════════

    @Transactional
    public void seedAdminIfNeeded(String email, String username, String password, String displayName) {
        if (!userRepo.existsByUsername(username)) {
            User admin = User.builder()
                    .email(email)
                    .username(username)
                    .displayName(displayName)
                    .passwordHash(hashPassword(password))
                    .role(Role.ADMIN)
                    .status(AccountStatus.ACTIVE)
                    .approvedAt(LocalDateTime.now())
                    .build();
            userRepo.save(admin);
            log.info("Seeded admin user: {}", username);
        }
    }

    // ═══════════════════════════════════════════════════════════
    // Helpers
    // ═══════════════════════════════════════════════════════════

    private AdminUserResponse toResponse(User u, boolean isOnline) {
        return new AdminUserResponse(
                u.getId(), u.getEmail(), u.getUsername(), u.getDisplayName(),
                u.getRole().name(), u.getStatus().name(),
                u.getLastLoginAt(), u.getLoginCount(),
                u.getCreatedAt(), u.getApprovedAt(), isOnline);
    }

    private GuestSessionResponse toSessionResponse(GuestSession s) {
        return new GuestSessionResponse(
                s.getId(), s.getUser().getId(), s.getUser().getDisplayName(),
                s.getIpAddress(), s.getUserAgent(),
                s.getConnectedAt(), s.getLastSeenAt(),
                s.getExpiresAt(), s.getStatus().name(),
                s.getUser().getConnectionCount());
    }

    private String hashPassword(String password) {
        try {
            SecureRandom random = new SecureRandom();
            byte[] salt = new byte[16];
            random.nextBytes(salt);
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            md.update(salt);
            byte[] hash = md.digest(password.getBytes("UTF-8"));
            byte[] combined = new byte[salt.length + hash.length];
            System.arraycopy(salt, 0, combined, 0, salt.length);
            System.arraycopy(hash, 0, combined, salt.length, hash.length);
            return Base64.getEncoder().encodeToString(combined);
        } catch (Exception e) {
            throw new RuntimeException("Failed to hash password", e);
        }
    }

    private boolean verifyPassword(String password, String storedHash) {
        try {
            byte[] combined = Base64.getDecoder().decode(storedHash);
            byte[] salt = new byte[16];
            byte[] hash = new byte[combined.length - 16];
            System.arraycopy(combined, 0, salt, 0, 16);
            System.arraycopy(combined, 16, hash, 0, hash.length);
            MessageDigest md = MessageDigest.getInstance("SHA-256");
            md.update(salt);
            byte[] testHash = md.digest(password.getBytes("UTF-8"));
            return MessageDigest.isEqual(hash, testHash);
        } catch (Exception e) {
            return false;
        }
    }
}
