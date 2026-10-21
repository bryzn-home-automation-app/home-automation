package com.homeplatform.controller;

import com.homeplatform.dto.CameraLiveResponse;
import com.homeplatform.dto.CameraResponse;
import com.homeplatform.homeassistant.CameraService;
import com.homeplatform.homeassistant.HomeAssistantClient;
import com.homeplatform.homeassistant.HomeDeviceService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.util.List;
import java.util.Optional;

import static org.hamcrest.Matchers.containsString;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/** RBAC for /api/home/cameras/* and the nginx stream-auth hook. Role is supplied directly. */
class CameraControllerTest {

    private static final String ID = "3f1c9a52-6a43-4f0e-9a8e-2d5c1f7b9e10";

    private CameraService service;
    private com.homeplatform.homeassistant.CameraRecordingService recordings;
    private MockMvc mvc;

    @BeforeEach
    void setUp() {
        service = mock(CameraService.class);
        recordings = mock(com.homeplatform.homeassistant.CameraRecordingService.class);
        mvc = MockMvcBuilders
                .standaloneSetup(new CameraController(service, recordings), new CameraStreamAuthController(service))
                .setControllerAdvice(new HomeExceptionHandler())
                .build();
    }

    @Test
    @DisplayName("members list recordings and get a recording's video; an offline service is a 503 with its reason")
    void recordings() throws Exception {
        when(recordings.list(7)).thenReturn(List.of(new com.homeplatform.dto.CameraRecordingResponse(
                "2026102000042", ID, "Front", "2026-10-20T19:47:51-05:00", "2026-10-20T19:48:11-05:00", 20_000L, 4_693_164L, true)));
        mvc.perform(get("/api/home/cameras/recordings").param("days", "7").requestAttr("role", "USER"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].cameraName").value("Front"))
                .andExpect(jsonPath("$[0].durationMs").value(20000));

        when(recordings.video("2026102000042")).thenReturn(new byte[]{1, 2, 3});
        mvc.perform(get("/api/home/cameras/recordings/2026102000042/video").requestAttr("role", "USER"))
                .andExpect(status().isOk())
                .andExpect(content().contentType("video/mp4"))
                .andExpect(content().bytes(new byte[]{1, 2, 3}));

        when(recordings.thumbnail("1")).thenThrow(new com.homeplatform.homeassistant.RecordingsClient.Unavailable("HomeBase didn't answer"));
        mvc.perform(get("/api/home/cameras/recordings/1/thumbnail").requestAttr("role", "ADMIN"))
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.error").value(containsString("HomeBase didn't answer")));
    }

    @Test
    @DisplayName("guests and anonymous callers can't touch any camera endpoint")
    void guestsBlocked() throws Exception {
        for (String role : new String[]{"GUEST", null}) {
            var list = get("/api/home/cameras");
            var snap = get("/api/home/cameras/" + ID + "/snapshot");
            var battery = get("/api/home/cameras/" + ID + "/battery");
            var live = post("/api/home/cameras/" + ID + "/live");
            var recs = get("/api/home/cameras/recordings");
            var video = get("/api/home/cameras/recordings/2026102000042/video");
            var thumb = get("/api/home/cameras/recordings/2026102000042/thumbnail");
            for (var r : List.of(list, snap, battery, live, recs, video, thumb)) {
                if (role != null) r.requestAttr("role", role);
                mvc.perform(r).andExpect(status().isForbidden());
            }
        }
        verifyNoInteractions(service);
        verifyNoInteractions(recordings);
    }

    @Test
    @DisplayName("members list cameras, fetch snapshots, and get live tickets")
    void members() throws Exception {
        when(service.listCameras()).thenReturn(List.of(new CameraResponse(ID, "Driveway", true, "battery",
                64.0, true, "Solar charging", null, null, null, true, null, List.of(), false)));
        mvc.perform(get("/api/home/cameras").requestAttr("role", "USER"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].batteryPercent").value(64.0))
                .andExpect(jsonPath("$[0].liveAvailable").value(true));

        when(service.snapshot(ID)).thenReturn(new HomeAssistantClient.CameraImage(new byte[]{1, 2, 3}, "image/jpeg"));
        mvc.perform(get("/api/home/cameras/" + ID + "/snapshot").requestAttr("role", "ADMIN"))
                .andExpect(status().isOk())
                .andExpect(content().contentType("image/jpeg"))
                .andExpect(content().bytes(new byte[]{1, 2, 3}))
                .andExpect(header().string("Cache-Control", containsString("no-store")));

        when(service.startLive(ID, "mse")).thenReturn(new CameraLiveResponse("/camera-stream/a.b/ws", "2026-10-20T18:01:00Z"));
        mvc.perform(post("/api/home/cameras/" + ID + "/live").requestAttr("role", "USER"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.url").value("/camera-stream/a.b/ws"));
    }

    @Test
    @DisplayName("bad history range → 400; unknown camera → 404; no stream → 422")
    void errors() throws Exception {
        mvc.perform(get("/api/home/cameras/" + ID + "/battery").param("from", "yesterday").requestAttr("role", "USER"))
                .andExpect(status().isBadRequest());
        when(service.snapshot(anyString())).thenThrow(new HomeDeviceService.NotFound());
        mvc.perform(get("/api/home/cameras/" + ID + "/snapshot").requestAttr("role", "USER"))
                .andExpect(status().isNotFound());
        when(service.startLive(anyString(), anyString())).thenThrow(new HomeDeviceService.Unsupported("no stream", false));
        mvc.perform(post("/api/home/cameras/" + ID + "/live").requestAttr("role", "USER"))
                .andExpect(status().isUnprocessableEntity());
    }

    @Test
    @DisplayName("stream auth: valid ticket → 204 + stream header; anything else → 403")
    void streamAuth() throws Exception {
        when(service.streamForTicket("good.sig")).thenReturn(Optional.of("T8170X"));
        when(service.streamForTicket("bad.sig")).thenReturn(Optional.empty());

        mvc.perform(get("/internal/camera-stream/auth").header("X-Original-URI", "/camera-stream/good.sig/ws"))
                .andExpect(status().isNoContent())
                .andExpect(header().string("X-Stream-Src", "T8170X"));
        mvc.perform(get("/internal/camera-stream/auth").header("X-Original-URI", "/camera-stream/bad.sig/ws"))
                .andExpect(status().isForbidden());
        mvc.perform(get("/internal/camera-stream/auth").header("X-Original-URI", "/camera-stream/good.sig/../api/streams"))
                .andExpect(status().isForbidden());
        // HLS: the master playlist and the files it references, same ticket.
        for (String ok : new String[]{"/camera-stream/good.sig/stream.m3u8", "/camera-stream/good.sig/hls/playlist.m3u8?id=abc",
                "/camera-stream/good.sig/hls/segment.m4s?id=abc&n=3", "/camera-stream/good.sig/hls/init.mp4?id=abc"}) {
            mvc.perform(get("/internal/camera-stream/auth").header("X-Original-URI", ok)).andExpect(status().isNoContent());
        }
        mvc.perform(get("/internal/camera-stream/auth").header("X-Original-URI", "/camera-stream/good.sig/hls/../streams"))
                .andExpect(status().isForbidden());
        mvc.perform(get("/internal/camera-stream/auth")).andExpect(status().isForbidden());
        verify(service, times(6)).streamForTicket(any());
    }
}
