package com.homeplatform.security;

import com.homeplatform.model.User;
import com.homeplatform.repository.UserRepository;
import jakarta.servlet.FilterChain;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

/** A token is only as good as the account behind it right now. */
class JwtAuthFilterTest {

    private static final String SECRET = "test-secret-that-is-at-least-32-bytes-long!!";

    private JwtUtil jwt;
    private UserRepository users;
    private UserAccessCache cache;
    private OnlineTracker online;
    private JwtAuthFilter filter;
    private User user;

    @BeforeEach
    void setUp() {
        jwt = new JwtUtil(SECRET, 3_600_000);
        users = mock(UserRepository.class);
        cache = new UserAccessCache(users);
        online = new OnlineTracker();
        filter = new JwtAuthFilter(jwt, cache, online);
        user = new User();
        user.setId(5L);
        user.setStatus(User.AccountStatus.ACTIVE);
        user.setRole(User.Role.ADMIN);
        when(users.findById(5L)).thenAnswer(i -> Optional.of(user));
    }

    private MockHttpServletResponse call(String token, FilterChain chain, MockHttpServletRequest req) throws Exception {
        req.setRequestURI("/api/home/cameras");
        req.setServletPath("/api/home/cameras"); // DispatcherServlet is mapped to "/"
        req.addHeader("Authorization", "Bearer " + token);
        MockHttpServletResponse resp = new MockHttpServletResponse();
        filter.doFilter(req, resp, chain);
        return resp;
    }

    @Test
    @DisplayName("an active user passes, with the role taken from the database")
    void activeUser() throws Exception {
        String token = jwt.generateToken(5L, "bryan", "ADMIN");
        user.setRole(User.Role.USER); // demoted after the token was issued
        FilterChain chain = mock(FilterChain.class);
        var req = new MockHttpServletRequest();

        var resp = call(token, chain, req);

        verify(chain).doFilter(any(), any());
        assertEquals(200, resp.getStatus());
        assertEquals("USER", req.getAttribute("role"), "demotion applies immediately, not at token expiry");
        assertEquals(5L, req.getAttribute("userId"));
    }

    @Test
    @DisplayName("a disabled, expired or deleted account is rejected despite a valid token")
    void inactiveRejected() throws Exception {
        String token = jwt.generateToken(5L, "bryan", "ADMIN");
        for (User.AccountStatus status : new User.AccountStatus[]{User.AccountStatus.DISABLED, User.AccountStatus.EXPIRED}) {
            user.setStatus(status);
            cache.evict(5L); // what UserService does on disable / expiry
            FilterChain chain = mock(FilterChain.class);
            var resp = call(token, chain, new MockHttpServletRequest());
            assertEquals(401, resp.getStatus(), status.name());
            verify(chain, never()).doFilter(any(), any());
        }
        when(users.findById(5L)).thenReturn(Optional.empty());
        cache.evict(5L);
        FilterChain chain = mock(FilterChain.class);
        assertEquals(401, call(token, chain, new MockHttpServletRequest()).getStatus());
    }

    @Test
    @DisplayName("a request that gets through marks its person online, whatever their role; a refused one doesn't")
    void marksOnline() throws Exception {
        String token = jwt.generateToken(5L, "bryan", "ADMIN");
        assertFalse(online.isOnline(5L));

        call(token, mock(FilterChain.class), new MockHttpServletRequest());
        assertTrue(online.isOnline(5L), "an admin is online too, not only guests");

        online.signedOut(5L);
        user.setStatus(User.AccountStatus.DISABLED);
        cache.evict(5L);
        assertEquals(401, call(token, mock(FilterChain.class), new MockHttpServletRequest()).getStatus());
        assertFalse(online.isOnline(5L), "a refused token doesn't count");
    }

    @Test
    @DisplayName("lookups are cached briefly, and evict forces a fresh read")
    void cached() {
        cache.get(5L);
        cache.get(5L);
        verify(users, times(1)).findById(5L);
        cache.evict(5L);
        cache.get(5L);
        verify(users, times(2)).findById(5L);
    }

    @Test
    @DisplayName("an encoded or path-parameter spelling of /api/ still needs a token")
    void encodedApiPathStillChecked() throws Exception {
        // What Tomcat hands the filter for GET /%61pi/config and /api;x/config: the raw
        // URI as sent, and the decoded, parameter-free servlet path Spring routes on.
        for (String raw : new String[]{"/%61pi/config", "/api;x/config", "/%2561pi/../api/config"}) {
            var req = new MockHttpServletRequest("GET", raw);
            req.setServletPath("/api/config");
            FilterChain chain = mock(FilterChain.class);
            var resp = new MockHttpServletResponse();
            filter.doFilter(req, resp, chain);
            assertEquals(401, resp.getStatus(), raw);
            verify(chain, never()).doFilter(any(), any());
        }
    }

    /** Runs the filter with no token on a request Tomcat would hand it: raw URI and decoded servlet path. */
    private boolean passesWithoutToken(String rawUri, String servletPath) throws Exception {
        var req = new MockHttpServletRequest("POST", rawUri);
        req.setServletPath(servletPath);
        FilterChain chain = mock(FilterChain.class);
        var resp = new MockHttpServletResponse();
        filter.doFilter(req, resp, chain);
        boolean passed = mockingDetails(chain).getInvocations().size() == 1;
        assertEquals(passed ? 200 : 401, resp.getStatus(), rawUri);
        return passed;
    }

    @Test
    @DisplayName("the password reset is public by its exact path only")
    void resetPasswordExactMatchOnly() throws Exception {
        assertTrue(passesWithoutToken("/api/auth/reset-password", "/api/auth/reset-password"));
        // An encoded spelling of the reset path is still the reset path once decoded.
        assertTrue(passesWithoutToken("/api/auth/%72eset-password", "/api/auth/reset-password"));

        // Near misses, and paths that only contain or start with it, need a token.
        for (String path : new String[]{
                "/api/auth/reset-password/", "/api/auth/reset-password/x", "/api/auth/reset-passwordx",
                "/api/auth/reset-password.json", "/api/auth/Reset-Password", "/api/auth/reset-password/me",
                "/api/admin/users/birthdays", "/api/admin/users/2/birthday", "/api/auth/users"}) {
            assertFalse(passesWithoutToken(path, path), path);
        }
        // Raw URIs that mention the public path but decode (or normalise) to a protected one.
        String[][] disguised = {
                {"/api/auth/reset-password/../me", "/api/auth/me"},
                {"/api/auth/reset-password/..%2Fusers", "/api/auth/users"},
                {"/api/auth/reset-password;x/../../admin/users/birthdays", "/api/admin/users/birthdays"},
                {"/api/auth/reset-password%2F..%2F..%2Fadmin%2Fusers", "/api/admin/users"},
        };
        for (String[] d : disguised) {
            assertFalse(passesWithoutToken(d[0], d[1]), d[0]);
        }
    }

    @Test
    @DisplayName("public endpoints and static assets pass without a token")
    void publicPathsPass() throws Exception {
        for (String path : new String[]{"/api/health", "/api/auth/login", "/api/auth/reset-password", "/index.html", "/assets/app.js"}) {
            var req = new MockHttpServletRequest("GET", path);
            req.setServletPath(path);
            FilterChain chain = mock(FilterChain.class);
            filter.doFilter(req, new MockHttpServletResponse(), chain);
            verify(chain).doFilter(any(), any());
        }
    }
}
