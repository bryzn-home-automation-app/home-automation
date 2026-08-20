package com.homeplatform.repository;

import com.homeplatform.model.RoombaStatus;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.Optional;

@Repository
public interface RoombaStatusRepository extends JpaRepository<RoombaStatus, Long> {

    /** Latest snapshot across all robots (single robot in v1). */
    Optional<RoombaStatus> findTopByOrderByUpdatedAtDesc();
}
