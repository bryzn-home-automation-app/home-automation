package com.homeplatform.controller;

import com.homeplatform.model.RoombaPosition;
import com.homeplatform.repository.RoombaCommandRepository;
import com.homeplatform.repository.RoombaCoverageRepository;
import com.homeplatform.repository.RoombaDeviceRepository;
import com.homeplatform.repository.RoombaMapRepository;
import com.homeplatform.repository.RoombaNativeScheduleRepository;
import com.homeplatform.repository.RoombaPartRepository;
import com.homeplatform.repository.RoombaPositionRepository;
import com.homeplatform.repository.RoombaRunRepository;
import com.homeplatform.repository.RoombaStatusRepository;
import com.homeplatform.service.RoombaService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import java.time.LocalDateTime;
import java.time.ZoneOffset;
import java.util.Optional;

import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/** The live dot's position and the "last seen" one: the same row, read two ways. */
class RoombaControllerTest {

    private RoombaPositionRepository positionRepo;
    private MockMvc mvc;

    @BeforeEach
    void setUp() {
        positionRepo = mock(RoombaPositionRepository.class);
        RoombaService service = new RoombaService(
                mock(RoombaStatusRepository.class), mock(RoombaRunRepository.class), mock(RoombaMapRepository.class),
                mock(RoombaCommandRepository.class), mock(RoombaDeviceRepository.class), positionRepo,
                mock(RoombaCoverageRepository.class), mock(RoombaNativeScheduleRepository.class),
                mock(RoombaPartRepository.class));
        mvc = MockMvcBuilders.standaloneSetup(new RoombaController(service)).build();
    }

    private void storedAt(LocalDateTime at) {
        when(positionRepo.findTopByOrderByUpdatedAtDesc()).thenReturn(Optional.of(RoombaPosition.builder()
                .robotId("BLID").x(-5.550261).y(4.627603).theta(-2.42268).updatedAt(at).build()));
    }

    @Test
    @DisplayName("an old position: no live dot (204), but the last one comes back with its time")
    void oldPosition() throws Exception {
        storedAt(LocalDateTime.of(2026, 11, 12, 17, 0, 34));
        mvc.perform(get("/api/roomba/position")).andExpect(status().isNoContent());
        mvc.perform(get("/api/roomba/position/last"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.x").value(-5.550261))
                .andExpect(jsonPath("$.y").value(4.627603))
                .andExpect(jsonPath("$.updatedAt").value("2026-11-12T17:00:34Z"));
    }

    @Test
    @DisplayName("a fresh position is both the live dot and the last one")
    void freshPosition() throws Exception {
        storedAt(LocalDateTime.now(ZoneOffset.UTC).minusSeconds(1));
        mvc.perform(get("/api/roomba/position")).andExpect(status().isOk()).andExpect(jsonPath("$.robotId").value("BLID"));
        mvc.perform(get("/api/roomba/position/last")).andExpect(status().isOk()).andExpect(jsonPath("$.robotId").value("BLID"));
    }

    @Test
    @DisplayName("never reported a position: 204 from both")
    void none() throws Exception {
        when(positionRepo.findTopByOrderByUpdatedAtDesc()).thenReturn(Optional.empty());
        mvc.perform(get("/api/roomba/position")).andExpect(status().isNoContent());
        mvc.perform(get("/api/roomba/position/last")).andExpect(status().isNoContent());
    }
}
