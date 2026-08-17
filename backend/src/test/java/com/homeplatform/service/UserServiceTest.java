package com.homeplatform.service;

import com.homeplatform.dto.*;
import com.homeplatform.model.GuestSession;
import com.homeplatform.model.User;
import com.homeplatform.model.User.AccountStatus;
import com.homeplatform.model.User.Role;
import com.homeplatform.repository.GuestSessionRepository;
import com.homeplatform.repository.UserRepository;
import com.homeplatform.security.JwtUtil;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest
@Transactional
class UserServiceTest {

    @MockBean private AlertEngine alertEngine;
    @MockBean private MaintenanceService maintenanceService;

    @Autowired private UserService userService;
    @Autowired private UserRepository userRepo;
    @Autowired private GuestSessionRepository sessionRepo;
    @Autowired private JwtUtil jwtUtil;

    @BeforeEach
    void seedAdmin() {
        userService.seedAdminIfNeeded("admin@test.local", "admin", "admin123", "Admin");
    }

    @Nested
    @DisplayName("Registration")
    class Registration {

        @Test
        @DisplayName("should create user with PENDING_APPROVAL status")
        void registerCreatesPendingUser() {
            var req = new RegisterRequest("user@test.com", "testuser", "password123", "Test User");
            var resp = userService.register(req);

            assertNotNull(resp.id());
            assertEquals("testuser", resp.username());
            assertEquals("Test User", resp.displayName());
            assertEquals("USER", resp.role());
            assertEquals("PENDING_APPROVAL", resp.status());

            // Verify in DB
            User user = userRepo.findById(resp.id()).orElseThrow();
            assertEquals(AccountStatus.PENDING_APPROVAL, user.getStatus());
            assertEquals(Role.USER, user.getRole());
        }

        @Test
        @DisplayName("should reject duplicate username")
        void rejectDuplicateUsername() {
            userService.register(new RegisterRequest("a@b.com", "unique123", "password1", "A"));
            assertThrows(IllegalArgumentException.class, () ->
                userService.register(new RegisterRequest("other@b.com", "unique123", "password2", "B")));
        }

        @Test
        @DisplayName("should reject duplicate email")
        void rejectDuplicateEmail() {
            userService.register(new RegisterRequest("dup@test.com", "user1", "password1", "U1"));
            assertThrows(IllegalArgumentException.class, () ->
                userService.register(new RegisterRequest("dup@test.com", "user2", "password2", "U2")));
        }
    }

    @Nested
    @DisplayName("Login")
    class Login {

        @Test
        @DisplayName("should return token for valid credentials")
        void validLoginReturnsToken() {
            var resp = userService.login(
                new LoginRequest("admin", "admin123"), "127.0.0.1", "test-agent");
            assertNotNull(resp.token());
            assertEquals("admin", resp.username());
            assertEquals("ADMIN", resp.role());
            assertTrue(jwtUtil.isTokenValid(resp.token()));
        }

        @Test
        @DisplayName("should reject incorrect password")
        void rejectWrongPassword() {
            assertThrows(IllegalArgumentException.class, () ->
                userService.login(new LoginRequest("admin", "wrongpass"), "127.0.0.1", "test"));
        }

        @Test
        @DisplayName("should reject non-existent user")
        void rejectNonExistentUser() {
            assertThrows(IllegalArgumentException.class, () ->
                userService.login(new LoginRequest("noone", "password"), "127.0.0.1", "test"));
        }

        @Test
        @DisplayName("should reject PENDING_APPROVAL user")
        void rejectPendingUser() {
            userService.register(new RegisterRequest("pend@test.com", "pending", "password", "Pending"));
            assertThrows(IllegalStateException.class, () ->
                userService.login(new LoginRequest("pending", "password"), "127.0.0.1", "test"));
        }

        @Test
        @DisplayName("should reject DISABLED user")
        void rejectDisabledUser() {
            var r = userService.register(new RegisterRequest("dis@test.com", "disabled1", "password", "Dis"));
            userService.approveUser(r.id(), "USER", 1L);
            userService.disableUser(r.id());
            assertThrows(IllegalStateException.class, () ->
                userService.login(new LoginRequest("disabled1", "password"), "127.0.0.1", "test"));
        }

        @Test
        @DisplayName("should increment loginCount on successful login")
        void incrementsLoginCount() {
            userService.login(new LoginRequest("admin", "admin123"), "127.0.0.1", "test");
            User user = userRepo.findByUsername("admin").orElseThrow();
            assertTrue(user.getLoginCount() >= 1);
        }

