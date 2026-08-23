package com.homeplatform.repository;

import com.homeplatform.model.AppRelease;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public interface AppReleaseRepository extends JpaRepository<AppRelease, Long> {

    /** Full version history, newest first. */
    List<AppRelease> findAllByOrderBySortOrderDesc();

    Optional<AppRelease> findByVersion(String version);
}
