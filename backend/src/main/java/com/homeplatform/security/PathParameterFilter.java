package com.homeplatform.security;

import jakarta.servlet.Filter;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.ServletRequest;
import jakarta.servlet.ServletResponse;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import java.io.IOException;

/**
 * Refuses (400) any request whose path carries a ";": servlet path parameters such as
 * ";jsessionid=…". Tomcat strips them before Spring routes the request, so
 * "/api/auth/reset-password;x" or "/api/auth;x/reset-password" reach the reset handler while
 * anything comparing the raw path sees something else: nginx's exact-match location for the
 * reset missed them (its port-8090 gate), and JwtAuthFilter once compared the raw path
 * (ef4f992; it now uses the decoded servlet path). Runs first (SecurityConfig), before
 * JwtAuthFilter decides what is public.
 *
 * <p>Nothing in this app uses them: query strings aren't affected (getRequestURI() has no query),
 * upload names are made by the server, and Tomcat tracks sessions by cookie only
 * (server.servlet.session.tracking-modes), so it never writes ";jsessionid" into a URL.
 */
public class PathParameterFilter implements Filter {

    @Override
    public void doFilter(ServletRequest request, ServletResponse response, FilterChain chain)
            throws IOException, ServletException {
        String uri = ((HttpServletRequest) request).getRequestURI();
        if (uri != null && uri.indexOf(';') >= 0) {
            HttpServletResponse resp = (HttpServletResponse) response;
            resp.setStatus(400);
            resp.setContentType("application/json");
            resp.getWriter().write("{\"error\":\"Bad request path\"}");
            return;
        }
        chain.doFilter(request, response);
    }
}