        @Test
        @DisplayName("should update lastLoginAt on successful login")
        void updatesLastLogin() {
            var before = java.time.LocalDateTime.now();
            userService.login(new LoginRequest("admin", "admin123"), "127.0.0.1", "test");
            User user = userRepo.findByUsername("admin").orElseThrow();
            assertNotNull(user.getLastLoginAt());
            assertFalse(user.getLastLoginAt().isBefore(before.minusSeconds(1)));
        }
    }

    @Nested
    @DisplayName("Guest Login")
    class GuestLogin {

        @Test
        @DisplayName("should create new guest with ACTIVE status on first visit")
        void firstGuestVisitCreatesUser() {
            var resp = userService.guestLogin(
                new GuestLoginRequest("Sarah", null, null, "192.168.1.1", "iPhone"));
            assertNotNull(resp.token());
            assertEquals("GUEST", resp.role());

            User guest = userRepo.findById(resp.userId()).orElseThrow();
            assertEquals(AccountStatus.ACTIVE, guest.getStatus());
            assertEquals(Role.GUEST, guest.getRole());
            assertEquals("Sarah", guest.getDisplayName());
            assertEquals(1, guest.getConnectionCount());
        }

        @Test
        @DisplayName("should reuse existing guest and increment connectionCount")
        void reuseExistingGuest() {
            var first = userService.guestLogin(
                new GuestLoginRequest("Sarah", null, null, "192.168.1.1", "iPhone"));
            var second = userService.guestLogin(
                new GuestLoginRequest("Sarah", null, null, "192.168.1.2", "Android"));

            assertEquals(first.userId(), second.userId(), "Same guest should reuse account");

            User guest = userRepo.findById(first.userId()).orElseThrow();
            assertEquals(2, guest.getConnectionCount(), "Connection count should increment");
        }

        @Test
        @DisplayName("should create guest session on each login")
        void createsGuestSession() {
            userService.guestLogin(new GuestLoginRequest("Mike", null, null, "10.0.0.1", "Chrome"));
            List<GuestSession> sessions = sessionRepo.findByStatus(GuestSession.Status.ACTIVE);
            assertEquals(1, sessions.size());
            assertEquals("Mike", sessions.get(0).getUser().getDisplayName());
            assertEquals("10.0.0.1", sessions.get(0).getIpAddress());
        }

        @Test
        @DisplayName("should set 30-day expiry on guest sessions")
        void guestSessionExpiresIn30Days() {
            userService.guestLogin(new GuestLoginRequest("Tom", null, null, "1.1.1.1", "Firefox"));
            List<GuestSession> sessions = sessionRepo.findByStatus(GuestSession.Status.ACTIVE);
            var expiresAt = sessions.get(0).getExpiresAt();
            var expectedMin = java.time.LocalDateTime.now().plusDays(29).plusHours(23);
            assertTrue(expiresAt.isAfter(expectedMin), "Should expire in ~30 days");
        }

        @Test
        @DisplayName("should reactivate expired guest when they return")
        void reactivateExpiredGuest() {
            var resp = userService.guestLogin(
                new GuestLoginRequest("LateVisitor", null, null, "1.1.1.1", "Safari"));
            Long userId = resp.userId();

            // Manually expire them
            User guest = userRepo.findById(userId).orElseThrow();
            guest.setStatus(AccountStatus.EXPIRED);
            userRepo.save(guest);

            // They come back
            var resp2 = userService.guestLogin(
                new GuestLoginRequest("LateVisitor", null, null, "2.2.2.2", "Safari"));
            assertEquals(userId, resp2.userId());
            User reloaded = userRepo.findById(userId).orElseThrow();
            assertEquals(AccountStatus.ACTIVE, reloaded.getStatus());
            assertEquals(2, reloaded.getConnectionCount());
        }
    }

    @Nested
    @DisplayName("Approval workflow")
    class Approval {

        @Test
        @DisplayName("should approve pending user as specified role")
        void approveUser() {
            var reg = userService.register(
                new RegisterRequest("new@test.com", "newuser", "password", "New"));
            var approved = userService.approveUser(reg.id(), "ADMIN", 1L);

            assertEquals("ACTIVE", approved.status());
            assertEquals("ADMIN", approved.role());

            User user = userRepo.findById(reg.id()).orElseThrow();
            assertEquals(AccountStatus.ACTIVE, user.getStatus());
            assertEquals(Role.ADMIN, user.getRole());
            assertEquals(Long.valueOf(1L), user.getApprovedBy());
            assertNotNull(user.getApprovedAt());
        }

