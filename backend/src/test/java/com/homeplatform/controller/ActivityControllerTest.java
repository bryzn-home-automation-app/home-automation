package com.homeplatform.controller;

import com.homeplatform.dto.TabUsageResponse;
import com.homeplatform.model.TabActivity;
import com.homeplatform.service.TabActivityService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.util.List;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/** RBAC for tab usage: members report, guests are ignored, only admins read. */
class ActivityControllerTest {

    private TabActivityService service;
    private MockMvc mvc;

    @BeforeEach
    void setUp() {
        service = mock(TabActivityService.class);
        mvc = MockMvcBuilders.standaloneSetup(new ActivityController(service)).build();
    }

    @Test
    @DisplayName("a member's report is kept; a guest's is accepted and dropped")
    void record() throws Exception {
        mvc.perform(post("/api/activity").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"tab\":\"cameras\",\"kind\":\"view\"}")
                        .requestAttr("role", "USER").requestAttr("userId", 5L))
                .andExpect(status().isNoContent());
        verify(service).record(5L, "cameras", TabActivity.Kind.VIEW);

        mvc.perform(post("/api/activity").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"tab\":\"home\",\"kind\":\"active\"}")
                        .requestAttr("role", "GUEST").requestAttr("userId", 9L))
                .andExpect(status().isNoContent());
        verifyNoMoreInteractions(service);
    }

    @Test
    @DisplayName("an unknown kind is a 400")
    void badKind() throws Exception {
        mvc.perform(post("/api/activity").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"tab\":\"home\",\"kind\":\"scroll\"}")
                        .requestAttr("role", "ADMIN").requestAttr("userId", 1L))
                .andExpect(status().isBadRequest());
        verify(service, never()).record(any(), any(), any());
    }

    @Test
    @DisplayName("only admins see usage")
    void usage() throws Exception {
        when(service.usage(7)).thenReturn(new TabUsageResponse(7, List.of(new TabUsageResponse.TabTotal("home", 3, 10)), List.of()));
        mvc.perform(get("/api/admin/activity").param("days", "7").requestAttr("role", "ADMIN"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.household[0].tab").value("home"))
                .andExpect(jsonPath("$.household[0].activeMinutes").value(10));
        mvc.perform(get("/api/admin/activity").requestAttr("role", "USER"))
                .andExpect(status().isForbidden());
    }
}
