package com.homeplatform.repository;

import com.homeplatform.model.RoombaCoverage;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.Optional;

@Repository
public interface RoombaCoverageRepository extends JpaRepository<RoombaCoverage, Long> {

    /** Most recently updated coverage (single robot in v1). */
    Optional<RoombaCoverage> findTopByOrderByUpdatedAtDesc();
}
