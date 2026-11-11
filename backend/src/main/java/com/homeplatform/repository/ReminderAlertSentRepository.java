package com.homeplatform.repository;

import com.homeplatform.model.ReminderAlertSent;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.util.List;

@Repository
public interface ReminderAlertSentRepository extends JpaRepository<ReminderAlertSent, Long> {

    List<ReminderAlertSent> findByReminderIdAndOccurrenceDate(Long reminderId, LocalDate occurrenceDate);

    @Modifying
    @Query("DELETE FROM ReminderAlertSent a WHERE a.reminderId = :reminderId")
    int deleteByReminderId(@Param("reminderId") Long reminderId);

    /** Retention: rows for occurrences long past only ever guarded a send that's over. */
    @Modifying
    @Transactional
    @Query("DELETE FROM ReminderAlertSent a WHERE a.occurrenceDate < :before")
    int deleteByOccurrenceDateBefore(@Param("before") LocalDate before);
}
