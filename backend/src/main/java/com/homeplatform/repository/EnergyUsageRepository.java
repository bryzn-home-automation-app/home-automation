package com.homeplatform.repository;

import com.homeplatform.model.EnergyUsage;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

@Repository
public interface EnergyUsageRepository extends JpaRepository<EnergyUsage, Long> {

    List<EnergyUsage> findByMeterIdOrderByTimestampDesc(Long meterId);

    List<EnergyUsage> findByMeterIdAndTimestampBetweenOrderByTimestampAsc(
            Long meterId, LocalDateTime start, LocalDateTime end);

    Optional<EnergyUsage> findFirstByMeterIdAndTimestampBetweenOrderByUsageKwhDescTimestampAsc(
           Long meterId, LocalDateTime start, LocalDateTime end);

    Optional<EnergyUsage> findFirstByMeterIdAndTimestampBetweenOrderByUsageKwhAscTimestampAsc(
           Long meterId, LocalDateTime start, LocalDateTime end);

    long countByMeterIdAndTimestampBetween(Long meterId, LocalDateTime start, LocalDateTime end);

    @Query("SELECT e FROM EnergyUsage e WHERE e.meter.id = :meterId " +
           "AND e.timestamp >= :since ORDER BY e.timestamp DESC")
    List<EnergyUsage> findRecentByMeterId(@Param("meterId") Long meterId,
                                          @Param("since") LocalDateTime since);

    @Query("SELECT COALESCE(SUM(e.usageKwh), 0) FROM EnergyUsage e " +
           "WHERE e.meter.id = :meterId AND e.timestamp >= :since")
    Double sumUsageSince(@Param("meterId") Long meterId,
                         @Param("since") LocalDateTime since);

    @Query("SELECT COALESCE(SUM(e.usageKwh), 0) FROM EnergyUsage e " +
           "WHERE e.meter.id = :meterId AND e.timestamp BETWEEN :start AND :end")
    Double sumUsageBetween(@Param("meterId") Long meterId,
                           @Param("start") LocalDateTime start,
                           @Param("end") LocalDateTime end);

    @Query("SELECT COALESCE(AVG(e.usageKwh), 0) FROM EnergyUsage e " +
           "WHERE e.meter.id = :meterId AND e.timestamp BETWEEN :start AND :end")
    Double avgUsageBetween(@Param("meterId") Long meterId,
                           @Param("start") LocalDateTime start,
                           @Param("end") LocalDateTime end);
}
