package com.homeplatform.repository;

import com.homeplatform.model.Reminder;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface ReminderRepository extends JpaRepository<Reminder, Long> {

    List<Reminder> findAllByOrderByNameAsc();

    List<Reminder> findByAlertsEnabledTrue();
}
