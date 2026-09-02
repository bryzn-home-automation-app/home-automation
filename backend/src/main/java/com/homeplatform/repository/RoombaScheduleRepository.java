package com.homeplatform.repository;

import com.homeplatform.model.RoombaSchedule;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface RoombaScheduleRepository extends JpaRepository<RoombaSchedule, Long> {

    /** All schedules for the management list, newest first. */
    List<RoombaSchedule> findAllByOrderByIdDesc();

    /** Only enabled schedules — the candidate set the minute-tick scheduler evaluates. */
    List<RoombaSchedule> findByEnabledTrue();
}
