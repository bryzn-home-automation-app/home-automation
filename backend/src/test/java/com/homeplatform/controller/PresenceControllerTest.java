package com.homeplatform.controller;

import com.homeplatform.dto.PresenceResponse;
import com.homeplatform.service.PresenceService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.util.List;
import java.util.NoSuchElementException;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/** Who's home is admin-only, for reading and for labeling. */
class PresenceControllerTest {

    private PresenceService service;
    private MockMvc mvc;

    @BeforeEach
    void setUp() {
        service = mock(PresenceService.class);
        mvc = MockMvcBuilders.standaloneSetup(new PresenceController(service)).build();
    }

    @Test
    @DisplayName("only admins see who's home")
    void view() throws Exception {
        when(service.view()).thenReturn(new PresenceResponse(new PresenceResponse.Scanner(null, false, 0), 15,
                List.of(new PresenceResponse.Person("Bryan", true, null, null, 1)), List.of()));
        mvc.perform(get("/api/admin/presence").requestAttr("role", "ADMIN"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.people[0].name").value("Bryan"))
                .andExpect(jsonPath("$.awayAfterMinutes").value(15));
        mvc.perform(get("/api/admin/presence").requestAttr("role", "USER")).andExpect(status().isForbidden());
        mvc.perform(get("/api/admin/presence").requestAttr("role", "GUEST")).andExpect(status().isForbidden());
    }

    @Test
    @DisplayName("admins label a device; others can't, and an unknown device is a 404")
    void label() throws Exception {
        String body = "{\"label\":\"Bryan's iPhone\",\"person\":\"Bryan\"}";
        mvc.perform(patch("/api/admin/presence/devices/3").contentType(MediaType.APPLICATION_JSON).content(body)
                        .requestAttr("role", "ADMIN"))
                .andExpect(status().isNoContent());
        verify(service).label(3L, "Bryan's iPhone", "Bryan");

        mvc.perform(patch("/api/admin/presence/devices/3").contentType(MediaType.APPLICATION_JSON).content(body)
                        .requestAttr("role", "USER"))
                .andExpect(status().isForbidden());
        verify(service, times(1)).label(any(), any(), any());

        doThrow(new NoSuchElementException("No such device")).when(service).label(eq(9L), any(), any());
        mvc.perform(patch("/api/admin/presence/devices/9").contentType(MediaType.APPLICATION_JSON).content(body)
                        .requestAttr("role", "ADMIN"))
                .andExpect(status().isNotFound());
    }
}
