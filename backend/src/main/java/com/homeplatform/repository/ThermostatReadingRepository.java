package com.homeplatform.repository;

import com.homeplatform.model.ThermostatReading;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

@Repository
public interface ThermostatReadingRepository extends JpaRepository<ThermostatReading, Long> {

    /** History window, oldest first (chart order). Bounds are UTC. */
    List<ThermostatReading> findByDeviceIdAndRecordedAtBetweenOrderByRecordedAtAsc(
            Long deviceId, LocalDateTime from, LocalDateTime to);

    /** Most recent reading — the dedupe baseline. */
    Optional<ThermostatReading> findTopByDeviceIdOrderByRecordedAtDesc(Long deviceId);
}
