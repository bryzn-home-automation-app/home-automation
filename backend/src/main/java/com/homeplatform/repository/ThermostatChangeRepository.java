package com.homeplatform.repository;

import com.homeplatform.model.ThermostatChange;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

@Repository
public interface ThermostatChangeRepository extends JpaRepository<ThermostatChange, Long> {

    /** The latest change — the card's "Set by …" line. */
    Optional<ThermostatChange> findTopByDeviceIdOrderByChangedAtDesc(Long deviceId);

    /** Recent changes, newest first. */
    List<ThermostatChange> findByDeviceIdOrderByChangedAtDesc(Long deviceId, Pageable page);

    /** Every thermostat's changes since a time, newest first — the activity log. */
    List<ThermostatChange> findByChangedAtAfterOrderByChangedAtDesc(LocalDateTime since);

    /** A change is already on record for this HA state (its last_updated). */
    boolean existsByDeviceIdAndChangedAt(Long deviceId, LocalDateTime changedAt);
}
