package com.homeplatform.controller;

import com.homeplatform.model.User;
import com.homeplatform.model.User.AccountStatus;
import com.homeplatform.model.User.Role;
import com.homeplatform.repository.UserRepository;
import com.homeplatform.security.AutheliaUsersFile;
import com.homeplatform.service.AppEventService;
import com.homeplatform.service.FakeRedis;
import com.homeplatform.service.LoginRateLimiter;
import com.homeplatform.service.NotificationService;
import com.homeplatform.service.PasswordResetService;
import com.homeplatform.service.UserService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.crypto.argon2.Argon2PasswordEncoder;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;

/**
 * POST /api/auth/reset-password as the sign-in page sees it, writing a real (temporary) Home users
 * file. Made-up people, dates and hashes only.
 */
class PasswordResetControllerTest {

    /** Shaped like Authelia's users file on the NUC. */
    private static final String HOME_USERS = """
            users:
              boss:
                displayname: "Boss"
                email: "admin1@example.test"
                password: "$2a$10$fakeBOSSfakeBOSSfakeBOuL0ngFakeHashForTheBossAccount.xyz"
                groups: [admin, family]
              member:
                displayname: "Member"
                email: "member@example.test"
                password: "$2a$10$fakeMEMBERfakeMEMBERfakL0ngFakeHashForTheMemberAccount.x"
                groups: [family]
              wrongly-admin:
                displayname: "Mixed Up"
                email: "mixedup@example.test"
                password: "$2a$10$fakeMIXEDfakeMIXEDfakeML0ngFakeHashForTheMixedAccount.xy"
                groups: [family, admin]
            """;

    @TempDir Path dir;
    private Path usersFile;
    private final List<User> people = new ArrayList<>();
    private UserRepository users;
    private FakeRedis redis;
    private MockMvc mvc;

    @BeforeEach
    void setUp() throws Exception {
        usersFile = dir.resolve("users_database.yml");
        Files.writeString(usersFile, HOME_USERS);
        users = mock(UserRepository.class);
        when(users.findByUsernameIgnoreCase(anyString())).thenAnswer(i -> people.stream()
                .filter(u -> u.getUsername().equalsIgnoreCase(i.getArgument(0))).findFirst());
        when(users.findByRoleAndStatus(any(), any())).thenReturn(List.of());
        redis = new FakeRedis();
        mvc = mvc(usersFile.toString(), false);

        add("admin1", Role.ADMIN, AccountStatus.ACTIVE, LocalDate.of(1975, 5, 5));
        add("member", Role.USER, AccountStatus.ACTIVE, LocalDate.of(1992, 11, 20));
        add("guest1", Role.GUEST, AccountStatus.ACTIVE, LocalDate.of(1992, 11, 20));
        add("waiting", Role.USER, AccountStatus.PENDING_APPROVAL, LocalDate.of(1992, 11, 20));
        add("nobday", Role.USER, AccountStatus.ACTIVE, null);
        add("mixedup", Role.USER, AccountStatus.ACTIVE, LocalDate.of(1992, 11, 20));   // Home account is in admin
        add("nohome", Role.USER, AccountStatus.ACTIVE, LocalDate.of(1992, 11, 20));    // no Home account
    }

