package com.homeplatform.service;

import com.homeplatform.dto.RoombaCommandResponse;
import com.homeplatform.dto.RoombaMapResponse;
import com.homeplatform.dto.RoombaPositionResponse;
import com.homeplatform.dto.RoombaRunResponse;
import com.homeplatform.dto.RoombaStatusResponse;
import com.homeplatform.model.RoombaCommand;
import com.homeplatform.model.RoombaMap;
import com.homeplatform.model.RoombaPosition;
import com.homeplatform.model.RoombaRun;
import com.homeplatform.model.RoombaStatus;
import com.homeplatform.repository.RoombaCommandRepository;
import com.homeplatform.repository.RoombaDeviceRepository;
import com.homeplatform.repository.RoombaMapRepository;
import com.homeplatform.repository.RoombaPositionRepository;
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
    private RoombaCommandRepository commandRepo;
    private RoombaDeviceRepository deviceRepo;
    private RoombaPositionRepository positionRepo;
    private RoombaService service;

    @BeforeEach
    void setUp() {
        statusRepo = mock(RoombaStatusRepository.class);
        runRepo = mock(RoombaRunRepository.class);
        mapRepo = mock(RoombaMapRepository.class);
        commandRepo = mock(RoombaCommandRepository.class);
        deviceRepo = mock(RoombaDeviceRepository.class);
        positionRepo = mock(RoombaPositionRepository.class);
        service = new RoombaService(
                statusRepo, runRepo, mapRepo, commandRepo, deviceRepo, positionRepo);
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
                    .updatedAt(LocalDateTime.now(java.time.ZoneOffset.UTC).minusMinutes(2))
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
                    .updatedAt(LocalDateTime.now(java.time.ZoneOffset.UTC).minusMinutes(30))
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
                    .updatedAt(LocalDateTime.now(java.time.ZoneOffset.UTC))
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

    @Nested
    @DisplayName("enqueueRenameRoom")
    class EnqueueRenameRoom {

        @BeforeEach
        void echoSave() {
            when(commandRepo.save(any(RoombaCommand.class)))
                    .thenAnswer(inv -> inv.getArgument(0));
        }

        @Test
        @DisplayName("encodes a name-only rename as JSON arg")
        void nameOnly() {
            RoombaCommandResponse r =
                    service.enqueueRenameRoom("15", "Living Room", null, "user:1");
            assertEquals("rename_room", r.command());
            assertTrue(r.arg().contains("\"room_id\":\"15\""));
            assertTrue(r.arg().contains("\"name\":\"Living Room\""));
            assertFalse(r.arg().contains("\"type\""));
            assertEquals("PENDING", r.status());
        }

        @Test
        @DisplayName("includes the room type (lowercased) when provided")
        void withType() {
            RoombaCommandResponse r =
                    service.enqueueRenameRoom("15", "Den", "Living_Room", null);
            assertTrue(r.arg().contains("\"type\":\"living_room\""));
        }

        @Test
        @DisplayName("type-only change (no name) is allowed")
        void typeOnly() {
            RoombaCommandResponse r =
                    service.enqueueRenameRoom("15", "  ", "kitchen", null);
            assertTrue(r.arg().contains("\"type\":\"kitchen\""));
            assertFalse(r.arg().contains("\"name\""));
        }

        @Test
        @DisplayName("rejects a blank roomId")
        void blankRoomId() {
            assertThrows(IllegalArgumentException.class,
                    () -> service.enqueueRenameRoom("  ", "Kitchen", null, null));
        }

        @Test
        @DisplayName("rejects when neither name nor type is provided")
        void nothingToChange() {
            assertThrows(IllegalArgumentException.class,
                    () -> service.enqueueRenameRoom("15", "  ", "", null));
        }

        @Test
        @DisplayName("rejects an unknown room type")
        void unknownType() {
            assertThrows(IllegalArgumentException.class,
                    () -> service.enqueueRenameRoom("15", "Garage", "garage", null));
        }

        @Test
        @DisplayName("rejects an over-long name")
        void nameTooLong() {
            String longName = "x".repeat(81);
            assertThrows(IllegalArgumentException.class,
                    () -> service.enqueueRenameRoom("15", longName, null, null));
        }
    }

    @Nested
    @DisplayName("enqueueSplitRoom")
    class EnqueueSplitRoom {

        @BeforeEach
        void echoSave() {
            when(commandRepo.save(any(RoombaCommand.class)))
                    .thenAnswer(inv -> inv.getArgument(0));
        }

        @Test
        @DisplayName("encodes room_id + rounded points as JSON arg")
        void encodesPoints() {
            RoombaCommandResponse r = service.enqueueSplitRoom(
                    "12", List.of(List.of(1.23456, -2.0), List.of(3.5, 4.0)), "user:1");
            assertEquals("split_room", r.command());
            assertTrue(r.arg().contains("\"room_id\":\"12\""));
            // rounded to 3 decimals
            assertTrue(r.arg().contains("1.235"), r.arg());
            assertTrue(r.arg().contains("[[1.235,-2.0],[3.5,4.0]]"), r.arg());
            assertEquals("PENDING", r.status());
        }

        @Test
        @DisplayName("rejects a blank roomId")
        void blankRoomId() {
            assertThrows(IllegalArgumentException.class,
                    () -> service.enqueueSplitRoom("  ", List.of(List.of(1.0, 2.0), List.of(3.0, 4.0)), null));
        }

        @Test
        @DisplayName("rejects fewer than two points")
        void tooFewPoints() {
            assertThrows(IllegalArgumentException.class,
                    () -> service.enqueueSplitRoom("12", List.of(List.of(1.0, 2.0)), null));
        }

        @Test
        @DisplayName("rejects a malformed point")
        void malformedPoint() {
            assertThrows(IllegalArgumentException.class,
                    () -> service.enqueueSplitRoom("12", List.of(List.of(1.0), List.of(3.0, 4.0)), null));
        }
    }

    @Nested
    @DisplayName("enqueueMergeRooms")
    class EnqueueMergeRooms {

        @BeforeEach
        void echoSave() {
            when(commandRepo.save(any(RoombaCommand.class)))
                    .thenAnswer(inv -> inv.getArgument(0));
        }

        @Test
        @DisplayName("encodes distinct room_ids as JSON arg")
        void encodesIds() {
            RoombaCommandResponse r = service.enqueueMergeRooms(List.of("12", "15"), "user:1");
            assertEquals("merge_rooms", r.command());
            assertTrue(r.arg().contains("\"room_ids\":[\"12\",\"15\"]"), r.arg());
            assertEquals("PENDING", r.status());
        }

        @Test
        @DisplayName("drops blanks/dupes and rejects fewer than two distinct ids")
        void dedupeAndReject() {
            assertThrows(IllegalArgumentException.class,
                    () -> service.enqueueMergeRooms(List.of("12", "12", "  "), null));
        }

        @Test
        @DisplayName("rejects null / single-id lists")
        void tooFew() {
            assertThrows(IllegalArgumentException.class,
                    () -> service.enqueueMergeRooms(null, null));
            assertThrows(IllegalArgumentException.class,
                    () -> service.enqueueMergeRooms(List.of("12"), null));
        }
    }

    @Nested
    @DisplayName("enqueueCleanRoom")
    class EnqueueCleanRoom {

        @BeforeEach
        void echoSave() {
            when(commandRepo.save(any(RoombaCommand.class)))
                    .thenAnswer(inv -> inv.getArgument(0));
        }

        @Test
        @DisplayName("room-only clean encodes just the room_id")
        void roomOnly() {
            RoombaCommandResponse r = service.enqueueCleanRoom("12", null, null, null, "user:1");
            assertEquals("clean_room", r.command());
            assertEquals("{\"room_id\":\"12\"}", r.arg());
        }

        @Test
        @DisplayName("maps suction, passes, and operating mode to wire values")
        void allConfig() {
            RoombaCommandResponse r = service.enqueueCleanRoom("12", "High", "two", "vacmop", null);
            assertTrue(r.arg().contains("\"suction\":3"), r.arg());
            assertTrue(r.arg().contains("\"passes\":\"two\""), r.arg());
            assertTrue(r.arg().contains("\"mode\":6"), r.arg()); // vac+mop = 6
        }

        @Test
        @DisplayName("maps vacuum/mop modes to 2 and 4")
        void modes() {
            assertTrue(service.enqueueCleanRoom("12", null, null, "vacuum", null).arg().contains("\"mode\":2"));
            assertTrue(service.enqueueCleanRoom("12", null, null, "mop", null).arg().contains("\"mode\":4"));
        }

        @Test
        @DisplayName("rejects a blank roomId")
        void blankRoom() {
            assertThrows(IllegalArgumentException.class,
                    () -> service.enqueueCleanRoom("  ", null, null, null, null));
        }

        @Test
        @DisplayName("rejects an unknown suction, passes, or mode value")
        void badConfig() {
            assertThrows(IllegalArgumentException.class,
                    () -> service.enqueueCleanRoom("12", "ludicrous", null, null, null));
            assertThrows(IllegalArgumentException.class,
                    () -> service.enqueueCleanRoom("12", null, "three", null, null));
            assertThrows(IllegalArgumentException.class,
                    () -> service.enqueueCleanRoom("12", null, null, "steam", null));
        }
    }

    @Nested
    @DisplayName("getPosition")
    class GetPosition {

        @Test
        @DisplayName("returns a fresh position with x/y/theta")
        void freshPosition() {
            RoombaPosition p = RoombaPosition.builder()
                    .robotId("robot-1")
                    .x(1.25)
                    .y(-3.5)
                    .theta(1.57)
                    .updatedAt(LocalDateTime.now(java.time.ZoneOffset.UTC).minusSeconds(2))
                    .build();
            when(positionRepo.findTopByOrderByUpdatedAtDesc()).thenReturn(Optional.of(p));

            RoombaPositionResponse r = service.getPosition().orElseThrow();
            assertEquals("robot-1", r.robotId());
            assertEquals(1.25, r.x());
            assertEquals(-3.5, r.y());
            assertEquals(1.57, r.theta());
        }

        @Test
        @DisplayName("empty when the position is stale (older than the freshness window)")
        void staleIsEmpty() {
            RoombaPosition p = RoombaPosition.builder()
                    .robotId("robot-1")
                    .x(1.0)
                    .y(2.0)
                    .theta(0.0)
                    .updatedAt(LocalDateTime.now(java.time.ZoneOffset.UTC).minusMinutes(2))
                    .build();
            when(positionRepo.findTopByOrderByUpdatedAtDesc()).thenReturn(Optional.of(p));

            assertTrue(service.getPosition().isEmpty());
        }

        @Test
        @DisplayName("empty when no position row exists")
        void emptyWhenNone() {
            when(positionRepo.findTopByOrderByUpdatedAtDesc()).thenReturn(Optional.empty());
            assertTrue(service.getPosition().isEmpty());
        }
    }
}
