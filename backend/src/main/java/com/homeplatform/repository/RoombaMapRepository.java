package com.homeplatform.repository;

import com.homeplatform.model.RoombaMap;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.Optional;

@Repository
public interface RoombaMapRepository extends JpaRepository<RoombaMap, Long> {

    /** Most recently updated map (single robot in v1). */
    Optional<RoombaMap> findTopByOrderByUpdatedAtDesc();
}
