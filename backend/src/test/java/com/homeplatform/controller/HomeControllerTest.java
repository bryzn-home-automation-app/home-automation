package com.homeplatform.controller;

import com.homeplatform.dto.ThermostatResponse;
import com.homeplatform.homeassistant.HomeAssistantException;
import com.homeplatform.dto.ThermostatChangeResponse;
import com.homeplatform.homeassistant.HomeDeviceService;
import com.homeplatform.homeassistant.ThermostatChangeRecorder;
import com.homeplatform.model.User;
import com.homeplatform.repository.UserRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.util.List;
import java.util.Optional;

import static org.hamcrest.Matchers.not;
import static org.hamcrest.Matchers.containsString;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * RBAC and error mapping for /api/home/* and /api/admin/home/*. JwtAuthFilter is
 * bypassed; the "role" request attribute it would set is supplied directly.
 */
class HomeControllerTest {

    private static final String ID = "3f1c9a52-6a43-4f0e-9a8e-2d5c1f7b9e10";

    private HomeDeviceService service;
    private UserRepository users;
    private MockMvc mvc;

    @BeforeEach
    void setUp() {
        service = mock(HomeDeviceService.class);
        users = mock(UserRepository.class);
        mvc = MockMvcBuilders
                .standaloneSetup(new HomeController(service, users), new HomeAdminController(service))
                .setControllerAdvice(new HomeExceptionHandler())
                .build();
    }

    private static ThermostatResponse thermostat() {
        return new ThermostatResponse(ID, "Main Floor", true, 70.0, 40.0, 71.0, 71.0, null,
                "heat", "heating", "home", "°F", 45.0, 92.0, List.of("heat", "off"), List.of("home", "away"),
                "2026-10-19T12:00:00Z", null);
    }

    @Nested
    @DisplayName("GUEST")
    class Guest {

