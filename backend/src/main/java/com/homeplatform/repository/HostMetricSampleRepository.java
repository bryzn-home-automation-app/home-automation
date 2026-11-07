package com.homeplatform.repository;

import com.homeplatform.model.HostMetricSample;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

public interface HostMetricSampleRepository extends JpaRepository<HostMetricSample, Long> {

    Optional<HostMetricSample> findTopByOrderByCollectedAtDesc();

    List<HostMetricSample> findByCollectedAtGreaterThanEqualOrderByCollectedAtAsc(LocalDateTime from);

    /** Retention: samples older than {@code before}. */
    @Modifying
    @Transactional
    @Query("DELETE FROM HostMetricSample s WHERE s.collectedAt < :before")
    int deleteCollectedBefore(LocalDateTime before);
}
