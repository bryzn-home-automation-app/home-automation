package com.homeplatform.service;

import com.homeplatform.dto.RoombaMapResponse;
import com.homeplatform.dto.RoombaRunResponse;
import com.homeplatform.dto.RoombaStatusResponse;
import com.homeplatform.model.RoombaMap;
import com.homeplatform.model.RoombaRun;
import com.homeplatform.model.RoombaStatus;
import com.homeplatform.repository.RoombaMapRepository;
import com.homeplatform.repository.RoombaRunRepository;
import com.homeplatform.repository.RoombaStatusRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.data.domain.Pageable;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

class RoombaServiceTest {

    private RoombaStatusRepository statusRepo;
    private RoombaRunRepository runRepo;
    private RoombaMapRepository mapRepo;
    private RoombaService service;

    @BeforeEach
    void setUp() {
        statusRepo = mock(RoombaStatusRepository.class);
        runRepo = mock(RoombaRunRepository.class);
        mapRepo = mock(RoombaMapRepository.class);
        service = new RoombaService(statusRepo, runRepo, mapRepo);
    }

    @Nested
    @DisplayName("getStatus")
    class GetStatus {

        @Test
        @DisplayName("empty when no snapshot exists")
        void emptyWhenNone() {
            when(statusRepo.findTopByOrderByUpdatedAtDesc()).thenReturn(Optional.empty());
            assertTrue(service.getStatus().isEmpty());
        }

        @Test
        @DisplayName("running=true for a running phase, online=true when fresh")
        void runningAndOnline() {
            RoombaStatus s = RoombaStatus.builder()
                    .robotId("robot-1")
                    .phase("run")
                    .batteryPct(97)
                    .updatedAt(LocalDateTime.now().minusMinutes(2))
                    .build();
            when(statusRepo.findTopByOrderByUpdatedAtDesc()).thenReturn(Optional.of(s));

            RoombaStatusResponse r = service.getStatus().orElseThrow();
            assertTrue(r.running());
            assertTrue(r.online());
            assertEquals(97, r.batteryPct());
        }

        @Test
        @DisplayName("running=false when charging, online=false when stale")
        void chargingAndStale() {
            RoombaStatus s = RoombaStatus.builder()
                    .robotId("robot-1")
                    .phase("charge")
                    .updatedAt(LocalDateTime.now().minusMinutes(30))
                    .build();
            when(statusRepo.findTopByOrderByUpdatedAtDesc()).thenReturn(Optional.of(s));

            RoombaStatusResponse r = service.getStatus().orElseThrow();
            assertFalse(r.running());
            assertFalse(r.online());
        }
    }

    @Nested
    @DisplayName("getRuns")
    class GetRuns {

        @Test
        @DisplayName("maps rows newest-first with null missionId")
        void mapsRuns() {
            RoombaRun run = RoombaRun.builder()
                    .id(5L)
                    .startedAt(LocalDateTime.of(2026, 8, 19, 10, 0))
                    .completedAt(LocalDateTime.of(2026, 8, 19, 10, 45))
                    .durationMinutes(45)
                    .squareFeet(111)
                    .status("COMPLETED")
                    .build();
            when(runRepo.findAllByOrderByStartedAtDesc(any(Pageable.class)))
                    .thenReturn(List.of(run));

            List<RoombaRunResponse> out = service.getRuns(50);
            assertEquals(1, out.size());
            assertEquals(5L, out.get(0).id());
            assertEquals(111, out.get(0).squareFeet());
            assertNull(out.get(0).missionId());
        }
    }

    @Nested
    @DisplayName("getMap")
    class GetMap {

        @Test
        @DisplayName("passes geojson through as a parsed JSON object")
        void geojsonPassthrough() {
            RoombaMap m = RoombaMap.builder()
                    .robotId("robot-1")
                    .mapId("map-1")
                    .mapVersion("260820T")
                    .name("Map 1")
                    .geojson("{\"rooms\":{\"type\":\"FeatureCollection\",\"features\":[]}}")
                    .updatedAt(LocalDateTime.now())
                    .build();
            when(mapRepo.findTopByOrderByUpdatedAtDesc()).thenReturn(Optional.of(m));

            RoombaMapResponse r = service.getMap().orElseThrow();
            assertNotNull(r.geojson());
            assertTrue(r.geojson().has("rooms"));
            assertEquals("FeatureCollection", r.geojson().get("rooms").get("type").asText());
        }

        @Test
        @DisplayName("empty when no map exists")
        void emptyWhenNone() {
            when(mapRepo.findTopByOrderByUpdatedAtDesc()).thenReturn(Optional.empty());
            assertTrue(service.getMap().isEmpty());
        }
    }
}
