package com.homeplatform.controller;

import com.homeplatform.service.WeatherAlertRule;
import com.homeplatform.service.WeatherAlertService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.web.servlet.request.MockMvcRequestBuilders;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.time.LocalTime;

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/** /api/weather-alerts: members only, validated. */
class WeatherAlertControllerTest {

    private WeatherAlertService service;
    private MockMvc mvc;

    @BeforeEach
    void setUp() {
        service = mock(WeatherAlertService.class);
        mvc = MockMvcBuilders.standaloneSetup(new WeatherAlertController(service)).build();
    }

    private static MockHttpServletRequestBuilder change(String type, String json) {
        return MockMvcRequestBuilders.put("/api/weather-alerts/" + type)
                .requestAttr("role", "USER").requestAttr("userId", 7L)
                .contentType(MediaType.APPLICATION_JSON).content(json);
    }

    @Test
    @DisplayName("guests and anonymous callers are refused")
    void guests() throws Exception {
        mvc.perform(get("/api/weather-alerts").requestAttr("role", "GUEST")).andExpect(status().isForbidden());
        mvc.perform(get("/api/weather-alerts")).andExpect(status().isForbidden());
        mvc.perform(MockMvcRequestBuilders.put("/api/weather-alerts/WEATHER_RAIN").requestAttr("role", "GUEST")
                .contentType(MediaType.APPLICATION_JSON).content("{\"inApp\":true}")).andExpect(status().isForbidden());
        verifyNoInteractions(service);
    }

    @Test
    @DisplayName("bad types, times and limits are refused; a good change is passed on parsed")
    void validation() throws Exception {
        mvc.perform(change("WEATHER_HAIL", "{\"inApp\":true}")).andExpect(status().isBadRequest());
        mvc.perform(change("WEATHER_RAIN", "{\"checkAt\":\"8pm\"}")).andExpect(status().isBadRequest());
        mvc.perform(change("WEATHER_RAIN", "{\"threshold\":55}")).andExpect(status().isBadRequest());
        mvc.perform(change("WEATHER_NWS", "{\"checkAt\":\"20:00\"}")).andExpect(status().isBadRequest());
        verifyNoInteractions(service);

        mvc.perform(change("WEATHER_RAIN", "{\"inApp\":true,\"push\":true,\"checkAt\":\"21:30\",\"until\":\"06:00\",\"threshold\":70}"))
                .andExpect(status().isOk());
        verify(service).update(eq(7L), eq(WeatherAlertRule.RAIN), eq(new WeatherAlertService.Change(
                true, true, LocalTime.of(21, 30), LocalTime.of(6, 0), 70)));
    }

    @Test
    @DisplayName("a preview the forecast can't answer is a 503, not a 500")
    void previewUnavailable() throws Exception {
        when(service.preview(any(), any(), any())).thenThrow(new IllegalStateException("timed out"));
        mvc.perform(get("/api/weather-alerts/WEATHER_RAIN/preview").requestAttr("role", "ADMIN").requestAttr("userId", 1L))
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.error").value("Couldn't reach the forecast. Try again in a minute."));
    }
}
