package com.homeplatform.repository;

import com.homeplatform.model.ReminderCompletion;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.time.LocalDate;
import java.util.List;
import java.util.Optional;

@Repository
public interface ReminderCompletionRepository extends JpaRepository<ReminderCompletion, Long> {

    Optional<ReminderCompletion> findByReminderIdAndOccurrenceDate(Long reminderId, LocalDate occurrenceDate);

    /** Completions from {@code from} on: the occurrences still ahead or due today. */
    List<ReminderCompletion> findByOccurrenceDateGreaterThanEqual(LocalDate from);

    @Modifying
    @Query("DELETE FROM ReminderCompletion c WHERE c.reminderId = :reminderId")
    int deleteByReminderId(@Param("reminderId") Long reminderId);
}
