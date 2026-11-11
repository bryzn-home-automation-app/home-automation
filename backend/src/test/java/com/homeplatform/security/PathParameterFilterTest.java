package com.homeplatform.security;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.mock;

/** Paths with ";" (servlet path parameters) never get past the first filter. */
class PathParameterFilterTest {

    private MockHttpServletResponse run(String uri, String query) throws Exception {
        MockHttpServletRequest req = new MockHttpServletRequest("POST", uri);
        req.setQueryString(query);
        MockHttpServletResponse resp = new MockHttpServletResponse();
        MockFilterChain chain = new MockFilterChain();
        new PathParameterFilter().doFilter(req, resp, chain);
        if (resp.getStatus() == 400) assertNull(chain.getRequest(), uri + " went on down the chain");
        else assertNotNull(chain.getRequest(), uri + " was stopped");
        return resp;
    }

    @Test
    @DisplayName("a ';' anywhere in the path is a 400, before anything else sees the request")
    void refused() throws Exception {
        for (String uri : new String[]{
                "/api/auth/reset-password;jsessionid=x", "/api/auth/reset-password;", "/api/auth;x/reset-password",
                "/api;x/auth/reset-password", "/api/auth/reset-password;a=b/", "/api/auth/x/..;/reset-password",
                "/api/auth/reset-password;%2F", "/api/config;x", "/uploads/avatars/1_ab.png;x"}) {
            var resp = run(uri, null);
            assertEquals(400, resp.getStatus(), uri);
            assertEquals("{\"error\":\"Bad request path\"}", resp.getContentAsString(), uri);
            assertEquals("application/json", resp.getContentType());
        }
    }

    @Test
    @DisplayName("everything the app really uses goes through, ';' in a query string included")
    void allowed() throws Exception {
        String[][] ok = {
                {"/api/auth/reset-password", null},
                {"/api/auth/oidc/callback", "code=a;b&state=c"},
                {"/internal/camera-stream/auth", null},
                {"/uploads/avatars/12_1a2b3c4d.png", null},
                {"/uploads/maintenance/12_1a2b3c4d.jpg", null},
                {"/api/bills/file", "id=3"},
                {"/", null},
        };
        for (String[] t : ok) assertEquals(200, run(t[0], t[1]).getStatus(), t[0]);
    }

    @Test
    @DisplayName("registered ahead of JwtAuthFilter")
    void orderedFirst() {
        SecurityConfig config = new SecurityConfig(mock(JwtAuthFilter.class));
        assertTrue(config.pathParameterFilter().getOrder() < config.jwtFilter().getOrder());
        assertTrue(config.pathParameterFilter().getUrlPatterns().contains("/*"));
    }
}
