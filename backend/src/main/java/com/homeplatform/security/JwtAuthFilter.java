package com.homeplatform.security;

import jakarta.servlet.*;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.util.List;

@Component
public class JwtAuthFilter implements Filter {

    private final JwtUtil jwtUtil;

    // Only these specific auth endpoints are public — /api/auth/me and
    // /api/auth/heartbeat require a valid token.
    private static final List<String> PUBLIC_PATHS = List.of(
            "/api/auth/login",
            "/api/auth/register",
            "/api/auth/guest-login",
            "/api/health",
            "/swagger-ui",
            "/v3/api-docs"
    );

    private static final List<String> PUBLIC_PREFIXES = List.of(
            // nothing for now — exact match only
    );

    public JwtAuthFilter(JwtUtil jwtUtil) {
        this.jwtUtil = jwtUtil;
    }

    @Override
    public void doFilter(ServletRequest request, ServletResponse response, FilterChain chain)
            throws IOException, ServletException {

        HttpServletRequest httpReq = (HttpServletRequest) request;
        HttpServletResponse httpResp = (HttpServletResponse) response;
        String path = httpReq.getRequestURI();

        // Allow OPTIONS preflight
        if ("OPTIONS".equalsIgnoreCase(httpReq.getMethod())) {
            chain.doFilter(request, response);
            return;
        }

        // Allow exact-match public paths (e.g. /api/auth/login, /api/health)
        if (PUBLIC_PATHS.contains(path)) {
            chain.doFilter(request, response);
            return;
        }

        // Allow prefix-match public paths (e.g. /swagger-ui/...)
        for (String prefix : PUBLIC_PREFIXES) {
            if (path.startsWith(prefix)) {
                chain.doFilter(request, response);
                return;
            }
        }

        // Allow static assets (no /api/ prefix)
        if (!path.startsWith("/api/")) {
            chain.doFilter(request, response);
            return;
        }

        // Extract token
        String header = httpReq.getHeader("Authorization");
        if (header == null || !header.startsWith("Bearer ")) {
            sendUnauthorized(httpResp, "Missing or invalid Authorization header");
            return;
        }

        String token = header.substring(7);
        if (!jwtUtil.isTokenValid(token)) {
            sendUnauthorized(httpResp, "Invalid or expired token");
            return;
        }

        // Set user attributes on the request for controllers to consume
        httpReq.setAttribute("userId", jwtUtil.getUserId(token));
        httpReq.setAttribute("username", jwtUtil.getUsername(token));
        httpReq.setAttribute("role", jwtUtil.getRole(token));

        chain.doFilter(request, response);
    }

    private void sendUnauthorized(HttpServletResponse response, String message) throws IOException {
        response.setStatus(401);
        response.setContentType("application/json");
        response.getWriter().write("{\"error\":\"" + message + "\"}");
    }
}
