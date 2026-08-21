package com.homeplatform.repository;

import com.homeplatform.model.RoombaCommand;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface RoombaCommandRepository extends JpaRepository<RoombaCommand, Long> {
    /** Most-recent commands for the control panel's activity list. */
    List<RoombaCommand> findTop20ByOrderByIdDesc();
}
