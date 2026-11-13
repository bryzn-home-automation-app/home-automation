package com.homeplatform.controller;

import com.homeplatform.dto.RoombaScheduleSkipResponse;
import com.homeplatform.service.RoombaScheduleSkipService;
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
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/** Everyone sees the skips; only an admin skips or undoes, like the robot's other commands. */
class RoombaScheduleSkipControllerTest {

    private RoombaScheduleSkipService service;
    private MockMvc mvc;

    private static final RoombaScheduleSkipResponse SKIP = new RoombaScheduleSkipResponse(
            7L, "hh_TUETHU_s", "hh_TUETHU_s", "2026-11-17", 9, 0, "2026-11-17T15:00Z", "2026-11-17T15:30Z",
            "PENDING", null, null, false, "user:5", "2026-11-17T02:00Z", null, null);

    @BeforeEach
    void setUp() {
        service = mock(RoombaScheduleSkipService.class);
        mvc = MockMvcBuilders.standaloneSetup(new RoombaScheduleSkipController(service)).build();
    }

    @Test
    @DisplayName("any member can read the skips")
    void list() throws Exception {
        when(service.recent()).thenReturn(List.of(SKIP));
        mvc.perform(get("/api/roomba/schedule-skips").requestAttr("role", "USER"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].date").value("2026-11-17"))
                .andExpect(jsonPath("$[0].state").value("PENDING"));
    }

    @Test
    @DisplayName("an admin skips a clean, recorded as theirs")
    void adminSkips() throws Exception {
        when(service.skip("hh_TUETHU_s", "2026-11-17", "user:5")).thenReturn(SKIP);
        mvc.perform(post("/api/admin/roomba/schedule-skips").requestAttr("role", "ADMIN").requestAttr("userId", 5L)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"householdScheduleId\":\"hh_TUETHU_s\",\"date\":\"2026-11-17\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(7));
    }

    @Test
    @DisplayName("a member can't skip or undo")
    void memberRefused() throws Exception {
        mvc.perform(post("/api/admin/roomba/schedule-skips").requestAttr("role", "USER")
                        .contentType(MediaType.APPLICATION_JSON).content("{\"householdScheduleId\":\"x\",\"date\":\"2026-11-17\"}"))
                .andExpect(status().isForbidden());
        mvc.perform(post("/api/admin/roomba/schedule-skips/7/undo").requestAttr("role", "USER"))
                .andExpect(status().isForbidden());
        verify(service, never()).skip(any(), any(), any());
        verify(service, never()).undo(any(), any());
    }

    @Test
    @DisplayName("a refused skip says why; undo answers 404 and 409")
    void errors() throws Exception {
        when(service.skip(any(), any(), any())).thenThrow(new IllegalArgumentException("That clean has already started."));
        mvc.perform(post("/api/admin/roomba/schedule-skips").requestAttr("role", "ADMIN")
                        .contentType(MediaType.APPLICATION_JSON).content("{\"householdScheduleId\":\"x\",\"date\":\"2026-11-17\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").value("That clean has already started."));
        when(service.undo(eq(8L), any())).thenThrow(new NoSuchElementException("No such skip"));
        mvc.perform(post("/api/admin/roomba/schedule-skips/8/undo").requestAttr("role", "ADMIN"))
                .andExpect(status().isNotFound());
        when(service.undo(eq(7L), any())).thenThrow(new IllegalStateException("That skip has already ended."));
        mvc.perform(post("/api/admin/roomba/schedule-skips/7/undo").requestAttr("role", "ADMIN"))
                .andExpect(status().isConflict());
    }

    private static <T> T eq(T value) {
        return org.mockito.ArgumentMatchers.eq(value);
    }
}
