package com.homeplatform.repository;

import com.homeplatform.model.Reminder;
import com.homeplatform.model.ReminderAlertSent;
import com.homeplatform.model.ReminderCompletion;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.dao.DataIntegrityViolationException;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;

import static org.junit.jupiter.api.Assertions.*;

/**
 * The reminder tables on a real database (H2, built from the entities like ddl-auto does; the
 * Postgres-only schema.sql isn't run): the dedupe keys hold and the queries work.
 */
@DataJpaTest(properties = "spring.sql.init.mode=never")
class ReminderRepositoryTest {

    @Autowired ReminderRepository reminders;
    @Autowired ReminderCompletionRepository completions;
    @Autowired ReminderAlertSentRepository alerts;

    private Reminder trash() {
        LocalDateTime now = LocalDateTime.of(2026, 11, 11, 9, 0);
        return reminders.save(Reminder.builder().name("Trash day").repeatKind("WEEKLY").weekdays("FRI")
                .dueBy(LocalTime.of(8, 0)).headsUps("AFTERNOON_BEFORE,EVENING_BEFORE")
                .alertsFrom(now).createdAt(now).updatedAt(now).build());
    }

    @Test
    @DisplayName("a heads-up can be recorded once per occurrence")
    void alertKey() {
        Long id = trash().getId();
        LocalDate fri = LocalDate.of(2026, 11, 13);
        LocalDateTime at = LocalDateTime.of(2026, 11, 12, 14, 0);
        alerts.saveAndFlush(ReminderAlertSent.builder().reminderId(id).occurrenceDate(fri).headsUpKey("AFTERNOON_BEFORE").sent(true).sentAt(at).build());
        alerts.saveAndFlush(ReminderAlertSent.builder().reminderId(id).occurrenceDate(fri.plusDays(7)).headsUpKey("AFTERNOON_BEFORE").sent(true).sentAt(at).build());
        assertThrows(DataIntegrityViolationException.class, () -> alerts.saveAndFlush(ReminderAlertSent.builder()
                .reminderId(id).occurrenceDate(fri).headsUpKey("AFTERNOON_BEFORE").sent(true).sentAt(at).build()));
    }

    @Test
    @DisplayName("an occurrence is completed once; queries and deletes by reminder work")
    void completions() {
        Reminder r = trash();
        LocalDate fri = LocalDate.of(2026, 11, 13);
        completions.saveAndFlush(ReminderCompletion.builder().reminderId(r.getId()).occurrenceDate(fri).userId(1L)
                .completedAt(LocalDateTime.of(2026, 11, 12, 19, 0)).build());
        assertThrows(DataIntegrityViolationException.class, () -> completions.saveAndFlush(ReminderCompletion.builder()
                .reminderId(r.getId()).occurrenceDate(fri).userId(2L).completedAt(LocalDateTime.of(2026, 11, 12, 19, 1)).build()));
    }

    @Test
    @DisplayName("lookups used by the service")
    void queries() {
        Reminder r = trash();
        LocalDate fri = LocalDate.of(2026, 11, 13);
        completions.save(ReminderCompletion.builder().reminderId(r.getId()).occurrenceDate(fri).userId(1L)
                .completedAt(LocalDateTime.of(2026, 11, 12, 19, 0)).build());
        alerts.save(ReminderAlertSent.builder().reminderId(r.getId()).occurrenceDate(LocalDate.of(2026, 8, 1))
                .headsUpKey("EVENING_BEFORE").sent(true).sentAt(LocalDateTime.of(2026, 7, 31, 18, 0)).build());

        assertEquals(1, reminders.findByAlertsEnabledTrue().size());
        assertEquals("Trash day", reminders.findAllByOrderByNameAsc().get(0).getName());
        assertEquals(1, completions.findByOccurrenceDateGreaterThanEqual(fri).size());
        assertEquals(0, completions.findByOccurrenceDateGreaterThanEqual(fri.plusDays(1)).size());
        assertTrue(completions.findByReminderIdAndOccurrenceDate(r.getId(), fri).isPresent());
        assertEquals(1, alerts.findByReminderIdAndOccurrenceDate(r.getId(), LocalDate.of(2026, 8, 1)).size());
        assertEquals(1, alerts.deleteByOccurrenceDateBefore(LocalDate.of(2026, 9, 1)));
        assertEquals(1, completions.deleteByReminderId(r.getId()));
        assertEquals(LocalTime.of(8, 0), reminders.findById(r.getId()).orElseThrow().getDueBy());
    }
}
