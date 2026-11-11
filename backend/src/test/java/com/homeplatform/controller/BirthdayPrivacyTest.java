package com.homeplatform.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.homeplatform.dto.GuestLoginRequest;
import com.homeplatform.dto.RegisterRequest;
import com.homeplatform.model.User;
import com.homeplatform.repository.UserRepository;
import com.homeplatform.security.JwtAuthFilter;
import com.homeplatform.security.JwtUtil;
import com.homeplatform.service.AlertEngine;
import com.homeplatform.service.MaintenanceService;
import com.homeplatform.service.PasswordResetService;
import com.homeplatform.service.UserService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.context.WebApplicationContext;

import java.time.LocalDate;

import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;

/**
 * A stored birthday leaves the server only through the admin API. Real context, real JWTs through
 * JwtAuthFilter, made-up people and dates.
 *
 * <p>Same context setup as UserServiceTest (no @AutoConfigureMockMvc, same mocks) so both share one
 * Spring context: a second one would re-run schema.sql on the shared in-memory H2 and fail.
 */
@SpringBootTest
@Transactional
class BirthdayPrivacyTest {

    private static final LocalDate BIRTHDAY = LocalDate.of(1991, 4, 27);

    @MockBean private AlertEngine alertEngine;
    @MockBean private MaintenanceService maintenanceService;

    @Autowired private WebApplicationContext context;
    @Autowired private JwtAuthFilter jwtAuthFilter;
    private MockMvc mvc;
    @Autowired private UserService userService;
    @Autowired private UserRepository userRepo;
    @Autowired private PasswordResetService passwordReset;
    @Autowired private JwtUtil jwt;
    @Autowired private ObjectMapper mapper;

    private User member;
    private String adminToken;
    private String memberToken;
    private String guestToken;

    @BeforeEach
    void setUp() {
        mvc = MockMvcBuilders.webAppContextSetup(context).addFilters(jwtAuthFilter).build();
        userService.seedAdminIfNeeded("admin@test.local", "admin", "admin123", "Admin");
        User admin = userRepo.findByUsernameIgnoreCase("admin").orElseThrow();
        var reg = userService.register(new RegisterRequest("leaktest@example.test", "leaktest", "password1", "Leak Test"));
        userService.approveUser(reg.id(), "USER", admin.getId());
        passwordReset.setBirthday(reg.id(), BIRTHDAY, "admin");
        member = userRepo.findById(reg.id()).orElseThrow();
        assertEquals(BIRTHDAY, member.getBirthDate());

        var guest = userService.guestLogin(new GuestLoginRequest("Leak Guest", null, null, "10.0.0.5", "test"));
        adminToken = jwt.generateToken(admin.getId(), "admin", "ADMIN");
        memberToken = jwt.generateToken(member.getId(), "leaktest", "USER");
        guestToken = guest.token();
    }

    private String body(MockHttpServletRequestBuilder req, String token, int expectStatus) throws Exception {
        var resp = mvc.perform(req.header("Authorization", "Bearer " + token)).andReturn().getResponse();
        assertEquals(expectStatus, resp.getStatus(), req.toString());
        return resp.getContentAsString();
    }

    private static void assertNoBirthday(String json, String what) {
        assertFalse(json.contains("1991-04-27"), what + ": " + json);
        assertFalse(json.contains("1991"), what + ": " + json);
        assertFalse(json.toLowerCase().contains("birth"), what + ": " + json);
    }

    @Test
    @DisplayName("members and guests never see a birthday: me, profile, the household list")
    void notInMemberApis() throws Exception {
        for (String token : new String[]{memberToken, guestToken, adminToken}) {
            assertNoBirthday(body(get("/api/auth/me"), token, 200), "me");
            assertNoBirthday(body(get("/api/auth/profile"), token, 200), "profile");
            String users = body(get("/api/auth/users"), token, 200);
            assertTrue(users.contains("leaktest"), "the member is in the list");
            assertNoBirthday(users, "users");
        }
        assertNoBirthday(body(put("/api/auth/profile").contentType(MediaType.APPLICATION_JSON)
                .content("{\"displayName\":\"Leak T\"}"), memberToken, 200), "profile update");
    }

