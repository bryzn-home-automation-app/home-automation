package com.homeplatform.service;

import com.homeplatform.model.Notification.Category;
import com.homeplatform.model.Notification.Severity;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

import java.math.BigDecimal;
import java.util.HashMap;
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
        alertEngine = new AlertEngine(jdbc, notificationService, userRepo, appEventService);
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
            var engine = new AlertEngine(null, notificationService, null, null) {
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
            var engine = new AlertEngine(null, notificationService, null, null) {
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
            var engine = new AlertEngine(null, notificationService, null, null) {
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
            var engine = new AlertEngine(null, notificationService, null, null) {
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
            var engine = new AlertEngine(null, notificationService, null, null) {
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
            var engine = new AlertEngine(null, notificationService, null, null) {
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
            var engine = new AlertEngine(null, notificationService, null, null) {
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
}
