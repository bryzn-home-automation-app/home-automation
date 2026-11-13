package com.homeplatform.service;

import com.homeplatform.dto.RoombaDockIssue;
import com.homeplatform.dto.RoombaNativeScheduleResponse;
import com.homeplatform.dto.RoombaRunResponse;
import com.homeplatform.dto.RoombaStatusResponse;
import com.homeplatform.model.AlertType;
import com.homeplatform.model.Notification.Category;
import com.homeplatform.model.Notification.Severity;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

import java.math.BigDecimal;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.util.ArrayList;
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
            verify(notificationService, never()).send(anyLong(), any(), any(), any(), anyString());
        }

        @Test
        @DisplayName("skips when no hourly data (0 readings)")
        void skipsWhenNoData() {
            // Subclass override: mock data layer entirely
            var engine = new AlertEngine(null, notificationService, null, null, null) {
                @Override
                Long findElectricMeter(Long uid) { return 1L; }
                DailyMetrics queryDay(Long mid, String date) {
                    return new DailyMetrics(0, 0, 0, 0, BigDecimal.ZERO);
                }
            };
            engine.generateElectricAlerts(1L);
            verify(notificationService, never()).send(anyLong(), any(), any(), any(), anyString());
        }

        @Test
        @DisplayName("generates daily report when data exists")
        void generatesDailyReport() {
            var engine = new AlertEngine(null, notificationService, null, null, null) {
                @Override Long findElectricMeter(Long uid) { return 1L; }
                DailyMetrics queryDay(Long mid, String date) {
                    return new DailyMetrics(35.0, 24, 24, 15, BigDecimal.valueOf(3.5));
                }
                double queryAvgLastNDays(Long mid, String date, int days) { return 30.0; }
                boolean isNew(Long uid, String prefix) { return true; }
            };
            engine.generateElectricAlerts(1L);
            verify(notificationService).send(eq(1L), eq(AlertType.ENERGY_DAILY),
                    eq(Severity.INFO), contains("Daily usage report"), anyString());
        }

        @Test
        @DisplayName("a day CoServ is still posting gets no report until it's complete (or evening)")
        void partialDayWaits() {
            for (int hour : new int[]{10, 21}) {
                var notifications = mock(NotificationService.class);
                var engine = new AlertEngine(null, notifications, null, null, null) {
                    @Override Long findElectricMeter(Long uid) { return 1L; }
                    DailyMetrics queryDay(Long mid, String date) {
                        return new DailyMetrics(23.6, 20, 20, 15, BigDecimal.valueOf(3.5)); // 10/31: 20 of 24 hours in
                    }
                    double queryAvgLastNDays(Long mid, String date, int days) { return 25.0; }
                    boolean isNew(Long uid, String prefix) { return true; }
                    @Override java.time.LocalTime nowCentral() { return java.time.LocalTime.of(hour, 0); }
                };
                engine.generateElectricAlerts(1L);
                if (hour < 20) {
                    verify(notifications, never()).send(anyLong(), any(), any(), any(), anyString());
                } else {
                    verify(notifications).send(eq(1L), eq(AlertType.ENERGY_DAILY), eq(Severity.INFO),
                            contains("Daily usage report"), anyString());
                }
            }
        }

        @Test
        @DisplayName("generates spike warning when usage > 30% above 7-day avg")
        void generatesSpikeWarning() {
            var engine = new AlertEngine(null, notificationService, null, null, null) {
                @Override Long findElectricMeter(Long uid) { return 1L; }
                DailyMetrics queryDay(Long mid, String date) {
                    return new DailyMetrics(50.0, 24, 24, 14, BigDecimal.valueOf(4.0));
                }
                double queryAvgLastNDays(Long mid, String date, int days) { return 30.0; }
                boolean isNew(Long uid, String prefix) { return true; }
            };
            engine.generateElectricAlerts(1L);
            verify(notificationService).send(eq(1L), eq(AlertType.ENERGY_SPIKE),
                    eq(Severity.WARNING), contains("Usage spike"), anyString());
        }

        @Test
        @DisplayName("no spike when usage below 30% threshold")
        void noSpike() {
            var engine = new AlertEngine(null, notificationService, null, null, null) {
                @Override Long findElectricMeter(Long uid) { return 1L; }
                DailyMetrics queryDay(Long mid, String date) {
                    return new DailyMetrics(35.0, 24, 24, 14, BigDecimal.valueOf(3.0));
                }
                double queryAvgLastNDays(Long mid, String date, int days) { return 30.0; }
                boolean isNew(Long uid, String prefix) { return true; }
            };
            engine.generateElectricAlerts(1L);
            verify(notificationService).send(eq(1L), eq(AlertType.ENERGY_DAILY),
                    eq(Severity.INFO), contains("Daily usage report"), anyString());
            verify(notificationService, never()).send(eq(1L), eq(AlertType.ENERGY_SPIKE),
                    eq(Severity.WARNING), contains("Usage spike"), anyString());
        }

        @Test
        @DisplayName("generates peak hour warning when max >= 5 kWh")
        void peakWarning() {
            var engine = new AlertEngine(null, notificationService, null, null, null) {
                @Override Long findElectricMeter(Long uid) { return 1L; }
                DailyMetrics queryDay(Long mid, String date) {
                    return new DailyMetrics(40.0, 24, 24, 17, BigDecimal.valueOf(5.2));
                }
                double queryAvgLastNDays(Long mid, String date, int days) { return 30.0; }
                boolean isNew(Long uid, String prefix) { return true; }
            };
            engine.generateElectricAlerts(1L);
            verify(notificationService).send(eq(1L), eq(AlertType.ENERGY_SPIKE),
                    eq(Severity.WARNING), contains("Peak usage hour"), anyString());
        }

        @Test
        @DisplayName("no peak warning when max < 5 kWh")
        void noPeakWarning() {
            var engine = new AlertEngine(null, notificationService, null, null, null) {
                @Override Long findElectricMeter(Long uid) { return 1L; }
                DailyMetrics queryDay(Long mid, String date) {
                    return new DailyMetrics(40.0, 24, 24, 17, BigDecimal.valueOf(4.9));
                }
                double queryAvgLastNDays(Long mid, String date, int days) { return 30.0; }
                boolean isNew(Long uid, String prefix) { return true; }
            };
            engine.generateElectricAlerts(1L);
            verify(notificationService, never()).send(eq(1L), eq(AlertType.ENERGY_SPIKE),
                    eq(Severity.WARNING), contains("Peak usage hour"), anyString());
        }

        @Test
        @DisplayName("dedup prevents duplicate alerts")
        void dedup() {
            var engine = new AlertEngine(null, notificationService, null, null, null) {
                @Override Long findElectricMeter(Long uid) { return 1L; }
                DailyMetrics queryDay(Long mid, String date) {
                    return new DailyMetrics(35.0, 24, 24, 15, BigDecimal.valueOf(3.0));
                }
                double queryAvgLastNDays(Long mid, String date, int days) { return 30.0; }
                boolean isNew(Long uid, String prefix) { return false; }  // already exists
            };
            engine.generateElectricAlerts(1L);
            verify(notificationService, never()).send(anyLong(), any(), any(), any(), anyString());
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
                true, needsAttention, attentionReasons, Instant.now().toString(), null);
    }

    /** Build a completed, history-confirmed run; only completedAt/error/area/duration/missionNumber matter. */
    private RoombaRunResponse run(String completedAt, Integer error, Integer squareFeet,
                                  Integer durationMinutes, Integer missionNumber) {
        return run(completedAt, error, squareFeet, durationMinutes, missionNumber, "COMPLETED", null, true);
    }

    private RoombaRunResponse run(String completedAt, Integer error, Integer squareFeet,
                                  Integer durationMinutes, Integer missionNumber, String status,
                                  Integer chargeMinutes, boolean verified) {
        return run(completedAt, error, squareFeet, durationMinutes, missionNumber, status, chargeMinutes, null, verified);
    }

    private RoombaRunResponse run(String completedAt, Integer error, Integer squareFeet,
                                  Integer durationMinutes, Integer missionNumber, String status,
                                  Integer chargeMinutes, Integer pauseMinutes, boolean verified) {
        return new RoombaRunResponse(
                7L, Instant.now().toString(), completedAt, durationMinutes, squareFeet,
                status, "m-1", missionNumber, error, error != null && error != 0 ? "Left wheel stuck" : null,
                "manual", "clean", verified ? "irobot-history" : "roombapy-prime",
                chargeMinutes, pauseMinutes, null, null, List.of(), null, verified);
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
            verify(notificationService, never()).send(anyLong(), any(), any(), any(), any());
        }

        @Test
        @DisplayName("cleaning complete -> SUCCESS with area + duration")
        void cleaningComplete() {
            var engine = roombaEngine(run(Instant.now().toString(), 0, 250, 42, 5), null);
            engine.generateRoombaAlerts(1L);
            verify(notificationService).send(eq(1L), eq(AlertType.ROOMBA_DONE),
                    eq(Severity.SUCCESS), contains("Cleaning complete"), contains("250 sq ft"));
        }

        @Test
        @DisplayName("cleaning time excludes recharge stops, which are mentioned separately")
        void cleaningCompleteWithRecharge() {
            var engine = roombaEngine(run(Instant.now().toString(), 0, 1529, 653, 43, "COMPLETED", 390, true), null);
            engine.generateRoombaAlerts(1L);
            verify(notificationService).send(eq(1L), eq(AlertType.ROOMBA_DONE), eq(Severity.SUCCESS),
                    eq("Cleaning complete — #43"),
                    eq("Cleaned 1,529 sq ft in 4 hr 23 min, plus 6 hr 30 min docked to recharge."));
        }

        @Test
        @DisplayName("cleaning time excludes paused minutes too")
        void cleaningCompleteWithPause() {
            // Nov 6: 419 min start to finish = 186 cleaning + 203 recharging + 30 paused.
            var engine = roombaEngine(run(Instant.now().toString(), 0, 1555, 419, 47, "COMPLETED", 203, 30, true), null);
            engine.generateRoombaAlerts(1L);
            verify(notificationService).send(eq(1L), eq(AlertType.ROOMBA_DONE), eq(Severity.SUCCESS),
                    eq("Cleaning complete — #47"),
                    eq("Cleaned 1,555 sq ft in 3 hr 6 min, plus 3 hr 23 min docked to recharge."));
        }

        @Test
        @DisplayName("a run the cloud history hasn't confirmed yet doesn't alert")
        void unverifiedRunWaits() {
            var engine = roombaEngine(run(Instant.now().toString(), 0, 849, 128, 43, "COMPLETED", null, false), null);
            engine.generateRoombaAlerts(1L);
            verify(notificationService, never()).send(anyLong(), any(), any(), any(), any());
        }

        @Test
        @DisplayName("stuck run -> 'didn't finish' WARNING, not 'complete'")
        void stuckRunDidNotFinish() {
            var engine = roombaEngine(run(Instant.now().toString(), 2, 67, 97, 45, "STUCK", 0, true), null);
            engine.generateRoombaAlerts(1L);
            verify(notificationService).send(eq(1L), eq(AlertType.ROOMBA_ATTENTION), eq(Severity.WARNING),
                    eq("Cleaning didn't finish — #45"), contains("Stopped after 67 sq ft: Left wheel stuck."));
            verify(notificationService, never()).send(anyLong(), eq(AlertType.ROOMBA_DONE), any(), any(), any());
        }

        @Test
        @DisplayName("cancelled run -> no alert")
        void cancelledRunNoAlert() {
            var engine = roombaEngine(run(Instant.now().toString(), 0, 300, 40, 46, "CANCELLED", 0, true), null);
            engine.generateRoombaAlerts(1L);
            verify(notificationService, never()).send(anyLong(), any(), any(), any(), any());
        }

        @Test
        @DisplayName("errored run does not produce a completion alert")
        void erroredRunNoCompletion() {
            var engine = roombaEngine(run(Instant.now().toString(), 6, 100, 10, 5), null);
            engine.generateRoombaAlerts(1L);
            verify(notificationService, never()).send(anyLong(), eq(AlertType.ROOMBA_DONE),
                    eq(Severity.SUCCESS), anyString(), any());
        }

        @Test
        @DisplayName("stale completed run (>24h) does not alert")
        void staleRunNoAlert() {
            String old = Instant.now().minusSeconds(60 * 60 * 48).toString();
            var engine = roombaEngine(run(old, 0, 100, 10, 5), null);
            engine.generateRoombaAlerts(1L);
            verify(notificationService, never()).send(anyLong(), any(), any(), any(), any());
        }

        @Test
        @DisplayName("still-running run (no completedAt) does not alert")
        void runningNoAlert() {
            var engine = roombaEngine(run(null, 0, 100, 10, 5), null);
            engine.generateRoombaAlerts(1L);
            verify(notificationService, never()).send(anyLong(), any(), any(), any(), any());
        }

        @Test
        @DisplayName("active error code -> CRITICAL error alert with decoded text")
        void errorAlert() {
            var engine = roombaEngine(null,
                    status(80, "stop", 6, "Roomba is stuck", true, List.of("Roomba is stuck")));
            engine.generateRoombaAlerts(1L);
            verify(notificationService).send(eq(1L), eq(AlertType.ROOMBA_ERROR),
                    eq(Severity.CRITICAL), contains("Roomba error"), contains("stuck"));
        }

        @Test
        @DisplayName("needs attention (no error) -> WARNING with reasons")
        void needsAttentionAlert() {
            var engine = roombaEngine(null,
                    status(80, "stop", 0, null, true, List.of("Bin removed", "Water tank removed")));
            engine.generateRoombaAlerts(1L);
            verify(notificationService).send(eq(1L), eq(AlertType.ROOMBA_ATTENTION),
                    eq(Severity.WARNING), contains("needs attention"), contains("Bin removed"));
        }

        @Test
        @DisplayName("error takes precedence over the generic needs-attention warning")
        void errorPrecedence() {
            var engine = roombaEngine(null,
                    status(80, "stop", 6, "Cliff detected", true, List.of("Cliff detected")));
            engine.generateRoombaAlerts(1L);
            verify(notificationService).send(eq(1L), eq(AlertType.ROOMBA_ERROR),
                    eq(Severity.CRITICAL), anyString(), any());
            verify(notificationService, never()).send(anyLong(), eq(AlertType.ROOMBA_ATTENTION),
                    eq(Severity.WARNING), contains("needs attention"), any());
        }

        @Test
        @DisplayName("low battery while not charging -> WARNING")
        void lowBatteryAlert() {
            var engine = roombaEngine(null, status(10, "stop", 0, null, false, List.of()));
            engine.generateRoombaAlerts(1L);
            verify(notificationService).send(eq(1L), eq(AlertType.ROOMBA_ATTENTION),
                    eq(Severity.WARNING), contains("battery low"), contains("10%"));
        }

        @Test
        @DisplayName("low battery while charging -> no alert")
        void lowBatteryChargingNoAlert() {
            var engine = roombaEngine(null, status(10, "charge", 0, null, false, List.of()));
            engine.generateRoombaAlerts(1L);
            verify(notificationService, never()).send(anyLong(), eq(AlertType.ROOMBA_ATTENTION),
                    eq(Severity.WARNING), contains("battery low"), any());
        }

        @Test
        @DisplayName("healthy status -> no alerts")
        void healthyNoAlert() {
            var engine = roombaEngine(null, status(90, "charge", 0, null, false, List.of()));
            engine.generateRoombaAlerts(1L);
            verify(notificationService, never()).send(anyLong(), any(), any(), any(), any());
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
            verify(notificationService, never()).send(anyLong(), any(), any(), any(), any());
        }
    }

    // ──────────────────────────────────────────
    // The dock, and a scheduled clean that didn't start (Nov 13 2026)
    // ──────────────────────────────────────────

    /** Fri Nov 13 2026, 10:03 AM at home: an hour after the 9:00 AM clean that never started. */
    private static final ZonedDateTime NOV13 = ZonedDateTime.of(2026, 11, 13, 10, 3, 0, 0, ZoneId.of("America/Chicago"));
    /** The dock's complaint as the poller stored it (pwState 671), from 9:01 AM. */
    private static final RoombaDockIssue CLEAN_WATER = new RoombaDockIssue("clean_water_empty", 671, "2026-11-13T15:01:00Z");
    /** The NUC's two schedules: Mon + Fri vacuum and mop, Tue – Thu vacuum, both at 9:00 AM. */
    private static final List<RoombaNativeScheduleResponse> SCHEDULES = List.of(
            new RoombaNativeScheduleResponse("s-13", "Regular Schedule", "WEEKLY", List.of(1, 5), 9, 0, true, 6, List.of(6), null),
            new RoombaNativeScheduleResponse("s-14", "Regular Schedule", "WEEKLY", List.of(2, 3, 4), 9, 0, true, 6, List.of(2), null));
    /** Thursday's clean, the newest run on Nov 13. */
    private static final RoombaRunResponse NOV12 = runAt("2026-11-12T15:00:15Z", "2026-11-12T18:30:36Z");

    /** The status on Nov 13: docked, idle, with whatever reasons and dock complaint given. */
    private static RoombaStatusResponse docked(RoombaDockIssue issue, List<String> reasons, String missionStart,
                                               String cycle, boolean online) {
        return new RoombaStatusResponse(
                "robot-1", "iRummy", 100, "charge", cycle, 0, null,
                false, true, true, null, missionStart, 1105, null, 301, 0, "Ready", 0, "none", "padPlate",
                44, 0, "picea unknown fault code:717", null, 51, null, null,
                online, !reasons.isEmpty(), reasons, NOV13.toInstant().toString(), issue);
    }

    private static RoombaStatusResponse nov13() {
        return docked(CLEAN_WATER, List.of("The dock's clean-water tank is empty", "picea unknown fault code:717"),
                null, "none", true);
    }

    private static RoombaStatusResponse quiet(boolean online) {
        return docked(null, List.of(), null, "none", online);
    }

    private static RoombaRunResponse runAt(String startedAt, String completedAt) {
        return new RoombaRunResponse(9L, startedAt, completedAt, 60, 1000, "COMPLETED", "m", 52, 0, null,
                "cloud", "clean", "irobot-history", 0, 0, null, null, List.of(), null, true);
    }

    /** An engine on Nov 13's data at {@code now}; {@code seenSince} records the dock dedup's start. */
    private AlertEngine watchEngine(RoombaStatusResponse status, List<RoombaRunResponse> runs,
                                    ZonedDateTime now, boolean sentAlready, List<Instant> seenSince) {
        return new AlertEngine(null, notificationService, null, null, null) {
            @Override RoombaRunResponse latestRoombaRun() { return null; }
            @Override RoombaStatusResponse roombaStatus() { return status; }
            @Override List<RoombaRunResponse> recentRoombaRuns() { return runs; }
            @Override List<RoombaNativeScheduleResponse> roombaSchedules() { return SCHEDULES; }
            @Override ZonedDateTime nowAtHome() { return now; }
            @Override boolean isNewRoomba(Long uid, String title, boolean todayOnly) { return !sentAlready; }
            @Override boolean isNewRoombaSince(Long uid, String title, Instant since) {
                seenSince.add(since);
                return !sentAlready;
            }
        };
    }

    private AlertEngine watchEngine(RoombaStatusResponse status, List<RoombaRunResponse> runs, ZonedDateTime now) {
        return watchEngine(status, runs, now, false, new ArrayList<>());
    }

    @Nested
    @DisplayName("the dock's complaint")
    class DockAlerts {

        @Test
        @DisplayName("Nov 13: the clean-water tank, said plainly, deduped from when it began")
        void cleanWaterTank() {
            List<Instant> since = new ArrayList<>();
            watchEngine(nov13(), List.of(NOV12), NOV13, false, since).generateRoombaAlerts(1L);
            verify(notificationService).send(eq(1L), eq(AlertType.ROOMBA_ATTENTION), eq(Severity.WARNING),
                    eq("Roomba dock — clean-water tank empty"),
                    eq("The dock's clean-water tank is empty. Refill it and iRummy can mop again. "
                            + "If it's full, push it in firmly; a loose tank reads as empty. Dock code 671."));
            assertEquals(Instant.parse("2026-11-13T15:01:00Z"), since.get(0));  // then the missed start's 9:00
        }

        @Test
        @DisplayName("the generic attention alert leaves the dock to its own alert")
        void genericAlertSkipsTheDock() {
            watchEngine(nov13(), List.of(NOV12), NOV13).generateRoombaAlerts(1L);
            verify(notificationService).send(eq(1L), eq(AlertType.ROOMBA_ATTENTION), eq(Severity.WARNING),
                    eq("Roomba needs attention — picea unknown fault code:717"), eq("picea unknown fault code:717."));
        }

        @Test
        @DisplayName("no generic alert when the dock is the only reason")
        void onlyTheDock() {
            var status = docked(CLEAN_WATER, List.of("The dock's clean-water tank is empty"), null, "none", true);
            watchEngine(status, List.of(NOV12), NOV13).generateRoombaAlerts(1L);
            verify(notificationService, never()).send(anyLong(), any(), any(), contains("needs attention"), any());
            verify(notificationService).send(anyLong(), any(), any(), eq("Roomba dock — clean-water tank empty"), any());
        }

        @Test
        @DisplayName("waits for a complaint to stand ten minutes")
        void settles() {
            var fresh = new RoombaDockIssue("dirty_water_full", 672, NOV13.minusMinutes(4).toInstant().toString());
            var status = docked(fresh, List.of("The dock's dirty-water tank is full"), null, "none", true);
            watchEngine(status, List.of(NOV12), NOV13).generateRoombaWatchAlerts(1L);  // 4 minutes in
            verify(notificationService, never()).send(anyLong(), any(), any(), contains("dirty-water"), any());
            watchEngine(status, List.of(NOV12), NOV13.plusMinutes(7)).generateRoombaWatchAlerts(1L);
            verify(notificationService).send(eq(1L), eq(AlertType.ROOMBA_ATTENTION), eq(Severity.WARNING),
                    eq("Roomba dock — dirty-water tank full"),
                    eq("The dock's dirty-water tank is full. Empty it and iRummy can mop again. "
                            + "If it's empty, push it in firmly; a loose tank reads as full. Dock code 672."));
        }

        @Test
        @DisplayName("already sent for this occurrence -> nothing")
        void oncePerOccurrence() {
            watchEngine(nov13(), List.of(NOV12), NOV13, true, new ArrayList<>()).generateRoombaWatchAlerts(1L);
            verify(notificationService, never()).send(anyLong(), any(), any(), any(), any());
        }

        @Test
        @DisplayName("a code nobody decoded says 'needs attention' with the code, never fine")
        void undecoded() {
            var other = new RoombaDockIssue("other", 609, "2026-11-13T15:01:00Z");
            var status = docked(other, List.of("The dock needs attention (code 609)"), null, "none", true);
            watchEngine(status, List.of(NOV12), NOV13).generateRoombaWatchAlerts(1L);
            verify(notificationService).send(eq(1L), eq(AlertType.ROOMBA_ATTENTION), eq(Severity.WARNING),
                    eq("Roomba dock needs attention"),
                    eq("The dock reported code 609, which this app can't read yet. Check the light on the dock and the iRobot app."));
        }

        @Test
        @DisplayName("the words for each kind")
        void words() {
            assertEquals("The dock's clean-water tank is out", RoombaDock.reason("clean_water_out", 650));
            assertEquals("Put it back and iRummy can mop again.", RoombaDock.fix("dirty_water_out", 653, "iRummy"));
            assertEquals("Empty it and the Roomba can mop again.", RoombaDock.fix("dirty_water_full", 654, null));
            assertEquals("The dock needs a new bag. Fit one so the dock can empty iRummy's bin again. Dock code 353.",
                    RoombaDock.alertMessage("bag", 353, "iRummy"));
            assertEquals("The dock needs attention (code 717)", RoombaDock.reason("something_new", 717));
            assertEquals("Roomba dock needs attention", RoombaDock.alertTitle("something_new"));
        }
    }

    @Nested
    @DisplayName("a scheduled clean that didn't start")
    class MissedStart {

        private static final String TITLE = "Scheduled clean didn't start — Nov 13, 9:00 AM";

        @Test
        @DisplayName("Nov 13: the 9:00 AM vacuum-and-mop clean, with the dock's reason, deduped from 9:00")
        void nov13Missed() {
            List<Instant> since = new ArrayList<>();
            watchEngine(nov13(), List.of(NOV12), NOV13, false, since).generateRoombaWatchAlerts(1L);
            verify(notificationService).send(eq(1L), eq(AlertType.ROOMBA_ATTENTION), eq(Severity.WARNING), eq(TITLE),
                    eq("iRummy's 9:00 AM vacuum-and-mop clean didn't start. The dock's clean-water tank is empty. "
                            + "Refill it and iRummy can mop again. If it's full, push it in firmly; a loose tank reads as empty."));
            // [the dock alert's start, the scheduled start]
            assertEquals(Instant.parse("2026-11-13T15:00:00Z"), since.get(1));
        }

        @Test
        @DisplayName("with nothing from the dock, it says so")
        void noReason() {
            watchEngine(quiet(true), List.of(NOV12), NOV13).generateRoombaWatchAlerts(1L);
            verify(notificationService).send(eq(1L), eq(AlertType.ROOMBA_ATTENTION), eq(Severity.WARNING), eq(TITLE),
                    eq("iRummy's 9:00 AM vacuum-and-mop clean didn't start. It hasn't said why: check the robot and the iRobot app."));
        }

        @Test
        @DisplayName("not before half an hour has passed")
        void tooEarly() {
            watchEngine(quiet(true), List.of(NOV12), NOV13.withHour(9).withMinute(25)).generateRoombaWatchAlerts(1L);
            verify(notificationService, never()).send(anyLong(), any(), any(), any(), any());
        }

        @Test
        @DisplayName("a clean that started on time, finished or still going, is no miss")
        void started() {
            watchEngine(quiet(true), List.of(runAt("2026-11-13T15:00:20Z", "2026-11-13T15:40:00Z"), NOV12), NOV13)
                    .generateRoombaWatchAlerts(1L);
            var running = new RoombaStatusResponse("robot-1", "iRummy", 80, "run", "clean", 0, null, true, true, true,
                    "M", "2026-11-13T15:00:20Z", 300, 60, 301, 0, "Ready", 0, "schedule", "padPlate", 44, 0, null, null,
                    51, null, null, true, false, List.of(), NOV13.toInstant().toString(), null);
            watchEngine(running, List.of(NOV12), NOV13).generateRoombaWatchAlerts(1L);
            verify(notificationService, never()).send(anyLong(), any(), any(), any(), any());
        }

        @Test
        @DisplayName("out on an earlier clean at 9:00 -> no miss; one that ended before 9:00 doesn't count")
        void busy() {
            watchEngine(docked(null, List.of(), "2026-11-13T13:00:00Z", "clean", true), List.of(NOV12), NOV13)
                    .generateRoombaWatchAlerts(1L);
            watchEngine(quiet(true), List.of(runAt("2026-11-13T12:30:00Z", "2026-11-13T15:20:00Z"), NOV12), NOV13)
                    .generateRoombaWatchAlerts(1L);
            verify(notificationService, never()).send(anyLong(), any(), any(), any(), any());

            watchEngine(quiet(true), List.of(runAt("2026-11-13T12:30:00Z", "2026-11-13T14:30:00Z"), NOV12), NOV13)
                    .generateRoombaWatchAlerts(1L);
            verify(notificationService).send(anyLong(), any(), any(), eq(TITLE), any());
        }

        @Test
        @DisplayName("a stale reading, a day off the schedule, a schedule that ran, or one already sent -> nothing")
        void guarded() {
            watchEngine(quiet(false), List.of(NOV12), NOV13).generateRoombaWatchAlerts(1L);
            // Saturday: no schedule.
            watchEngine(quiet(true), List.of(NOV12), NOV13.plusDays(1)).generateRoombaWatchAlerts(1L);
            // Thursday the 12th: the 9:00 AM vacuum started at 9:00:15.
            watchEngine(quiet(true), List.of(NOV12), NOV13.minusDays(1)).generateRoombaWatchAlerts(1L);
            // Next morning: too late to be news.
            watchEngine(quiet(true), List.of(NOV12), NOV13.withHour(21).withMinute(30)).generateRoombaWatchAlerts(1L);
            watchEngine(quiet(true), List.of(NOV12), NOV13, true, new ArrayList<>()).generateRoombaWatchAlerts(1L);
            verify(notificationService, never()).send(anyLong(), any(), any(), any(), any());
        }
    }
}
