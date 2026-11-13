package com.homeplatform.controller;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.homeplatform.dto.GuestLoginRequest;
import com.homeplatform.dto.RegisterRequest;
import com.homeplatform.model.GuestSession;
import com.homeplatform.model.User;
import com.homeplatform.repository.GuestSessionRepository;
import com.homeplatform.repository.UserRepository;
import com.homeplatform.security.JwtAuthFilter;
import com.homeplatform.security.JwtUtil;
import com.homeplatform.service.AlertEngine;
import com.homeplatform.service.MaintenanceService;
import com.homeplatform.service.UserService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.context.WebApplicationContext;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;

/**
 * People's "online": this person's app made a signed-in request in the last few minutes, for every
 * role. It used to mean "has an ACTIVE guest session", so an admin or member was never online and a
 * guest read online for 30 days. Real context, real JWTs through JwtAuthFilter.
 *
 * <p>Same context setup as UserServiceTest and BirthdayPrivacyTest, so all three share one Spring
 * context (a second one would re-run schema.sql on the shared in-memory H2 and fail).
 */
@SpringBootTest
@Transactional
class OnlineStatusTest {

    @MockBean private AlertEngine alertEngine;
    @MockBean private MaintenanceService maintenanceService;

    @Autowired private WebApplicationContext context;
    @Autowired private JwtAuthFilter jwtAuthFilter;
    @Autowired private UserService userService;
    @Autowired private UserRepository userRepo;
    @Autowired private GuestSessionRepository sessionRepo;
    @Autowired private JwtUtil jwt;
    @Autowired private ObjectMapper mapper;
    private MockMvc mvc;

    private Long adminId, memberId, guestId;
    private String adminToken, memberToken, guestToken;

    @BeforeEach
    void setUp() {
        mvc = MockMvcBuilders.webAppContextSetup(context).addFilters(jwtAuthFilter).build();
        userService.seedAdminIfNeeded("admin@test.local", "admin", "admin123", "Admin");
        User admin = userRepo.findByUsernameIgnoreCase("admin").orElseThrow();
        var reg = userService.register(new RegisterRequest("online@example.test", "onlinetest", "password1", "Online Test"));
        userService.approveUser(reg.id(), "USER", admin.getId());
        var guest = userService.guestLogin(new GuestLoginRequest("Online Guest", null, null, "10.0.0.7", "test"));

        adminId = admin.getId();
        memberId = reg.id();
        guestId = guest.userId();
        adminToken = jwt.generateToken(adminId, "admin", "ADMIN");
        memberToken = jwt.generateToken(memberId, "onlinetest", "USER");
        guestToken = guest.token();
    }

    private void call(MockHttpServletRequestBuilder req, String token) throws Exception {
        var resp = mvc.perform(req.header("Authorization", "Bearer " + token)).andReturn().getResponse();
        assertEquals(200, resp.getStatus(), req.toString());
    }

    /** GET /api/auth/users as the admin (which marks the admin online too), by user id. */
    private Map<Long, Map<String, Object>> people() throws Exception {
        String json = mvc.perform(get("/api/auth/users").header("Authorization", "Bearer " + adminToken))
                .andReturn().getResponse().getContentAsString();
        List<Map<String, Object>> list = mapper.readValue(json, new TypeReference<>() {});
        return list.stream().collect(java.util.stream.Collectors.toMap(p -> ((Number) p.get("id")).longValue(), p -> p));
    }

    @Test
    @DisplayName("the admin using the app is online; a guest with a live 30-day pass but no app open isn't")
    void adminOnlineGuestPassIsNot() throws Exception {
        assertFalse(sessionRepo.findByUserIdAndStatus(guestId, GuestSession.Status.ACTIVE).isEmpty(), "the guest's session is ACTIVE");

        var people = people();
        assertEquals(true, people.get(adminId).get("isOnline"), "the bug: an admin was never online");
        assertNotNull(people.get(adminId).get("lastActiveAt"));
        assertEquals(false, people.get(guestId).get("isOnline"), "an ACTIVE guest session alone isn't online");
        assertEquals(false, people.get(memberId).get("isOnline"));
        assertNull(people.get(memberId).get("lastActiveAt"));
    }

    @Test
    @DisplayName("any signed-in request counts: a member's heartbeat, a guest's lobby refresh")
    void requestsMarkOnline() throws Exception {
        call(post("/api/auth/heartbeat"), memberToken);
        call(get("/api/auth/users"), guestToken); // the guest lobby's 30-second poll

        var people = people();
        assertEquals(true, people.get(memberId).get("isOnline"));
        assertEquals(true, people.get(guestId).get("isOnline"));
    }

    @Test
    @DisplayName("the heartbeat still keeps a guest's 30-day session alive")
    void heartbeatStillKeepsGuestSession() throws Exception {
        GuestSession s = sessionRepo.findByUserIdAndStatus(guestId, GuestSession.Status.ACTIVE).get(0);
        s.setLastSeenAt(LocalDateTime.now().minusDays(10));
        sessionRepo.save(s);

        call(post("/api/auth/heartbeat"), guestToken);

        var after = sessionRepo.findByUserIdAndStatus(guestId, GuestSession.Status.ACTIVE).get(0);
        assertTrue(after.getLastSeenAt().isAfter(LocalDateTime.now().minusMinutes(1)));
    }

    @Test
    @DisplayName("signing out reads offline at once, still showing when they were last active")
    void signOutIsOfflineNow() throws Exception {
        call(post("/api/auth/heartbeat"), memberToken);
        assertEquals(true, people().get(memberId).get("isOnline"));

        call(post("/api/auth/logout"), memberToken);

        var member = people().get(memberId);
        assertEquals(false, member.get("isOnline"));
        assertNotNull(member.get("lastActiveAt"));
    }

    @Test
    @DisplayName("sign-out needs a token, like every other signed-in endpoint")
    void logoutNeedsToken() throws Exception {
        assertEquals(401, mvc.perform(post("/api/auth/logout")).andReturn().getResponse().getStatus());
    }
}