    @Test
    @DisplayName("the admin user lists don't carry it either; only the birthdays endpoint does")
    void onlyTheAdminBirthdayEndpoint() throws Exception {
        assertNoBirthday(body(get("/api/admin/users"), adminToken, 200), "admin users");
        assertNoBirthday(body(get("/api/admin/users/pending"), adminToken, 200), "pending");
        String birthdays = body(get("/api/admin/users/birthdays"), adminToken, 200);
        assertTrue(birthdays.contains("{\"userId\":" + member.getId() + ",\"birthDate\":\"1991-04-27\"}"), birthdays);
    }

    @Test
    @DisplayName("members and guests can't read or change birthdays; anonymous callers can't either")
    void adminOnly() throws Exception {
        for (String token : new String[]{memberToken, guestToken}) {
            assertNoBirthday(body(get("/api/admin/users/birthdays"), token, 403), "birthdays");
            body(put("/api/admin/users/" + member.getId() + "/birthday").contentType(MediaType.APPLICATION_JSON)
                    .content("{\"birthDate\":\"2001-01-01\"}"), token, 403);
        }
        assertEquals(401, mvc.perform(get("/api/admin/users/birthdays")).andReturn().getResponse().getStatus());
        assertEquals(BIRTHDAY, userRepo.findById(member.getId()).orElseThrow().getBirthDate());
    }

    @Test
    @DisplayName("an admin sets, refuses for an admin account, and clears")
    void adminSetsAndClears() throws Exception {
        String url = "/api/admin/users/" + member.getId() + "/birthday";
        String set = body(put(url).contentType(MediaType.APPLICATION_JSON).content("{\"birthDate\":\"1993-08-09\"}"), adminToken, 200);
        assertEquals("{\"userId\":" + member.getId() + ",\"birthDate\":\"1993-08-09\"}", set);

        Long adminId = userRepo.findByUsernameIgnoreCase("admin").orElseThrow().getId();
        body(put("/api/admin/users/" + adminId + "/birthday").contentType(MediaType.APPLICATION_JSON)
                .content("{\"birthDate\":\"1980-01-01\"}"), adminToken, 400);
        body(put(url).contentType(MediaType.APPLICATION_JSON).content("{\"birthDate\":\"nope\"}"), adminToken, 400);
        body(put("/api/admin/users/999999/birthday").contentType(MediaType.APPLICATION_JSON)
                .content("{\"birthDate\":\"1980-01-01\"}"), adminToken, 404);

        body(put(url).contentType(MediaType.APPLICATION_JSON).content("{\"birthDate\":null}"), adminToken, 200);
        assertNull(userRepo.findById(member.getId()).orElseThrow().getBirthDate());
    }

    @Test
    @DisplayName("the entity itself serialises without it, should it ever be returned by mistake")
    void entityJsonIgnore() throws Exception {
        assertNoBirthday(mapper.writeValueAsString(member), "entity");
    }

    @Test
    @DisplayName("without a Home users file (AUTHELIA_USERS_FILE unset) the app boots with Forgot password off: not offered, 404")
    void offWithoutUsersFile() throws Exception {
        String config = mvc.perform(get("/api/auth/oidc/config")).andReturn().getResponse().getContentAsString();
        assertTrue(config.contains("\"passwordReset\":false"), config);
        assertTrue(config.contains("\"passwordMinLength\":8"), config);
        var resp = mvc.perform(post("/api/auth/reset-password").contentType(MediaType.APPLICATION_JSON)
                .content("{\"username\":\"leaktest\",\"birthDate\":\"1991-04-27\",\"newPassword\":\"fresh-password-9\"}"))
                .andReturn().getResponse();
        assertEquals(404, resp.getStatus());
        assertEquals("{\"error\":\"Password reset isn't turned on.\"}", resp.getContentAsString());
        assertFalse(passwordReset.isEnabled());
    }
}
