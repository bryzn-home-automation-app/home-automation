package com.homeplatform.service;

import com.homeplatform.model.ForecastModel;
import com.homeplatform.model.ForecastSnapshot;
import com.homeplatform.repository.ForecastModelRepository;
import com.homeplatform.repository.ForecastSnapshotRepository;
import com.homeplatform.service.ForecastService.DriftState;
import com.homeplatform.service.ForecastService.ForecastDiagnostics;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

/**
 * Focused tests for {@link ForecastService#getDiagnostics} — the dashboard
 * assembly method (doc §12). Exercises the non-trivial logic layered on top of
 * the already-tested pure helpers: freshest-prediction-per-target-day dedup,
 * newest-first ordering, and graceful empty-window / no-model handling. Uses
 * mocked repositories (matching the project's plain-mock test style).
 */
class ForecastServiceDiagnosticsTest {

    private ForecastModelRepository modelRepo;
    private ForecastSnapshotRepository snapshotRepo;
    private AppEventService appEventService;
    private ForecastService service;

    @BeforeEach
    void setUp() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        modelRepo = mock(ForecastModelRepository.class);
        snapshotRepo = mock(ForecastSnapshotRepository.class);
        appEventService = mock(AppEventService.class);
        service = new ForecastService(jdbc, modelRepo, snapshotRepo, appEventService);
    }

    private static ForecastModel modelWithMae(double mae) {
        return ForecastModel.builder().mae(BigDecimal.valueOf(mae)).build();
    }

    private static ForecastSnapshot snap(LocalDate forecastDate, LocalDate targetDate,
                                         double predicted, double actual) {
        return ForecastSnapshot.builder()
                .forecastDate(forecastDate)
                .targetDate(targetDate)
                .predictedKwh(BigDecimal.valueOf(predicted))
                .actualKwh(BigDecimal.valueOf(actual))
                .build();
    }

    @Test
    @DisplayName("no active model -> empty daily list, NORMAL drift (no crash)")
    void noModelYieldsEmptyDiagnostics() {
        when(modelRepo.findFirstByOrderByCreatedAtDesc()).thenReturn(Optional.empty());

        ForecastDiagnostics d = service.getDiagnostics(30);

        assertTrue(d.daily().isEmpty());
        assertEquals(DriftState.NORMAL, d.drift().state());
        assertEquals(30, d.trailingDays());
    }

    @Test
    @DisplayName("no graded days in window -> empty daily list even with an active model")
    void emptyWindowYieldsEmptyDaily() {
        when(modelRepo.findFirstByOrderByCreatedAtDesc()).thenReturn(Optional.of(modelWithMae(10.0)));
        when(snapshotRepo.findWithActualsSince(any())).thenReturn(List.of());
        when(snapshotRepo.findRecentWithActuals(any())).thenReturn(List.of());

        ForecastDiagnostics d = service.getDiagnostics(30);

        assertTrue(d.daily().isEmpty());
    }

    @Test
    @DisplayName("keeps the freshest prediction per target day and orders newest-first")
    void dedupesAndOrdersNewestFirst() {
        LocalDate d1 = LocalDate.now().minusDays(3);
        LocalDate d2 = LocalDate.now().minusDays(1);
        // Two competing predictions for d1: the later forecast_date must win.
        ForecastSnapshot stale = snap(d1.minusDays(2), d1, 50.0, 60.0);
        ForecastSnapshot fresh = snap(d1.minusDays(1), d1, 55.0, 60.0);
        ForecastSnapshot latest = snap(d2.minusDays(1), d2, 40.0, 48.0);

        when(modelRepo.findFirstByOrderByCreatedAtDesc()).thenReturn(Optional.of(modelWithMae(10.0)));
        when(snapshotRepo.findWithActualsSince(any())).thenReturn(List.of(stale, fresh, latest));
        when(snapshotRepo.findRecentWithActuals(any())).thenReturn(List.of());

        ForecastDiagnostics d = service.getDiagnostics(30);

        assertEquals(2, d.daily().size(), "one row per target day (d1 deduped)");
        // Newest-first: d2 before d1.
        assertEquals(d2, d.daily().get(0).date());
        assertEquals(d1, d.daily().get(1).date());
        // d1 row used the fresher prediction (55), not the stale one (50).
        assertEquals(55.0, d.daily().get(1).predicted(), 1e-9);
        // residual = actual - predicted, absError = |residual|.
        assertEquals(5.0, d.daily().get(1).residual(), 1e-9);   // 60 - 55
        assertEquals(8.0, d.daily().get(0).residual(), 1e-9);   // 48 - 40
        assertEquals(8.0, d.daily().get(0).absError(), 1e-9);
    }
}