    /** The controller with the real reset service and users file (Authelia's own argon2 cost). */
    private MockMvc mvc(String usersFileLocation, boolean passwordLogin) {
        PasswordResetService reset = new PasswordResetService(users, new AutheliaUsersFile(usersFileLocation, "admin"),
                redis.limiter(), mock(AppEventService.class), mock(NotificationService.class), 0);
        return MockMvcBuilders.standaloneSetup(
                new AuthController(mock(UserService.class), mock(LoginRateLimiter.class), reset, passwordLogin)).build();
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

    private String homeHashOf(String homeUsername) throws Exception {
        Matcher m = Pattern.compile("(?m)^  " + Pattern.quote(homeUsername) + ":\\n(?:    .*\\n)*?    password: \"([^\"]+)\"")
                .matcher(Files.readString(usersFile));
        assertTrue(m.find());
        return m.group(1);
    }

    @Test
    @DisplayName("the right birthday sets the member's Home password (argon2id at Authelia's cost), with password sign-in off")
    void success() throws Exception {
        var resp = reset("member", "1992-11-20", "new-password-1", "10.0.0.1");
        assertEquals(200, resp.getStatus());
        assertEquals("{\"status\":\"reset\"}", resp.getContentAsString());

        String hash = homeHashOf("member");
        assertTrue(hash.startsWith("$argon2id$v=19$m=65536,t=3,p=4$"), hash);
        assertTrue(new Argon2PasswordEncoder(16, 32, 4, 65536, 3).matches("new-password-1", hash));
        assertEquals("$2a$10$fakeBOSSfakeBOSSfakeBOuL0ngFakeHashForTheBossAccount.xyz", homeHashOf("boss"), "the admin's is untouched");
    }

    @Test
    @DisplayName("unknown user, admin, guest, pending, no birthday, wrong birthday, a Home admin and no Home account get byte-for-byte the same answer")
    void identicalNoMatch() throws Exception {
        String[][] tries = {
                {"stranger", "1992-11-20"},
                {"admin1", "1975-05-05"},
                {"guest1", "1992-11-20"},
                {"waiting", "1992-11-20"},
                {"nobday", "1992-11-20"},
                {"member", "1992-11-21"},
                {"mixedup", "1992-11-20"},
                {"nohome", "1992-11-20"},
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
        assertEquals(HOME_USERS, Files.readString(usersFile), "nothing written");
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
        assertEquals(HOME_USERS, Files.readString(usersFile));
    }

    @Test
    @DisplayName("malformed input is a 400 that names the problem, before any account is looked at")
    void badInput() throws Exception {
        assertEquals(400, reset("member", "1992-02-30", "new-password-1", "10.0.0.1").getStatus());
        assertEquals(400, reset("member", "not-a-date", "new-password-1", "10.0.0.1").getStatus());
        assertEquals(400, reset("member", null, "new-password-1", "10.0.0.1").getStatus());
        var shortPw = reset("member", "1992-11-20", "1234567", "10.0.0.1");
        assertEquals(400, shortPw.getStatus());
        assertEquals("{\"error\":\"Password must be at least 8 characters.\"}", shortPw.getContentAsString());
        assertTrue(redis.values.isEmpty(), "nothing counted");
        assertEquals(HOME_USERS, Files.readString(usersFile));
    }

    @Test
    @DisplayName("with no Home users file configured it's off: 404, whatever the password sign-in switch says")
    void offWithoutUsersFile() throws Exception {
        for (boolean passwordLogin : new boolean[]{true, false}) {
            mvc = mvc("", passwordLogin);
            var resp = reset("member", "1992-11-20", "new-password-1", "10.0.0.1");
            assertEquals(404, resp.getStatus());
            assertEquals("{\"error\":\"Password reset isn't turned on.\"}", resp.getContentAsString());
        }
        assertTrue(redis.values.isEmpty());
    }

    @Test
    @DisplayName("a configured users file that isn't there: 503 for everyone, nothing counted")
    void usersFileMissing() throws Exception {
        Files.delete(usersFile);
        assertEquals(503, reset("member", "1992-11-20", "new-password-1", "10.0.0.1").getStatus());
        assertEquals(503, reset("stranger", "1992-11-20", "new-password-1", "10.0.0.1").getStatus());
        assertTrue(redis.values.isEmpty());
    }

    @Test
    @DisplayName("Redis unreachable: 503, not an unlimited reset")
    void unavailable() throws Exception {
        redis.down = true;
        assertEquals(503, reset("member", "1992-11-20", "new-password-1", "10.0.0.1").getStatus());
        assertEquals(HOME_USERS, Files.readString(usersFile));
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
