package com.homeplatform.controller;

import com.homeplatform.dto.HostHealthResponse;
import com.homeplatform.dto.HostHistoryResponse;
import com.homeplatform.service.HostMetricsService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.util.List;

import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/** NUC Health is admin-only. */
class HostHealthControllerTest {

    private HostMetricsService service;
    private MockMvc mvc;

    @BeforeEach
    void setUp() {
        service = mock(HostMetricsService.class);
        mvc = MockMvcBuilders.standaloneSetup(new HostHealthController(service)).build();
    }

    @Test
    @DisplayName("only admins see the NUC's health")
    void view() throws Exception {
        when(service.view()).thenReturn(new HostHealthResponse("ONLINE", null, null, null,
                List.of(new HostHealthResponse.Check("disk", "warning", "Drive C: is getting full", "20 GB free of 237 GB.")),
                null));
        mvc.perform(get("/api/admin/host").requestAttr("role", "ADMIN"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("ONLINE"))
                .andExpect(jsonPath("$.checks[0].title").value("Drive C: is getting full"));
        mvc.perform(get("/api/admin/host").requestAttr("role", "USER")).andExpect(status().isForbidden());
        mvc.perform(get("/api/admin/host").requestAttr("role", "GUEST")).andExpect(status().isForbidden());
    }

    @Test
    @DisplayName("history defaults to 24 hours; an unknown range is a 400; members can't read it")
    void history() throws Exception {
        when(service.history("24h")).thenReturn(new HostHistoryResponse("24h", 5, null, null, null, List.of(), null, List.of()));
        when(service.history("1y")).thenThrow(new IllegalArgumentException("range must be 24h, 7d or 30d"));
        mvc.perform(get("/api/admin/host/history").requestAttr("role", "ADMIN"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.bucketMinutes").value(5));
        mvc.perform(get("/api/admin/host/history").param("range", "1y").requestAttr("role", "ADMIN"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").value("range must be 24h, 7d or 30d"));
        mvc.perform(get("/api/admin/host/history").requestAttr("role", "USER")).andExpect(status().isForbidden());
        verify(service, never()).history("7d");
    }
}
