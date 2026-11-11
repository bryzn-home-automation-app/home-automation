package com.homeplatform.controller;

import com.homeplatform.model.User;
import com.homeplatform.model.User.AccountStatus;
import com.homeplatform.model.User.Role;
import com.homeplatform.repository.UserRepository;
import com.homeplatform.service.AppEventService;
import com.homeplatform.service.FakeRedis;
import com.homeplatform.service.LoginRateLimiter;
import com.homeplatform.service.NotificationService;
import com.homeplatform.service.PasswordResetService;
import com.homeplatform.service.UserService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;

/** POST /api/auth/reset-password as the sign-in page sees it. Made-up people and dates only. */
class PasswordResetControllerTest {

    private final List<User> people = new ArrayList<>();
    private UserService userService;
    private FakeRedis redis;
    private MockMvc mvc;

    @BeforeEach
    void setUp() {
        UserRepository users = mock(UserRepository.class);
        when(users.findByUsernameIgnoreCase(anyString())).thenAnswer(i -> people.stream()
                .filter(u -> u.getUsername().equalsIgnoreCase(i.getArgument(0))).findFirst());
        when(users.findByRoleAndStatus(any(), any())).thenReturn(List.of());
        userService = mock(UserService.class);
        redis = new FakeRedis();
        mvc = mvc(users, true);

        add("admin1", Role.ADMIN, AccountStatus.ACTIVE, LocalDate.of(1975, 5, 5));
        add("member", Role.USER, AccountStatus.ACTIVE, LocalDate.of(1992, 11, 20));
        add("guest1", Role.GUEST, AccountStatus.ACTIVE, LocalDate.of(1992, 11, 20));
        add("waiting", Role.USER, AccountStatus.PENDING_APPROVAL, LocalDate.of(1992, 11, 20));
        add("nobday", Role.USER, AccountStatus.ACTIVE, null);
    }

    private MockMvc mvc(UserRepository users, boolean passwordLogin) {
        PasswordResetService reset = new PasswordResetService(users, userService, redis.limiter(),
                mock(AppEventService.class), mock(NotificationService.class), 0);
        return MockMvcBuilders.standaloneSetup(
                new AuthController(userService, mock(LoginRateLimiter.class), reset, passwordLogin)).build();
    }

    private void add(String username, Role role, AccountStatus status, LocalDate birthday) {
        people.add(User.builder().id((long) people.size() + 1).username(username).email(username + "@example.test")
                .role(role).status(status).birthDate(birthday).build());
    }

    private MockHttpServletResponse reset(String username, String birthDate, String password, String ip) throws Exception {
        String body = "{\"username\":\"" + username + "\",\"birthDate\":" + (birthDate == null ? "null" : "\"" + birthDate + "\"")
                + ",\"newPassword\":\"" + password + "\"}";
        return mvc.perform(post("/api/auth/reset-password").contentType(MediaType.APPLICATION_JSON).content(body)
                .with(r -> { r.setRemoteAddr(ip); return r; })).andReturn().getResponse();
    }

    @Test
    @DisplayName("the right birthday for an active member resets the password")
    void success() throws Exception {
        var resp = reset("member", "1992-11-20", "new-password-1", "10.0.0.1");
        assertEquals(200, resp.getStatus());
        assertEquals("{\"status\":\"reset\"}", resp.getContentAsString());
        verify(userService).setPassword(people.get(1), "new-password-1");
    }

    @Test
    @DisplayName("unknown user, admin, guest, pending, no birthday and wrong birthday get byte-for-byte the same answer")
    void identicalNoMatch() throws Exception {
        String[][] tries = {
                {"stranger", "1992-11-20"},
                {"admin1", "1975-05-05"},
                {"guest1", "1992-11-20"},
                {"waiting", "1992-11-20"},
                {"nobday", "1992-11-20"},
                {"member", "1992-11-21"},
        };
        String firstBody = null;
        int i = 0;
        for (String[] t : tries) {
            // A fresh address each time, so only the account decides the answer.
            var resp = reset(t[0], t[1], "new-password-1", "10.0.1." + i++);
            assertEquals(401, resp.getStatus(), t[0]);
            assertEquals("{\"error\":\"That didn't match. Check your username and birthday, or ask Bryan.\"}",
                    resp.getContentAsString(), t[0]);
            if (firstBody == null) firstBody = resp.getContentAsString();
            assertEquals(firstBody, resp.getContentAsString());
            assertNull(resp.getHeader("Retry-After"), t[0]);
        }
        verify(userService, never()).setPassword(any(), any());
    }

    @Test
    @DisplayName("after five wrong tries the answer is 429 with Retry-After, for real and made-up usernames alike")
    void throttled() throws Exception {
        for (String username : new String[]{"member", "made-up"}) {
            for (int i = 0; i < 5; i++) assertEquals(401, reset(username, "1990-01-0" + (i + 1), "new-password-1", "10.0.2." + i).getStatus());
            var resp = reset(username, "1992-11-20", "new-password-1", "10.0.3.1");
            assertEquals(429, resp.getStatus(), username);
            assertEquals("3600", resp.getHeader("Retry-After"));
            assertTrue(resp.getContentAsString().contains("\"retryAfterSeconds\":3600"));
        }
        verify(userService, never()).setPassword(any(), any());
    }

    @Test
    @DisplayName("malformed input is a 400 that names the problem, before any account is looked at")
    void badInput() throws Exception {
        assertEquals(400, reset("member", "1992-02-30", "new-password-1", "10.0.0.1").getStatus());
        assertEquals(400, reset("member", "not-a-date", "new-password-1", "10.0.0.1").getStatus());
        assertEquals(400, reset("member", null, "new-password-1", "10.0.0.1").getStatus());
        var shortPw = reset("member", "1992-11-20", "123", "10.0.0.1");
        assertEquals(400, shortPw.getStatus());
        assertEquals("{\"error\":\"Password must be at least 6 characters.\"}", shortPw.getContentAsString());
        assertTrue(redis.values.isEmpty(), "nothing counted");
    }

    @Test
    @DisplayName("while password sign-in is switched off, there's nothing to reset: 403 like login and register")
    void offWithPasswordLogin() throws Exception {
        mvc = mvc(mock(UserRepository.class), false);
        var resp = reset("member", "1992-11-20", "new-password-1", "10.0.0.1");
        assertEquals(403, resp.getStatus());
        assertTrue(resp.getContentAsString().contains("Sign in with Home"));
        verify(userService, never()).setPassword(any(), any());
    }

    @Test
    @DisplayName("Redis unreachable: 503, not an unlimited reset")
    void unavailable() throws Exception {
        redis.down = true;
        assertEquals(503, reset("member", "1992-11-20", "new-password-1", "10.0.0.1").getStatus());
        verify(userService, never()).setPassword(any(), any());
    }

    @Test
    @DisplayName("the client address comes from nginx's X-Forwarded-For, which nginx replaces rather than appends")
    void clientAddressFromNginx() throws Exception {
        for (int i = 0; i < 20; i++) {
            mvc.perform(post("/api/auth/reset-password").contentType(MediaType.APPLICATION_JSON)
                    .header("X-Forwarded-For", "192.168.4.50")
                    .content("{\"username\":\"u" + i + "\",\"birthDate\":\"1990-01-01\",\"newPassword\":\"new-password-1\"}"));
        }
        assertEquals("20", redis.values.get("reset-pw:ip:192.168.4.50"));
    }

    @Test
    @DisplayName("PUT is not a way in")
    void onlyPost() throws Exception {
        assertEquals(405, mvc.perform(put("/api/auth/reset-password")).andReturn().getResponse().getStatus());
    }
}
