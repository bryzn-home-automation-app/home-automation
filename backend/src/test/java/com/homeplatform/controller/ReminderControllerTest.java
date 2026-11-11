package com.homeplatform.controller;

import com.homeplatform.dto.ReminderRequest;
import com.homeplatform.service.ReminderService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.time.LocalDate;
import java.util.List;

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/** /api/reminders: admins and members only (guests refused on every call), errors as plain messages. */
class ReminderControllerTest {

    private ReminderService service;
    private MockMvc mvc;

    @BeforeEach
    void setUp() {
        service = mock(ReminderService.class);
        mvc = MockMvcBuilders.standaloneSetup(new ReminderController(service)).build();
    }

    private static MockHttpServletRequestBuilder as(MockHttpServletRequestBuilder b, String role) {
        if (role != null) b.requestAttr("role", role);
        return b.requestAttr("userId", 7L).contentType(MediaType.APPLICATION_JSON);
    }

    private static final String TRASH = "{\"name\":\"Trash day\",\"repeat\":\"WEEKLY\",\"weekdays\":[\"FRI\"],\"dueBy\":\"08:00\","
            + "\"headsUps\":[{\"kind\":\"AFTERNOON_BEFORE\"},{\"kind\":\"EVENING_BEFORE\"}]}";

    @Test
    @DisplayName("guests and anonymous callers are refused everywhere, and the service is never asked")
    void guests() throws Exception {
        for (String role : new String[] {"GUEST", null}) {
            mvc.perform(as(get("/api/reminders"), role)).andExpect(status().isForbidden());
            mvc.perform(as(get("/api/reminders/due"), role)).andExpect(status().isForbidden());
            mvc.perform(as(get("/api/reminders/heads-ups"), role)).andExpect(status().isForbidden());
            mvc.perform(as(get("/api/reminders/1"), role)).andExpect(status().isForbidden());
            mvc.perform(as(post("/api/reminders"), role).content(TRASH)).andExpect(status().isForbidden());
            mvc.perform(as(put("/api/reminders/1"), role).content(TRASH)).andExpect(status().isForbidden());
            mvc.perform(as(put("/api/reminders/1/alerts"), role).content("{\"alerts\":false}")).andExpect(status().isForbidden());
            mvc.perform(as(delete("/api/reminders/1"), role)).andExpect(status().isForbidden());
            mvc.perform(as(post("/api/reminders/1/complete"), role).content("{\"date\":\"2026-11-13\"}")).andExpect(status().isForbidden());
            mvc.perform(as(post("/api/reminders/1/undo"), role).content("{\"date\":\"2026-11-13\"}")).andExpect(status().isForbidden());
        }
        verifyNoInteractions(service);
    }

    @Test
    @DisplayName("admins and members can read, add, change, delete and complete")
    void members() throws Exception {
        when(service.list()).thenReturn(List.of());
        when(service.due()).thenReturn(List.of());
        mvc.perform(as(get("/api/reminders"), "USER")).andExpect(status().isOk());
        mvc.perform(as(get("/api/reminders/due"), "ADMIN")).andExpect(status().isOk());
        mvc.perform(as(get("/api/reminders/heads-ups"), "USER")).andExpect(status().isOk())
                .andExpect(jsonPath("$[2].kind").value("AFTERNOON_BEFORE"))
                .andExpect(jsonPath("$[2].time").value("14:00"));
        mvc.perform(as(post("/api/reminders"), "USER").content(TRASH)).andExpect(status().isCreated());
        verify(service).create(argThat((ReminderRequest r) -> r.name().equals("Trash day") && r.headsUps().size() == 2
                && r.weekdays().equals(List.of("FRI")) && "08:00".equals(r.dueBy())), eq(7L));
        mvc.perform(as(put("/api/reminders/3"), "ADMIN").content(TRASH)).andExpect(status().isOk());
        verify(service).update(eq(3L), any(), eq(7L));
        mvc.perform(as(put("/api/reminders/3/alerts"), "USER").content("{\"alerts\":false}")).andExpect(status().isOk());
        verify(service).setAlerts(3L, false, 7L);
        mvc.perform(as(delete("/api/reminders/3"), "USER")).andExpect(status().isOk());
        verify(service).delete(3L, 7L);
        mvc.perform(as(post("/api/reminders/3/complete"), "USER").content("{\"date\":\"2026-11-13\"}")).andExpect(status().isOk());
        verify(service).complete(3L, LocalDate.of(2026, 11, 13), 7L);
        mvc.perform(as(post("/api/reminders/3/undo"), "ADMIN").content("{\"date\":\"2026-11-13\"}")).andExpect(status().isOk());
        verify(service).undo(3L, LocalDate.of(2026, 11, 13), 7L);
    }

    @Test
    @DisplayName("validation is a 400 with the message, a missing reminder a 404")
    void errors() throws Exception {
        when(service.create(any(), any())).thenThrow(new IllegalArgumentException("Give the reminder a name"));
        mvc.perform(as(post("/api/reminders"), "USER").content("{\"name\":\"\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.error").value("Give the reminder a name"));

        when(service.get(9L)).thenThrow(new ReminderService.NotFound());
        mvc.perform(as(get("/api/reminders/9"), "USER")).andExpect(status().isNotFound())
                .andExpect(jsonPath("$.error").value("That reminder doesn't exist any more"));

        mvc.perform(as(post("/api/reminders/3/complete"), "USER").content("{\"date\":\"Friday\"}"))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error").value("Dates look like 2026-11-13"));
        mvc.perform(as(post("/api/reminders/3/complete"), "USER").content("{}"))
                .andExpect(status().isBadRequest());
        mvc.perform(as(put("/api/reminders/3/alerts"), "USER").content("{}"))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.error").value("Say whether alerts are on"));
        verify(service, never()).complete(any(), any(), any());
    }
}
