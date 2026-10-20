package com.homeplatform.repository;

import com.homeplatform.model.CameraBatteryReading;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

@Repository
public interface CameraBatteryReadingRepository extends JpaRepository<CameraBatteryReading, Long> {

    /** History window, oldest first (chart order). Bounds are UTC. */
    List<CameraBatteryReading> findByDeviceIdAndRecordedAtBetweenOrderByRecordedAtAsc(
            Long deviceId, LocalDateTime from, LocalDateTime to);

    /** Most recent reading — the dedupe baseline. */
    Optional<CameraBatteryReading> findTopByDeviceIdOrderByRecordedAtDesc(Long deviceId);
}
