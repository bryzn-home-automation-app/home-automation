package com.homeplatform.homeassistant;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Home Assistant connection settings ({@code app.home-assistant.*}). The integration is
 * active only when {@code enabled} is true AND both url and token are present — so the
 * stack boots cleanly on a machine where HA hasn't been set up yet.
 */
@Component
public class HomeAssistantProperties {

    private final boolean enabled;
    private final String url;
    private final String token;
    private final int requestTimeoutSeconds;

    public HomeAssistantProperties(
            @Value("${app.home-assistant.enabled:false}") boolean enabled,
            @Value("${app.home-assistant.url:}") String url,
            @Value("${app.home-assistant.token:}") String token,
            @Value("${app.home-assistant.request-timeout-seconds:10}") int requestTimeoutSeconds) {
        this.enabled = enabled;
        this.url = stripTrailingSlash(url == null ? "" : url.trim());
        this.token = token == null ? "" : token.trim();
        this.requestTimeoutSeconds = requestTimeoutSeconds > 0 ? requestTimeoutSeconds : 10;
    }

    /** True only when switched on and fully configured. */
    public boolean isActive() {
        return enabled && !url.isEmpty() && !token.isEmpty();
    }

    /** Human-readable reason the integration is off, or null when active. Never includes the token. */
    public String inactiveReason() {
        if (!enabled) return "HA_ENABLED is false";
        if (url.isEmpty()) return "HA_URL is not set";
        if (token.isEmpty()) return "HA_TOKEN is not set";
        return null;
    }

    public String getUrl() { return url; }
    String getToken() { return token; }
    public int getRequestTimeoutSeconds() { return requestTimeoutSeconds; }

    /** ws(s)://host/api/websocket derived from the REST base URL. */
    public String webSocketUrl() {
        String base = url.startsWith("https://") ? "wss://" + url.substring(8)
                : url.startsWith("http://") ? "ws://" + url.substring(7)
                : url;
        return base + "/api/websocket";
    }

    private static String stripTrailingSlash(String s) {
        while (s.endsWith("/")) s = s.substring(0, s.length() - 1);
        return s;
    }

    @Override
    public String toString() {
        // Deliberately omits the token.
        return "HomeAssistantProperties{enabled=" + enabled + ", url='" + url + "', tokenSet=" + !token.isEmpty() + "}";
    }
}