        @Test
        @DisplayName("should deny and delete pending user")
        void denyUser() {
            var reg = userService.register(
                new RegisterRequest("denied@test.com", "denied", "password", "D"));
            userService.denyUser(reg.id(), 1L);

            assertTrue(userRepo.findById(reg.id()).isEmpty(), "User should be deleted");
        }

        @Test
        @DisplayName("should list pending users")
        void listPendingUsers() {
            userService.register(new RegisterRequest("p1@t.com", "pend1", "password1", "P1"));
            userService.register(new RegisterRequest("p2@t.com", "pend2", "password2", "P2"));

            var pending = userService.getPendingUsers();
            assertEquals(2, pending.size());
        }
    }

    @Nested
    @DisplayName("Disable / Reactivate")
    class DisableReactivate {

        @Test
        @DisplayName("should disable user and revoke sessions")
        void disableUserRevokesSessions() {
            var reg = userService.register(
                new RegisterRequest("d@t.com", "disableme", "password", "DM"));
            userService.approveUser(reg.id(), "USER", 1L);

            // Login to create a session
            userService.login(
                new LoginRequest("disableme", "password"), "127.0.0.1", "test");

            userService.disableUser(reg.id());

            User user = userRepo.findById(reg.id()).orElseThrow();
            assertEquals(AccountStatus.DISABLED, user.getStatus());

            // Active sessions should be revoked
            var active = sessionRepo.findByUserIdAndStatus(reg.id(), GuestSession.Status.ACTIVE);
            assertTrue(active.isEmpty());
        }

        @Test
        @DisplayName("should reactivate disabled user")
        void reactivateUser() {
            var reg = userService.register(
                new RegisterRequest("r@t.com", "react", "password", "RM"));
            userService.approveUser(reg.id(), "USER", 1L);
            userService.disableUser(reg.id());
            userService.reactivateUser(reg.id());

            User user = userRepo.findById(reg.id()).orElseThrow();
            assertEquals(AccountStatus.ACTIVE, user.getStatus());
        }
    }

    @Nested
    @DisplayName("Role management")
    class RoleManagement {

        @Test
        @DisplayName("should update user role")
        void updateRole() {
            var reg = userService.register(
                new RegisterRequest("role@t.com", "roletest", "password", "RT"));
            userService.approveUser(reg.id(), "USER", 1L);
            var updated = userService.updateUserRole(reg.id(), "ADMIN");

            assertEquals("ADMIN", updated.role());
            User user = userRepo.findById(reg.id()).orElseThrow();
            assertEquals(Role.ADMIN, user.getRole());
        }
    }

    @Nested
    @DisplayName("Guest session management")
    class GuestSessionManagement {

        @Test
        @DisplayName("should return active guest sessions")
        void getActiveGuestSessions() {
            userService.guestLogin(
                new GuestLoginRequest("G1", null, null, "10.0.0.1", "Chrome"));
            userService.guestLogin(
                new GuestLoginRequest("G2", null, null, "10.0.0.2", "Firefox"));

            var sessions = userService.getActiveGuestSessions();
            assertEquals(2, sessions.size());
            // Connection count should be in the response
            assertTrue(sessions.get(0).connectionCount() >= 1);
        }

        @Test
        @DisplayName("should return correct active guest count")
        void activeGuestCount() {
            assertEquals(0, userService.getActiveGuestCount());
            userService.guestLogin(
                new GuestLoginRequest("Counter", null, null, "1.1.1.1", "Test"));
            assertEquals(1, userService.getActiveGuestCount());
        }

        @Test
        @DisplayName("should expire expired guest sessions")
        void expireGuestSessions() {
            // Create a guest with a past expiry
            userService.guestLogin(
                new GuestLoginRequest("ExpiredG", null, null, "1.1.1.1", "Test"));
            // Simulate 31 days of inactivity — expireGuestSessions() expires on
            // lastSeenAt (kept fresh by heartbeat), not on expiresAt.
            var sessions = sessionRepo.findByStatus(GuestSession.Status.ACTIVE);
            sessions.forEach(s -> {
                s.setLastSeenAt(java.time.LocalDateTime.now().minusDays(31));
                sessionRepo.save(s);
            });

            userService.expireGuestSessions();
            var active = sessionRepo.findByStatus(GuestSession.Status.ACTIVE);
            assertTrue(active.isEmpty());
        }
    }
}
