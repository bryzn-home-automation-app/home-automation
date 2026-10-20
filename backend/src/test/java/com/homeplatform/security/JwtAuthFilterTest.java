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
    private JwtAuthFilter filter;
    private User user;

    @BeforeEach
    void setUp() {
        jwt = new JwtUtil(SECRET, 3_600_000);
        users = mock(UserRepository.class);
        cache = new UserAccessCache(users);
        filter = new JwtAuthFilter(jwt, cache);
        user = new User();
        user.setId(5L);
        user.setStatus(User.AccountStatus.ACTIVE);
        user.setRole(User.Role.ADMIN);
        when(users.findById(5L)).thenAnswer(i -> Optional.of(user));
    }

    private MockHttpServletResponse call(String token, FilterChain chain, MockHttpServletRequest req) throws Exception {
        req.setRequestURI("/api/home/cameras");
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
    @DisplayName("lookups are cached briefly, and evict forces a fresh read")
    void cached() {
        cache.get(5L);
        cache.get(5L);
        verify(users, times(1)).findById(5L);
        cache.evict(5L);
        cache.get(5L);
        verify(users, times(2)).findById(5L);
    }
}
