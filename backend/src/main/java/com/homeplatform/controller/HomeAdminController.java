package com.homeplatform.controller;

import com.homeplatform.dto.SmartDeviceResponse;
import com.homeplatform.homeassistant.HomeAssistantService;
import com.homeplatform.homeassistant.HomeDeviceService;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

/** ADMIN-only smart-home device management (discovery, enable/disable). */
@RestController
@RequestMapping("/api/admin/home")
public class HomeAdminController {

    private final HomeDeviceService service;

    public HomeAdminController(HomeDeviceService service) {
        this.service = service;
    }

    private void requireAdmin(HttpServletRequest request) {
        if (!"ADMIN".equals(request.getAttribute("role"))) {
            throw new SecurityException("Admin access required");
        }
    }

    @GetMapping("/devices")
    public List<SmartDeviceResponse> devices(HttpServletRequest request) {
        requireAdmin(request);
        return service.listDevices();
    }

    /** Re-scan HA for climate/camera entities and take a thermostat snapshot. */
    @PostMapping("/discover")
    public Map<String, Object> discover(HttpServletRequest request) {
        requireAdmin(request);
        HomeAssistantService.SyncResult r = service.discover();
        return Map.of(
                "thermostats", r.devices().thermostats(),
                "cameras", r.devices().cameras(),
                "added", r.devices().added(),
                "readingsWritten", r.readingsWritten());
    }

    /** Body: {@code {"enabled": true|false}}. */
    @PutMapping("/devices/{id}")
    public SmartDeviceResponse update(@PathVariable String id, @RequestBody Map<String, Object> body,
                                      HttpServletRequest request) {
        requireAdmin(request);
        Object enabled = body == null ? null : body.get("enabled");
        if (!(enabled instanceof Boolean b)) {
            throw new IllegalArgumentException("'enabled' (boolean) is required");
        }
        return service.setEnabled(id, b);
    }
}
