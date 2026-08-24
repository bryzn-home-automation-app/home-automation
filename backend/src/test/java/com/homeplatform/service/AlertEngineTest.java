package com.homeplatform.service;

import com.homeplatform.dto.RoombaRunResponse;
import com.homeplatform.dto.RoombaStatusResponse;
import com.homeplatform.model.Notification.Category;
import com.homeplatform.model.Notification.Severity;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class AlertEngineTest {

    private AlertEngine alertEngine;
    private NotificationService notificationService;

    @BeforeEach
    void setUp() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class, RETURNS_DEFAULTS);
        notificationService = mock(NotificationService.class);
        var userRepo = mock(com.homeplatform.repository.UserRepository.class);
        var appEventService = mock(AppEventService.class);
        var roombaService = mock(RoombaService.class);
        alertEngine = new AlertEngine(jdbc, notificationService, userRepo, appEventService, roombaService);
    }

    private Map<String, Object> m(Object... kv) {
        Map<String, Object> map = new HashMap<>();
        for (int i = 0; i < kv.length; i += 2) map.put((String) kv[i], kv[i + 1]);
        return map;
    }

    @Nested
    @DisplayName("generateElectricAlerts")
    class Alerts {

        @Test
        @DisplayName("skips when no meter exists")
        void skipsWhenNoMeter() {
            // no meter, no data -> no notifications
            alertEngine.generateElectricAlerts(1L);
            verify(notificationService, never()).create(anyLong(), any(), any(), any(), anyString());
        }

        @Test
        @DisplayName("skips when no hourly data (0 readings)")
        void skipsWhenNoData() {
            // Subclass override: mock data layer entirely
            var engine = new AlertEngine(null, notificationService, null, null, null) {
                @Override
                Long findElectricMeter(Long uid) { return 1L; }
                DailyMetrics queryDay(Long mid, String date) {
                    return new DailyMetrics(0, 0, 0, BigDecimal.ZERO);
                }
            };
            engine.generateElectricAlerts(1L);
            verify(notificationService, never()).create(anyLong(), any(), any(), any(), anyString());
        }

        @Test
        @DisplayName("generates daily report when data exists")
        void generatesDailyReport() {
            var engine = new AlertEngine(null, notificationService, null, null, null) {
                @Override Long findElectricMeter(Long uid) { return 1L; }
                DailyMetrics queryDay(Long mid, String date) {
                    return new DailyMetrics(35.0, 24, 15, BigDecimal.valueOf(3.5));
                }
                double queryAvgLastNDays(Long mid, String date, int days) { return 30.0; }
                boolean isNew(Long uid, String prefix) { return true; }
            };
            engine.generateElectricAlerts(1L);
            verify(notificationService).create(eq(1L), eq(Category.ELECTRICAL),
                    eq(Severity.INFO), contains("Daily usage report"), anyString());
        }

        @Test
        @DisplayName("generates spike warning when usage > 30% above 7-day avg")
        void generatesSpikeWarning() {
            var engine = new AlertEngine(null, notificationService, null, null, null) {
                @Override Long findElectricMeter(Long uid) { return 1L; }
                DailyMetrics queryDay(Long mid, String date) {
                    return new DailyMetrics(50.0, 24, 14, BigDecimal.valueOf(4.0));
                }
                double queryAvgLastNDays(Long mid, String date, int days) { return 30.0; }
                boolean isNew(Long uid, String prefix) { return true; }
            };
            engine.generateElectricAlerts(1L);
            verify(notificationService).create(eq(1L), eq(Category.ELECTRICAL),
                    eq(Severity.WARNING), contains("Usage spike"), anyString());
        }

        @Test
        @DisplayName("no spike when usage below 30% threshold")
        void noSpike() {
            var engine = new AlertEngine(null, notificationService, null, null, null) {
                @Override Long findElectricMeter(Long uid) { return 1L; }
                DailyMetrics queryDay(Long mid, String date) {
                    return new DailyMetrics(35.0, 24, 14, BigDecimal.valueOf(3.0));
                }
                double queryAvgLastNDays(Long mid, String date, int days) { return 30.0; }
                boolean isNew(Long uid, String prefix) { return true; }
            };
            engine.generateElectricAlerts(1L);
            verify(notificationService).create(eq(1L), eq(Category.ELECTRICAL),
                    eq(Severity.INFO), contains("Daily usage report"), anyString());
            verify(notificationService, never()).create(eq(1L), eq(Category.ELECTRICAL),
                    eq(Severity.WARNING), contains("Usage spike"), anyString());
        }

        @Test
        @DisplayName("generates peak hour warning when max >= 5 kWh")
        void peakWarning() {
            var engine = new AlertEngine(null, notificationService, null, null, null) {
                @Override Long findElectricMeter(Long uid) { return 1L; }
                DailyMetrics queryDay(Long mid, String date) {
                    return new DailyMetrics(40.0, 24, 17, BigDecimal.valueOf(5.2));
                }
                double queryAvgLastNDays(Long mid, String date, int days) { return 30.0; }
                boolean isNew(Long uid, String prefix) { return true; }
            };
            engine.generateElectricAlerts(1L);
            verify(notificationService).create(eq(1L), eq(Category.ELECTRICAL),
                    eq(Severity.WARNING), contains("Peak usage hour"), anyString());
        }

        @Test
        @DisplayName("no peak warning when max < 5 kWh")
        void noPeakWarning() {
            var engine = new AlertEngine(null, notificationService, null, null, null) {
                @Override Long findElectricMeter(Long uid) { return 1L; }
                DailyMetrics queryDay(Long mid, String date) {
                    return new DailyMetrics(40.0, 24, 17, BigDecimal.valueOf(4.9));
                }
                double queryAvgLastNDays(Long mid, String date, int days) { return 30.0; }
                boolean isNew(Long uid, String prefix) { return true; }
            };
            engine.generateElectricAlerts(1L);
            verify(notificationService, never()).create(eq(1L), eq(Category.ELECTRICAL),
                    eq(Severity.WARNING), contains("Peak usage hour"), anyString());
        }

        @Test
        @DisplayName("dedup prevents duplicate alerts")
        void dedup() {
            var engine = new AlertEngine(null, notificationService, null, null, null) {
                @Override Long findElectricMeter(Long uid) { return 1L; }
                DailyMetrics queryDay(Long mid, String date) {
                    return new DailyMetrics(35.0, 24, 15, BigDecimal.valueOf(3.0));
                }
                double queryAvgLastNDays(Long mid, String date, int days) { return 30.0; }
                boolean isNew(Long uid, String prefix) { return false; }  // already exists
            };
            engine.generateElectricAlerts(1L);
            verify(notificationService, never()).create(anyLong(), any(), any(), any(), anyString());
        }
    }

    // ──────────────────────────────────────────
    // Roomba alerts
    // ──────────────────────────────────────────

    /** Build a status snapshot; only the fields the alerts read are meaningful. */
    private RoombaStatusResponse status(Integer batteryPct, String phase, Integer error,
                                        String errorText, boolean needsAttention,
                                        List<String> attentionReasons) {
        return new RoombaStatusResponse(
                "robot-1", "Roomba", batteryPct, phase, null, error, errorText,
                false, true, true, null, null, null, null, null, null, null, null,
                null, null, null, null, null, null, null, null, null,
                true, needsAttention, attentionReasons, Instant.now().toString());
    }

    /** Build a completed run; only completedAt/error/area/duration/missionNumber matter. */
    private RoombaRunResponse run(String completedAt, Integer error, Integer squareFeet,
                                  Integer durationMinutes, Integer missionNumber) {
        return new RoombaRunResponse(
                7L, Instant.now().toString(), completedAt, durationMinutes, squareFeet,
                "COMPLETED", "m-1", missionNumber, error, null, "manual", "clean", "roomba");
    }

    /** An AlertEngine wired to supply a fixed run + status, with dedup always fresh. */
    private AlertEngine roombaEngine(RoombaRunResponse run, RoombaStatusResponse status) {
        return new AlertEngine(null, notificationService, null, null, null) {
            @Override RoombaRunResponse latestRoombaRun() { return run; }
            @Override RoombaStatusResponse roombaStatus() { return status; }
            @Override boolean isNewRoomba(Long uid, String title, boolean todayOnly) { return true; }
        };
    }

    @Nested
    @DisplayName("generateRoombaAlerts")
    class RoombaAlerts {

        @Test
        @DisplayName("no status and no run -> nothing created")
        void noData() {
            roombaEngine(null, null).generateRoombaAlerts(1L);
            verify(notificationService, never()).create(anyLong(), any(), any(), any(), any());
        }

        @Test
        @DisplayName("cleaning complete -> SUCCESS with area + duration")
        void cleaningComplete() {
            var engine = roombaEngine(run(Instant.now().toString(), 0, 250, 42, 5), null);
            engine.generateRoombaAlerts(1L);
            verify(notificationService).create(eq(1L), eq(Category.ROOMBA),
                    eq(Severity.SUCCESS), contains("Cleaning complete"), contains("250 sq ft"));
        }

        @Test
        @DisplayName("errored run does not produce a completion alert")
        void erroredRunNoCompletion() {
            var engine = roombaEngine(run(Instant.now().toString(), 6, 100, 10, 5), null);
            engine.generateRoombaAlerts(1L);
            verify(notificationService, never()).create(anyLong(), eq(Category.ROOMBA),
                    eq(Severity.SUCCESS), anyString(), any());
        }

        @Test
        @DisplayName("stale completed run (>24h) does not alert")
        void staleRunNoAlert() {
            String old = Instant.now().minusSeconds(60 * 60 * 48).toString();
            var engine = roombaEngine(run(old, 0, 100, 10, 5), null);
            engine.generateRoombaAlerts(1L);
            verify(notificationService, never()).create(anyLong(), any(), any(), any(), any());
        }

        @Test
        @DisplayName("still-running run (no completedAt) does not alert")
        void runningNoAlert() {
            var engine = roombaEngine(run(null, 0, 100, 10, 5), null);
            engine.generateRoombaAlerts(1L);
            verify(notificationService, never()).create(anyLong(), any(), any(), any(), any());
        }

        @Test
        @DisplayName("active error code -> CRITICAL error alert with decoded text")
        void errorAlert() {
            var engine = roombaEngine(null,
                    status(80, "stop", 6, "Roomba is stuck", true, List.of("Roomba is stuck")));
            engine.generateRoombaAlerts(1L);
            verify(notificationService).create(eq(1L), eq(Category.ROOMBA),
                    eq(Severity.CRITICAL), contains("Roomba error"), contains("stuck"));
        }

        @Test
        @DisplayName("needs attention (no error) -> WARNING with reasons")
        void needsAttentionAlert() {
            var engine = roombaEngine(null,
                    status(80, "stop", 0, null, true, List.of("Bin removed", "Water tank removed")));
            engine.generateRoombaAlerts(1L);
            verify(notificationService).create(eq(1L), eq(Category.ROOMBA),
                    eq(Severity.WARNING), contains("needs attention"), contains("Bin removed"));
        }

        @Test
        @DisplayName("error takes precedence over the generic needs-attention warning")
        void errorPrecedence() {
            var engine = roombaEngine(null,
                    status(80, "stop", 6, "Cliff detected", true, List.of("Cliff detected")));
            engine.generateRoombaAlerts(1L);
            verify(notificationService).create(eq(1L), eq(Category.ROOMBA),
                    eq(Severity.CRITICAL), anyString(), any());
            verify(notificationService, never()).create(anyLong(), eq(Category.ROOMBA),
                    eq(Severity.WARNING), contains("needs attention"), any());
        }

        @Test
        @DisplayName("low battery while not charging -> WARNING")
        void lowBatteryAlert() {
            var engine = roombaEngine(null, status(10, "stop", 0, null, false, List.of()));
            engine.generateRoombaAlerts(1L);
            verify(notificationService).create(eq(1L), eq(Category.ROOMBA),
                    eq(Severity.WARNING), contains("battery low"), contains("10%"));
        }

        @Test
        @DisplayName("low battery while charging -> no alert")
        void lowBatteryChargingNoAlert() {
            var engine = roombaEngine(null, status(10, "charge", 0, null, false, List.of()));
            engine.generateRoombaAlerts(1L);
            verify(notificationService, never()).create(anyLong(), eq(Category.ROOMBA),
                    eq(Severity.WARNING), contains("battery low"), any());
        }

        @Test
        @DisplayName("healthy status -> no alerts")
        void healthyNoAlert() {
            var engine = roombaEngine(null, status(90, "charge", 0, null, false, List.of()));
            engine.generateRoombaAlerts(1L);
            verify(notificationService, never()).create(anyLong(), any(), any(), any(), any());
        }

        @Test
        @DisplayName("dedup suppresses a repeat alert")
        void dedup() {
            var engine = new AlertEngine(null, notificationService, null, null, null) {
                @Override RoombaRunResponse latestRoombaRun() { return null; }
                @Override RoombaStatusResponse roombaStatus() {
                    return status(10, "stop", 0, null, false, List.of());
                }
                @Override boolean isNewRoomba(Long uid, String title, boolean todayOnly) { return false; }
            };
            engine.generateRoombaAlerts(1L);
            verify(notificationService, never()).create(anyLong(), any(), any(), any(), any());
        }
    }
}
