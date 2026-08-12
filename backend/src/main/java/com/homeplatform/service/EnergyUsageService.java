package com.homeplatform.service;

import com.homeplatform.dto.DailyUsagePoint;
import com.homeplatform.dto.UsageRangeSummaryResponse;
import com.homeplatform.model.EnergyUsage;
import com.homeplatform.repository.EnergyUsageRepository;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;

@Service
public class EnergyUsageService {

    private final EnergyUsageRepository repository;
    private final JdbcTemplate jdbc;

    public EnergyUsageService(EnergyUsageRepository repository, JdbcTemplate jdbc) {
        this.repository = repository;
        this.jdbc = jdbc;
    }

    public List<EnergyUsage> getAll() {
        return repository.findAll();
    }

    public List<EnergyUsage> getByMeterId(Long meterId) {
        return repository.findByMeterIdOrderByTimestampDesc(meterId);
    }

    public List<EnergyUsage> getByMeterAndDateRange(Long meterId, LocalDateTime start, LocalDateTime end) {
        return repository.findByMeterIdAndTimestampBetweenOrderByTimestampAsc(meterId, start, end);
    }

    public List<EnergyUsage> getRecent(Long meterId, LocalDateTime since) {
        return repository.findRecentByMeterId(meterId, since);
    }

    public EnergyUsage save(EnergyUsage usage) {
        return repository.save(usage);
    }

    public List<EnergyUsage> saveAll(List<EnergyUsage> usages) {
        return repository.saveAll(usages);
    }

    public Double getTotalUsageSince(Long meterId, LocalDateTime since) {
        return repository.sumUsageSince(meterId, since);
    }

    /** Pre-aggregated daily kWh from hourly records — one row per date instead of 24 per date. */
    public List<DailyUsagePoint> getDailyAggregates(Long meterId, int days) {
        String sql = """
            SELECT
                timestamp::date                             AS day,
                COALESCE(SUM(usage_kwh), 0)                AS total_kwh,
                COUNT(*)                                   AS reading_count,
                MAX(source_provider)                       AS source_provider
            FROM hourly_electric_usage
            WHERE meter_id = ?
              AND timestamp >= CURRENT_DATE - ?
            GROUP BY timestamp::date
            ORDER BY day
            """;
        return jdbc.query(sql,
                (rs, rowNum) -> new DailyUsagePoint(
                        rs.getObject("day", LocalDate.class),
                        rs.getDouble("total_kwh"),
                        rs.getInt("reading_count"),
                        rs.getString("source_provider")
                ),
                meterId, days);
    }

    /** Batch summaries: one HTTP call instead of 4. Loops getSummary in a single DB connection. */
    public List<UsageRangeSummaryResponse> getBatchSummaries(
            Long meterId,
            List<LocalDateTime[]> periods) {
        return periods.stream()
                .map(p -> getSummary(meterId, p[0], p[1]))
                .toList();
    }

    public UsageRangeSummaryResponse getSummary(Long meterId, LocalDateTime start, LocalDateTime end) {
        // Aggregate hourly → daily first, then compute stats from daily totals.
        // This gives a per-day average and a day-count readingCount instead of
        // per-hour average with hundreds of hourly rows.
        String sql = """
            WITH daily AS (
                SELECT
                    timestamp::date                            AS day,
                    SUM(usage_kwh)                             AS daily_total,
                    MIN(timestamp)                             AS first_ts
                FROM hourly_electric_usage
                WHERE meter_id = ?
                  AND timestamp BETWEEN ? AND ?
                GROUP BY timestamp::date
            )
            SELECT
                COALESCE(SUM(daily_total), 0)                                    AS total_kwh,
                COALESCE(AVG(daily_total), 0)                                    AS avg_kwh,
                COUNT(*)                                                         AS day_count,
                (SELECT first_ts FROM daily ORDER BY daily_total DESC LIMIT 1)    AS highest_ts,
                COALESCE((SELECT daily_total FROM daily ORDER BY daily_total DESC LIMIT 1), 0) AS highest_kwh,
                (SELECT first_ts FROM daily ORDER BY daily_total ASC LIMIT 1)     AS lowest_ts,
                COALESCE((SELECT daily_total FROM daily ORDER BY daily_total ASC LIMIT 1), 0)  AS lowest_kwh
            FROM daily
            """;
        try {
            var row = jdbc.queryForMap(sql, meterId, start, end);
            double total = ((Number) row.get("total_kwh")).doubleValue();
            double avg = ((Number) row.get("avg_kwh")).doubleValue();
            long count = ((Number) row.get("day_count")).longValue();

            var highest = row.get("highest_ts") != null
                    ? new UsageRangeSummaryResponse.UsagePoint(
                        ((java.sql.Timestamp) row.get("highest_ts")).toLocalDateTime(),
                        ((Number) row.get("highest_kwh")).doubleValue())
                    : null;
            var lowest = row.get("lowest_ts") != null
                    ? new UsageRangeSummaryResponse.UsagePoint(
                        ((java.sql.Timestamp) row.get("lowest_ts")).toLocalDateTime(),
                        ((Number) row.get("lowest_kwh")).doubleValue())
                    : null;

            return new UsageRangeSummaryResponse(meterId, start, end, total, avg, count, highest, lowest);
        } catch (Exception e) {
            // Fallback to JPA for gas meters or if hourly table is empty
            return getSummaryViaJpa(meterId, start, end);
        }
    }

    /** Original JPA-based summary — used as fallback for gas meters and empty hourly data. */
    private UsageRangeSummaryResponse getSummaryViaJpa(Long meterId, LocalDateTime start, LocalDateTime end) {
        double totalKwh = repository.sumUsageBetween(meterId, start, end);
        double averageKwh = repository.avgUsageBetween(meterId, start, end);
        long readingCount = repository.countByMeterIdAndTimestampBetween(meterId, start, end);

        UsageRangeSummaryResponse.UsagePoint highest = repository
            .findFirstByMeterIdAndTimestampBetweenOrderByUsageKwhDescTimestampAsc(meterId, start, end)
            .map(usage -> new UsageRangeSummaryResponse.UsagePoint(
                usage.getTimestamp(),
                usage.getUsageKwh().doubleValue()
            ))
            .orElse(null);

        UsageRangeSummaryResponse.UsagePoint lowest = repository
            .findFirstByMeterIdAndTimestampBetweenOrderByUsageKwhAscTimestampAsc(meterId, start, end)
            .map(usage -> new UsageRangeSummaryResponse.UsagePoint(
                usage.getTimestamp(),
                usage.getUsageKwh().doubleValue()
            ))
            .orElse(null);

        return new UsageRangeSummaryResponse(meterId, start, end, totalKwh, averageKwh, readingCount, highest, lowest);
}
}
