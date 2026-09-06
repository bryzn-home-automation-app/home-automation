package com.homeplatform.repository;

import com.homeplatform.model.RoombaNativeSchedule;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface RoombaNativeScheduleRepository extends JpaRepository<RoombaNativeSchedule, Long> {

    List<RoombaNativeSchedule> findAllByOrderByIdAsc();
}
