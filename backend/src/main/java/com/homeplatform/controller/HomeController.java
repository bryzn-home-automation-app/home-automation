package com.homeplatform.controller;

import com.homeplatform.dto.*;
import com.homeplatform.homeassistant.HomeDeviceService;
import com.homeplatform.homeassistant.ThermostatChangeRecorder;
import com.homeplatform.repository.UserRepository;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.*;

import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.List;

/**
 * Smart-home API (thermostats, cameras) backed by Home Assistant. Authenticated by
 * {@code JwtAuthFilter}; role rules:
 * <ul>
 *   <li>GUEST — read thermostats only</li>
 *   <li>USER / ADMIN — read + control thermostats (cameras: {@link CameraController})</li>
 * </ul>
 * Errors are mapped in {@link HomeExceptionHandler}.
 */
@RestController
@RequestMapping("/api/home")
public class HomeController {

    private final HomeDeviceService service;
    private final UserRepository users;

    public HomeController(HomeDeviceService service, UserRepository users) {
        this.service = service;
        this.users = users;
    }

    /** The caller, for "set by" attribution: display name, else username. */
    ThermostatChangeRecorder.Actor actor(HttpServletRequest request) {
        Long userId = request.getAttribute("userId") instanceof Long id ? id : null;
        String name = userId == null ? null : users.findById(userId)
                .map(u -> u.getDisplayName() != null && !u.getDisplayName().isBlank() ? u.getDisplayName() : u.getUsername())
                .orElse(null);
        if (name == null && request.getAttribute("username") instanceof String u && !u.isBlank()) name = u;
        return new ThermostatChangeRecorder.Actor(userId, name == null ? "Someone" : name);
    }

    static void requireAnyRole(HttpServletRequest request) {
        Object role = request.getAttribute("role");
        if (!"ADMIN".equals(role) && !"USER".equals(role) && !"GUEST".equals(role)) {
            throw new SecurityException("Access denied");
        }
    }

    /** USER or ADMIN — guests can look but not touch, and never see cameras. */
    static void requireMember(HttpServletRequest request) {
        Object role = request.getAttribute("role");
        if (!"ADMIN".equals(role) && !"USER".equals(role)) {
            throw new SecurityException("Access denied");
        }
    }

    // ── thermostats ──

    @GetMapping("/thermostats")
    public List<ThermostatResponse> thermostats(HttpServletRequest request) {
        requireAnyRole(request);
        return service.listThermostats();
    }

    @GetMapping("/thermostats/{id}")
    public ThermostatResponse thermostat(@PathVariable String id, HttpServletRequest request) {
        requireAnyRole(request);
        return service.getThermostat(id);
    }

    /** History window ({@code from}/{@code to} as ISO-8601 instants; defaults to the last 24h). */
    @GetMapping("/thermostats/{id}/history")
    public List<ThermostatReadingResponse> history(@PathVariable String id,
                                                   @RequestParam(required = false) String from,
                                                   @RequestParam(required = false) String to,
                                                   HttpServletRequest request) {
        requireAnyRole(request);
        return service.history(id, instant(from, "from"), instant(to, "to"));
    }

    /** Who changed the setpoint/mode/hold recently, newest first. */
    @GetMapping("/thermostats/{id}/changes")
    public List<ThermostatChangeResponse> changes(@PathVariable String id,
                                                  @RequestParam(defaultValue = "20") int limit,
                                                  HttpServletRequest request) {
        requireAnyRole(request);
        return service.changes(id, limit);
    }

    @PostMapping("/thermostats/{id}/mode")
    public ThermostatResponse mode(@PathVariable String id, @RequestBody ThermostatModeRequest body,
                                   HttpServletRequest request) {
        requireMember(request);
        return service.setMode(id, body == null ? null : body.mode(), actor(request));
    }

    @PostMapping("/thermostats/{id}/temperature")
    public ThermostatResponse temperature(@PathVariable String id, @RequestBody ThermostatTemperatureRequest body,
                                          HttpServletRequest request) {
        requireMember(request);
        return service.setTemperature(id, body, actor(request));
    }

    @PostMapping("/thermostats/{id}/hold")
    public ThermostatResponse hold(@PathVariable String id, @RequestBody(required = false) ThermostatHoldRequest body,
                                   HttpServletRequest request) {
        requireMember(request);
        return service.hold(id, body == null ? null : body.preset(), actor(request));
    }

    @PostMapping("/thermostats/{id}/resume")
    public ThermostatResponse resume(@PathVariable String id, HttpServletRequest request) {
        requireMember(request);
        return service.resume(id, actor(request));
    }

    // Cameras: see CameraController.

    static Instant instant(String value, String name) {
        if (value == null || value.isBlank()) return null;
        try {
            return Instant.parse(value);
        } catch (DateTimeParseException e) {
            throw new IllegalArgumentException("'" + name + "' must be an ISO-8601 instant, e.g. 2026-10-19T00:00:00Z");
        }
    }
}
