package com.homeplatform.controller;

import com.homeplatform.dto.CameraBatteryHistoryResponse;
import com.homeplatform.dto.CameraLiveResponse;
import com.homeplatform.dto.CameraRecordingResponse;
import com.homeplatform.dto.CameraResponse;
import com.homeplatform.homeassistant.CameraRecordingService;
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
    private final CameraRecordingService recordings;

    public CameraController(CameraService service, CameraRecordingService recordings) {
        this.service = service;
        this.recordings = recordings;
    }

    @GetMapping
    public List<CameraResponse> cameras(HttpServletRequest request) {
        HomeController.requireMember(request);
        return service.listCameras();
    }

    /** Recordings stored on the HomeBase, newest first, for the last {@code days} (default 7). */
    @GetMapping("/recordings")
    public List<CameraRecordingResponse> recordings(@RequestParam(required = false) Integer days, HttpServletRequest request) {
        HomeController.requireMember(request);
        return recordings.list(days);
    }

    /** The HomeBase's still for a recording (small JPEG; recordings never change, so cacheable). */
    @GetMapping("/recordings/{recordingId}/thumbnail")
    public ResponseEntity<byte[]> recordingThumbnail(@PathVariable String recordingId, HttpServletRequest request) {
        HomeController.requireMember(request);
        return ResponseEntity.ok()
                .contentType(MediaType.IMAGE_JPEG)
                .cacheControl(CacheControl.maxAge(java.time.Duration.ofDays(7)).cachePrivate())
                .body(recordings.thumbnail(recordingId));
    }

    /** A recording as MP4 (H.265, full size). The first request pulls it off the HomeBase (a few seconds). */
    @GetMapping("/recordings/{recordingId}/video")
    public ResponseEntity<byte[]> recordingVideo(@PathVariable String recordingId, HttpServletRequest request) {
        HomeController.requireMember(request);
        return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType("video/mp4"))
                .cacheControl(CacheControl.noStore())
                .body(recordings.video(recordingId));
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

    public record PresetRequest(Integer index) {}

    public record NudgeRequest(String direction) {}

    /** Move a pan/tilt camera to a stored preset ({@code {"index": 1}}). */
    @PostMapping("/{id}/preset")
    public Map<String, Object> goToPreset(@PathVariable String id, @RequestBody PresetRequest body, HttpServletRequest request) {
        HomeController.requireMember(request);
        if (body == null || body.index() == null) throw new IllegalArgumentException("'index' is required");
        service.goToPreset(id, body.index());
        return Map.of("ok", true);
    }

    /** Nudge a pan/tilt camera: {@code {"direction": "left|right|up|down"}}. */
    @PostMapping("/{id}/ptz")
    public Map<String, Object> nudge(@PathVariable String id, @RequestBody NudgeRequest body, HttpServletRequest request) {
        HomeController.requireMember(request);
        CameraService.Direction dir;
        try {
            dir = CameraService.Direction.valueOf(String.valueOf(body == null ? null : body.direction()).toUpperCase());
        } catch (IllegalArgumentException e) {
            throw new IllegalArgumentException("'direction' must be left, right, up or down");
        }
        service.nudge(id, dir);
        return Map.of("ok", true);
    }

    /** A short-lived ticketed URL for the live-view WebSocket (see CameraStreamAuthController). */
    @PostMapping("/{id}/live")
    public CameraLiveResponse live(@PathVariable String id, @RequestParam(defaultValue = "mse") String format,
                                   HttpServletRequest request) {
        HomeController.requireMember(request);
        return service.startLive(id, format);
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
