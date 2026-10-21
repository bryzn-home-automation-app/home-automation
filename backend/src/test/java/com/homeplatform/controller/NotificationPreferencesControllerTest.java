package com.homeplatform.controller;

import com.homeplatform.dto.NotificationPreferenceResponse;
import com.homeplatform.model.AlertType;
import com.homeplatform.service.AlertEngine;
import com.homeplatform.service.NotificationPreferenceService;
import com.homeplatform.service.NotificationService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.util.List;

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/** /api/notifications/preferences: members only, validated, per user. */
class NotificationPreferencesControllerTest {

    private NotificationPreferenceService prefs;
    private MockMvc mvc;

    private static final NotificationPreferenceResponse PERSON =
            new NotificationPreferenceResponse("PERSON_DETECTED", "CAMERA", "Person outside", "x", true, true, true, true);

    @BeforeEach
    void setUp() {
        prefs = mock(NotificationPreferenceService.class);
        mvc = MockMvcBuilders.standaloneSetup(
                new NotificationController(mock(NotificationService.class), mock(AlertEngine.class), prefs)).build();
    }

    @Test
    @DisplayName("guests and anonymous callers are refused")
    void guests() throws Exception {
        for (String role : new String[]{"GUEST", null}) {
            var get = get("/api/notifications/preferences");
            var put = put("/api/notifications/preferences/PERSON_DETECTED")
                    .contentType(MediaType.APPLICATION_JSON).content("{\"inApp\":false,\"push\":false}");
            if (role != null) {
                get.requestAttr("role", role);
                put.requestAttr("role", role);
            }
            mvc.perform(get).andExpect(status().isForbidden());
            mvc.perform(put).andExpect(status().isForbidden());
        }
        verifyNoInteractions(prefs);
    }

    @Test
    @DisplayName("members read and change their own settings; bad input is a 400")
    void members() throws Exception {
        when(prefs.list(7L)).thenReturn(List.of(PERSON));
        mvc.perform(get("/api/notifications/preferences").requestAttr("role", "USER").requestAttr("userId", 7L))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].type").value("PERSON_DETECTED"))
                .andExpect(jsonPath("$[0].push").value(true));

        when(prefs.update(7L, AlertType.PERSON_DETECTED, true, false)).thenReturn(PERSON);
        mvc.perform(put("/api/notifications/preferences/person_detected").requestAttr("role", "ADMIN").requestAttr("userId", 7L)
                        .contentType(MediaType.APPLICATION_JSON).content("{\"inApp\":true,\"push\":false}"))
                .andExpect(status().isOk());
        verify(prefs).update(7L, AlertType.PERSON_DETECTED, true, false);

        mvc.perform(put("/api/notifications/preferences/NOPE").requestAttr("role", "USER").requestAttr("userId", 7L)
                        .contentType(MediaType.APPLICATION_JSON).content("{\"inApp\":true,\"push\":false}"))
                .andExpect(status().isBadRequest());
        mvc.perform(put("/api/notifications/preferences/ENERGY_DAILY").requestAttr("role", "USER").requestAttr("userId", 7L)
                        .contentType(MediaType.APPLICATION_JSON).content("{\"inApp\":true}"))
                .andExpect(status().isBadRequest());

        mvc.perform(post("/api/notifications/preferences/reset").requestAttr("role", "USER").requestAttr("userId", 7L))
                .andExpect(status().isOk());
        verify(prefs).reset(7L);
    }
}
