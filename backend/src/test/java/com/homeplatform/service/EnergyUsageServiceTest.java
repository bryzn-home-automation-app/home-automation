package com.homeplatform.service;

import com.homeplatform.dto.UsageRangeSummaryResponse;
import com.homeplatform.dto.UsageRangeSummaryResponse.UsagePoint;
import com.homeplatform.model.EnergyUsage;
import com.homeplatform.repository.EnergyUsageRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class EnergyUsageServiceTest {

    private EnergyUsageService energyUsageService;
    private EnergyUsageRepository repo;

    @BeforeEach
    void setUp() {
        repo = mock(EnergyUsageRepository.class);
        energyUsageService = new EnergyUsageService(repo);
    }

    private EnergyUsage usage(Long id, double kwh) {
        EnergyUsage e = new EnergyUsage();
        e.setId(id);
        e.setUsageKwh(BigDecimal.valueOf(kwh));
        e.setTimestamp(LocalDateTime.now());
        return e;
    }

    @Nested
    @DisplayName("getSummary")
    class GetSummary {

        @Test
        @DisplayName("assembles full summary with high and low points")
        void assemblesFullSummary() {
            LocalDateTime start = LocalDateTime.of(2026, 8, 1, 0, 0);
            LocalDateTime end = LocalDateTime.of(2026, 8, 7, 23, 59);
            EnergyUsage high = usage(1L, 5.5);
            high.setTimestamp(LocalDateTime.of(2026, 8, 3, 15, 0));
            EnergyUsage low = usage(2L, 0.8);
            low.setTimestamp(LocalDateTime.of(2026, 8, 5, 3, 0));

            when(repo.sumUsageBetween(1L, start, end)).thenReturn(200.5);
            when(repo.avgUsageBetween(1L, start, end)).thenReturn(28.64);
            when(repo.countByMeterIdAndTimestampBetween(1L, start, end)).thenReturn(168L);
            when(repo.findFirstByMeterIdAndTimestampBetweenOrderByUsageKwhDescTimestampAsc(1L, start, end))
                    .thenReturn(Optional.of(high));
            when(repo.findFirstByMeterIdAndTimestampBetweenOrderByUsageKwhAscTimestampAsc(1L, start, end))
                    .thenReturn(Optional.of(low));

            UsageRangeSummaryResponse summary = energyUsageService.getSummary(1L, start, end);

            assertEquals(200.5, summary.totalKwh());
            assertEquals(28.64, summary.averageKwh());
            assertEquals(168L, summary.readingCount());
            assertNotNull(summary.highest());
            assertEquals(5.5, summary.highest().usageKwh());
            assertNotNull(summary.lowest());
            assertEquals(0.8, summary.lowest().usageKwh());
        }

        @Test
        @DisplayName("returns null high/low when no data")
        void nullHighLowWhenEmpty() {
            LocalDateTime start = LocalDateTime.of(2026, 8, 1, 0, 0);
            LocalDateTime end = LocalDateTime.of(2026, 8, 7, 23, 59);

            when(repo.sumUsageBetween(1L, start, end)).thenReturn(0.0);
            when(repo.avgUsageBetween(1L, start, end)).thenReturn(0.0);
            when(repo.countByMeterIdAndTimestampBetween(1L, start, end)).thenReturn(0L);
            when(repo.findFirstByMeterIdAndTimestampBetweenOrderByUsageKwhDescTimestampAsc(1L, start, end))
                    .thenReturn(Optional.empty());
            when(repo.findFirstByMeterIdAndTimestampBetweenOrderByUsageKwhAscTimestampAsc(1L, start, end))
                    .thenReturn(Optional.empty());

            UsageRangeSummaryResponse summary = energyUsageService.getSummary(1L, start, end);

            assertEquals(0.0, summary.totalKwh());
            assertEquals(0L, summary.readingCount());
            assertNull(summary.highest());
            assertNull(summary.lowest());
        }
    }

    @Nested
    @DisplayName("getByMeterAndDateRange")
    class GetByMeterAndDateRange {

        @Test
        @DisplayName("returns usage within date range")
        void returnsRange() {
            LocalDateTime start = LocalDateTime.now().minusDays(7);
            LocalDateTime end = LocalDateTime.now();
            when(repo.findByMeterIdAndTimestampBetweenOrderByTimestampAsc(1L, start, end))
                    .thenReturn(List.of(usage(1L, 2.5), usage(2L, 3.1)));

            List<EnergyUsage> result = energyUsageService.getByMeterAndDateRange(1L, start, end);

            assertEquals(2, result.size());
        }
    }

    @Nested
    @DisplayName("getRecent")
    class GetRecent {

        @Test
        @DisplayName("delegates to repository")
        void delegatesToRepo() {
            LocalDateTime since = LocalDateTime.now().minusDays(30);
            when(repo.findRecentByMeterId(1L, since)).thenReturn(List.of());

            List<EnergyUsage> result = energyUsageService.getRecent(1L, since);

            assertTrue(result.isEmpty());
        }
    }

    @Nested
    @DisplayName("getTotalUsageSince")
    class GetTotalUsageSince {

        @Test
        @DisplayName("returns total kWh since date")
        void returnsTotal() {
            LocalDateTime since = LocalDateTime.now().minusDays(30);
            when(repo.sumUsageSince(1L, since)).thenReturn(450.0);

            Double total = energyUsageService.getTotalUsageSince(1L, since);

            assertEquals(450.0, total);
        }
    }
}
