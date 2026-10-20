package com.homeplatform.controller;

import com.homeplatform.dto.*;
import com.homeplatform.homeassistant.HomeAssistantClient;
import com.homeplatform.homeassistant.HomeDeviceService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.Instant;
import java.time.format.DateTimeParseException;
import java.util.List;

/**
 * Smart-home API (thermostats, cameras) backed by Home Assistant. Authenticated by
 * {@code JwtAuthFilter}; role rules:
 * <ul>
 *   <li>GUEST — read thermostats only</li>
 *   <li>USER / ADMIN — read + control thermostats, view cameras</li>
 * </ul>
 * Errors are mapped in {@link HomeExceptionHandler}.
 */
@RestController
@RequestMapping("/api/home")
public class HomeController {

    private final HomeDeviceService service;

    public HomeController(HomeDeviceService service) {
        this.service = service;
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

    @PostMapping("/thermostats/{id}/mode")
    public ThermostatResponse mode(@PathVariable String id, @RequestBody ThermostatModeRequest body,
                                   HttpServletRequest request) {
        requireMember(request);
        return service.setMode(id, body == null ? null : body.mode());
    }

    @PostMapping("/thermostats/{id}/temperature")
    public ThermostatResponse temperature(@PathVariable String id, @RequestBody ThermostatTemperatureRequest body,
                                          HttpServletRequest request) {
        requireMember(request);
        return service.setTemperature(id, body);
    }

    @PostMapping("/thermostats/{id}/hold")
    public ThermostatResponse hold(@PathVariable String id, @RequestBody(required = false) ThermostatHoldRequest body,
                                   HttpServletRequest request) {
        requireMember(request);
        return service.hold(id, body == null ? null : body.preset());
    }

    @PostMapping("/thermostats/{id}/resume")
    public ThermostatResponse resume(@PathVariable String id, HttpServletRequest request) {
        requireMember(request);
        return service.resume(id);
    }

    // ── cameras ──

    @GetMapping("/cameras")
    public List<CameraResponse> cameras(HttpServletRequest request) {
        requireMember(request);
        return service.listCameras();
    }

    /** Proxied still image — the browser never talks to HA or sees its token. */
    @GetMapping("/cameras/{id}/snapshot")
    public ResponseEntity<byte[]> snapshot(@PathVariable String id, HttpServletRequest request) {
        requireMember(request);
        HomeAssistantClient.CameraImage img = service.cameraSnapshot(id);
        MediaType type;
        try {
            type = MediaType.parseMediaType(img.contentType());
        } catch (Exception e) {
            type = MediaType.IMAGE_JPEG;
        }
        return ResponseEntity.ok()
                .contentType(type)
                .cacheControl(CacheControl.noStore())
                .body(img.bytes());
    }

    private static Instant instant(String value, String name) {
        if (value == null || value.isBlank()) return null;
        try {
            return Instant.parse(value);
        } catch (DateTimeParseException e) {
            throw new IllegalArgumentException("'" + name + "' must be an ISO-8601 instant, e.g. 2026-10-19T00:00:00Z");
        }
    }
}
