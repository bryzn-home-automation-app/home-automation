package com.homeplatform.repository;

import com.homeplatform.model.ForecastSnapshot;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import java.time.LocalDate;
import java.util.List;
import java.util.Optional;

public interface ForecastSnapshotRepository extends JpaRepository<ForecastSnapshot, Long> {

    Optional<ForecastSnapshot> findByForecastDateAndTargetDate(LocalDate forecastDate, LocalDate targetDate);

    List<ForecastSnapshot> findByTargetDateBetweenOrderByTargetDateAsc(LocalDate start, LocalDate end);

    List<ForecastSnapshot> findByActualKwhIsNullAndTargetDateBefore(LocalDate date);

    @Query("""
        SELECT s FROM ForecastSnapshot s
        WHERE s.actualKwh IS NOT NULL
        ORDER BY s.targetDate DESC
        """)
    List<ForecastSnapshot> findRecentWithActuals();

    @Query("""
        SELECT s FROM ForecastSnapshot s
        WHERE s.actualKwh IS NOT NULL
          AND s.targetDate >= :since
        ORDER BY s.targetDate ASC
        """)
    List<ForecastSnapshot> findWithActualsSince(LocalDate since);
}
