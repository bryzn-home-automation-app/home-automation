package com.homeplatform.controller;

import com.homeplatform.dto.CameraBatteryHistoryResponse;
import com.homeplatform.dto.CameraLiveResponse;
import com.homeplatform.dto.CameraResponse;
import com.homeplatform.homeassistant.CameraService;
import com.homeplatform.homeassistant.HomeAssistantClient;
import jakarta.servlet.http.HttpServletRequest;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.CacheControl;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

/**
 * Camera API, members only (USER / ADMIN) — guests never see cameras. Authenticated by
 * {@code JwtAuthFilter}; errors mapped in {@link HomeExceptionHandler}.
 */
@RestController
@RequestMapping("/api/home/cameras")
public class CameraController {

    private static final Logger log = LoggerFactory.getLogger(CameraController.class);

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

    /**
     * The live player's own report ~8 s into a session (codec, bytes received, video
     * element state). Logged only — it's how a black tile on a phone gets debugged.
     */
    @PostMapping("/{id}/live/diagnostics")
    public Map<String, Object> liveDiagnostics(@PathVariable String id, @RequestBody(required = false) Map<String, Object> report,
                                               HttpServletRequest request) {
        HomeController.requireMember(request);
        String text = String.valueOf(report);
        log.info("Live view diagnostics camera={} user={} {}", id, request.getAttribute("username"),
                text.length() > 2000 ? text.substring(0, 2000) : text);
        return Map.of("ok", true);
    }
}
