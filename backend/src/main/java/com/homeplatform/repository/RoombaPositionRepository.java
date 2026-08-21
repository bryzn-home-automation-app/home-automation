package com.homeplatform.repository;

import com.homeplatform.model.RoombaPosition;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.Optional;

@Repository
public interface RoombaPositionRepository extends JpaRepository<RoombaPosition, Long> {

    /** Most recently updated position (single robot in v1). */
    Optional<RoombaPosition> findTopByOrderByUpdatedAtDesc();
}
