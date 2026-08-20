package com.homeplatform.repository;

import com.homeplatform.model.RoombaRun;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface RoombaRunRepository extends JpaRepository<RoombaRun, Long> {

    /** Newest missions first; caller supplies a Pageable for the limit. */
    List<RoombaRun> findAllByOrderByStartedAtDesc(Pageable pageable);
}
