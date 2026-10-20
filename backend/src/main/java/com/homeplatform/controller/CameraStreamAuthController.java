package com.homeplatform.controller;

import com.homeplatform.homeassistant.CameraService;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * nginx {@code auth_request} target for {@code /camera-stream/<ticket>/ws}. Outside
 * {@code /api/}, so JwtAuthFilter lets it through — the ticket is the credential — and
 * nginx never proxies {@code /internal/} from outside (the backend port isn't
 * published). 204 + {@code X-Stream-Src} tells nginx which go2rtc stream to open;
 * anything else is 403.
 */
@RestController
public class CameraStreamAuthController {

    static final String STREAM_HEADER = "X-Stream-Src";
    private static final Pattern URI = Pattern.compile("^/camera-stream/([A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+)/ws(\\?.*)?$");

    private final CameraService cameras;

    public CameraStreamAuthController(CameraService cameras) {
        this.cameras = cameras;
    }

    @GetMapping("/internal/camera-stream/auth")
    public ResponseEntity<Void> auth(@RequestHeader(value = "X-Original-URI", required = false) String originalUri) {
        Matcher m = originalUri == null ? null : URI.matcher(originalUri);
        if (m == null || !m.matches()) return ResponseEntity.status(HttpStatus.FORBIDDEN).build();
        return cameras.streamForTicket(m.group(1))
                .map(stream -> ResponseEntity.noContent().header(STREAM_HEADER, stream).<Void>build())
                .orElseGet(() -> ResponseEntity.status(HttpStatus.FORBIDDEN).build());
    }
}