        @Test
        @DisplayName("can read thermostats")
        void canRead() throws Exception {
            when(service.listThermostats()).thenReturn(List.of(thermostat()));
            mvc.perform(get("/api/home/thermostats").requestAttr("role", "GUEST"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$[0].id").value(ID))
                    .andExpect(jsonPath("$[0].temperature").value(70.0));
        }

        @Test
        @DisplayName("cannot control thermostats")
        void cannotControl() throws Exception {
            mvc.perform(post("/api/home/thermostats/" + ID + "/mode").requestAttr("role", "GUEST")
                            .contentType(MediaType.APPLICATION_JSON).content("{\"mode\":\"cool\"}"))
                    .andExpect(status().isForbidden());
            mvc.perform(post("/api/home/thermostats/" + ID + "/temperature").requestAttr("role", "GUEST")
                            .contentType(MediaType.APPLICATION_JSON).content("{\"temperature\":72}"))
                    .andExpect(status().isForbidden());
            mvc.perform(post("/api/home/thermostats/" + ID + "/resume").requestAttr("role", "GUEST"))
                    .andExpect(status().isForbidden());
            verify(service, never()).setMode(anyString(), anyString(), any());
            verify(service, never()).setTemperature(anyString(), any(), any());
            verify(service, never()).resume(anyString(), any());
        }
    }

    @Test
    @DisplayName("missing role is rejected even for reads")
    void noRole() throws Exception {
        mvc.perform(get("/api/home/thermostats")).andExpect(status().isForbidden());
    }

    @Test
    @DisplayName("USER can control thermostats")
    void userAllowed() throws Exception {
        when(service.setMode(eq(ID), eq("cool"), any())).thenReturn(thermostat());
        mvc.perform(post("/api/home/thermostats/" + ID + "/mode").requestAttr("role", "USER")
                        .contentType(MediaType.APPLICATION_JSON).content("{\"mode\":\"cool\"}"))
                .andExpect(status().isOk());

    }

    @Test
    @DisplayName("commands are attributed to the caller's display name")
    void commandsCarryActor() throws Exception {
        User bryan = new User();
        bryan.setId(42L);
        bryan.setUsername("bryan");
        bryan.setDisplayName("Bryan");
        when(users.findById(42L)).thenReturn(Optional.of(bryan));
        when(service.setTemperature(eq(ID), any(), any())).thenReturn(thermostat());
        mvc.perform(post("/api/home/thermostats/" + ID + "/temperature").requestAttr("role", "USER")
                        .requestAttr("userId", 42L).requestAttr("username", "bryan")
                        .contentType(MediaType.APPLICATION_JSON).content("{\"temperature\":72}"))
                .andExpect(status().isOk());
        verify(service).setTemperature(eq(ID), any(), eq(new ThermostatChangeRecorder.Actor(42L, "Bryan")));
    }

    @Test
    @DisplayName("unknown user falls back to the JWT username")
    void actorFallsBackToUsername() throws Exception {
        when(users.findById(7L)).thenReturn(Optional.empty());
        when(service.resume(eq(ID), any())).thenReturn(thermostat());
        mvc.perform(post("/api/home/thermostats/" + ID + "/resume").requestAttr("role", "ADMIN")
                        .requestAttr("userId", 7L).requestAttr("username", "kim"))
                .andExpect(status().isOk());
        verify(service).resume(ID, new ThermostatChangeRecorder.Actor(7L, "kim"));
    }

    @Test
    @DisplayName("change history is readable by guests")
    void changesReadable() throws Exception {
        when(service.changes(ID, 5)).thenReturn(List.of(new ThermostatChangeResponse("2026-10-20T05:00:00Z",
                "ecobee", "ecobee", null, List.of("setpoint"), "cool", "temp", 73.0, null, 73.0)));
        mvc.perform(get("/api/home/thermostats/" + ID + "/changes").param("limit", "5").requestAttr("role", "GUEST"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].actor").value("ecobee"))
                .andExpect(jsonPath("$[0].fields[0]").value("setpoint"));
    }

    @Test
    @DisplayName("admin endpoints are ADMIN-only")
    void adminOnly() throws Exception {
        mvc.perform(get("/api/admin/home/devices").requestAttr("role", "USER")).andExpect(status().isForbidden());
        mvc.perform(post("/api/admin/home/discover").requestAttr("role", "USER")).andExpect(status().isForbidden());
        when(service.listDevices()).thenReturn(List.of());
        mvc.perform(get("/api/admin/home/devices").requestAttr("role", "ADMIN")).andExpect(status().isOk());
    }

    @Test
    @DisplayName("admin device update requires a boolean 'enabled'")
    void adminUpdateValidation() throws Exception {
        mvc.perform(put("/api/admin/home/devices/" + ID).requestAttr("role", "ADMIN")
                        .contentType(MediaType.APPLICATION_JSON).content("{\"enabled\":\"yes\"}"))
                .andExpect(status().isBadRequest());
    }

    @Nested
    @DisplayName("error mapping")
    class Errors {

        @Test
        @DisplayName("unknown device → 404")
        void notFound() throws Exception {
            when(service.getThermostat("nope")).thenThrow(new HomeDeviceService.NotFound());
            mvc.perform(get("/api/home/thermostats/nope").requestAttr("role", "USER"))
                    .andExpect(status().isNotFound());
        }

        @Test
        @DisplayName("validation failure → 400 with message")
        void badRequest() throws Exception {
            when(service.setTemperature(eq(ID), any(), any())).thenThrow(new IllegalArgumentException("Temperature must be between 45.0 and 92.0"));
            mvc.perform(post("/api/home/thermostats/" + ID + "/temperature").requestAttr("role", "USER")
                            .contentType(MediaType.APPLICATION_JSON).content("{\"temperature\":120}"))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.error").value("Temperature must be between 45.0 and 92.0"));
        }

        @Test
        @DisplayName("HA disabled/unreachable → 503")
        void unavailable() throws Exception {
            when(service.listThermostats()).thenThrow(new HomeAssistantException.Unavailable("Home Assistant is unreachable"));
            mvc.perform(get("/api/home/thermostats").requestAttr("role", "USER"))
                    .andExpect(status().isServiceUnavailable());
        }

        @Test
        @DisplayName("resume unsupported → 501; preset unsupported → 422")
        void unsupported() throws Exception {
            when(service.resume(eq(ID), any())).thenThrow(new HomeDeviceService.Unsupported("no resume", true));
            mvc.perform(post("/api/home/thermostats/" + ID + "/resume").requestAttr("role", "USER"))
                    .andExpect(status().isNotImplemented());
            when(service.hold(eq(ID), eq("vacation"), any())).thenThrow(new HomeDeviceService.Unsupported("no presets", false));
            mvc.perform(post("/api/home/thermostats/" + ID + "/hold").requestAttr("role", "USER")
                            .contentType(MediaType.APPLICATION_JSON).content("{\"preset\":\"vacation\"}"))
                    .andExpect(status().isUnprocessableEntity());
        }

        @Test
        @DisplayName("HA error details (incl. anything token-like) never reach the client")
        void noLeak() throws Exception {
            when(service.listThermostats()).thenThrow(new HomeAssistantException.Auth("Bearer super-secret-token rejected"));
            mvc.perform(get("/api/home/thermostats").requestAttr("role", "USER"))
                    .andExpect(status().isServiceUnavailable())
                    .andExpect(content().string(not(containsString("super-secret-token"))));
            when(service.getThermostat(ID)).thenThrow(new HomeAssistantException.Http(500, "HA said: super-secret-token"));
            mvc.perform(get("/api/home/thermostats/" + ID).requestAttr("role", "USER"))
                    .andExpect(status().isBadGateway())
                    .andExpect(content().string(not(containsString("super-secret-token"))));
        }

        @Test
        @DisplayName("malformed history timestamps → 400")
        void badHistoryRange() throws Exception {
            mvc.perform(get("/api/home/thermostats/" + ID + "/history").param("from", "yesterday")
                            .requestAttr("role", "GUEST"))
                    .andExpect(status().isBadRequest());
        }
    }
}
