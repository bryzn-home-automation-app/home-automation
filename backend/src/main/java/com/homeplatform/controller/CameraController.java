package com.homeplatform.controller;

import com.homeplatform.dto.CameraBatteryHistoryResponse;
import com.homeplatform.dto.CameraLiveResponse;
import com.homeplatform.dto.CameraResponse;
import com.homeplatform.homeassistant.CameraService;
import com.homeplatform.homeassistant.HomeAssistantClient;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/**
 * Camera API, members only (USER / ADMIN) — guests never see cameras. Authenticated by
 * {@code JwtAuthFilter}; errors mapped in {@link HomeExceptionHandler}.
 */
@RestController
@RequestMapping("/api/home/cameras")
public class CameraController {

    private final CameraService service;

    public CameraController(CameraService service) {
        this.service = service;
    }

    @GetMapping
    public List<CameraResponse> cameras(HttpServletRequest request) {
        HomeController.requireMember(request);
        return service.listCameras();
    }

    /** Battery history ({@code from}/{@code to} as ISO-8601 instants; defaults to the last 24h). */
    @GetMapping("/{id}/battery")
    public CameraBatteryHistoryResponse battery(@PathVariable String id,
                                                @RequestParam(required = false) String from,
                                                @RequestParam(required = false) String to,
                                                HttpServletRequest request) {
        HomeController.requireMember(request);
        return service.batteryHistory(id, HomeController.instant(from, "from"), HomeController.instant(to, "to"));
    }

    /** Proxied still image — the browser never talks to HA or sees its token. */
    @GetMapping("/{id}/snapshot")
    public ResponseEntity<byte[]> snapshot(@PathVariable String id, HttpServletRequest request) {
        HomeController.requireMember(request);
        HomeAssistantClient.CameraImage img = service.snapshot(id);
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

    /** A short-lived ticketed URL for the live-view WebSocket (see CameraStreamAuthController). */
    @PostMapping("/{id}/live")
    public CameraLiveResponse live(@PathVariable String id, HttpServletRequest request) {
        HomeController.requireMember(request);
        return service.startLive(id);
    }
}
