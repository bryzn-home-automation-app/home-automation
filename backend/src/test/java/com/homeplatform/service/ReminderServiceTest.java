package com.homeplatform.service;

import com.homeplatform.dto.DueReminderResponse;
import com.homeplatform.dto.ReminderRequest;
import com.homeplatform.dto.ReminderResponse;
import com.homeplatform.model.AlertType;
import com.homeplatform.model.Notification;
import com.homeplatform.model.Notification.Severity;
import com.homeplatform.model.Reminder;
import com.homeplatform.model.ReminderAlertSent;
import com.homeplatform.model.ReminderCompletion;
import com.homeplatform.model.User;
import com.homeplatform.repository.ReminderAlertSentRepository;
import com.homeplatform.repository.ReminderCompletionRepository;
import com.homeplatform.repository.ReminderRepository;
import com.homeplatform.repository.UserRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;

import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Comparator;
import java.util.List;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * Reminders over in-memory repositories and a settable clock: Home's window, completing and
 * undoing, and heads-up alerts (once each, never for a done or finished occurrence, only the
 * latest after downtime, members only).
 */
class ReminderServiceTest {

    /** A clock the test moves. */
    static final class TestClock extends Clock {
        Instant now;
        TestClock(Instant now) { this.now = now; }
        @Override public ZoneId getZone() { return ReminderSchedule.HOME; }
        @Override public Clock withZone(ZoneId zone) { return this; }
        @Override public Instant instant() { return now; }
        void set(int y, int m, int d, int h, int min) { now = home(y, m, d, h, min); }
    }

    private static Instant home(int y, int m, int d, int h, int min) {
        return ReminderSchedule.instant(LocalDateTime.of(y, m, d, h, min));
    }

    private final List<Reminder> rs = new ArrayList<>();
    private final List<ReminderCompletion> cs = new ArrayList<>();
    private final List<ReminderAlertSent> as = new ArrayList<>();
    private long seq;
    private Set<Long> wanting = Set.of(1L, 2L, 3L);
    private TestClock clock;
    private NotificationService notifications;
    private ReminderService service;
    private ReminderScheduler scheduler;

    @BeforeEach
    void setUp() {
        ReminderRepository reminders = mock(ReminderRepository.class);
        when(reminders.save(any())).thenAnswer(i -> {
            Reminder r = i.getArgument(0);
            if (r.getId() == null) {
                r.setId(++seq);
                rs.add(r);
            }
            return r;
        });
        when(reminders.findById(any())).thenAnswer(i -> rs.stream().filter(r -> r.getId().equals(i.getArgument(0))).findFirst());
        when(reminders.findAllByOrderByNameAsc()).thenAnswer(i -> rs.stream().sorted(Comparator.comparing(Reminder::getName)).toList());
        when(reminders.findByAlertsEnabledTrue()).thenAnswer(i -> rs.stream().filter(Reminder::isAlertsEnabled).toList());
        when(reminders.count()).thenAnswer(i -> (long) rs.size());
        doAnswer(i -> rs.remove((Reminder) i.getArgument(0))).when(reminders).delete(any());

        ReminderCompletionRepository completions = mock(ReminderCompletionRepository.class);
        when(completions.save(any())).thenAnswer(i -> {
            ReminderCompletion c = i.getArgument(0);
            cs.add(c);
            return c;
        });
        when(completions.findByReminderIdAndOccurrenceDate(any(), any())).thenAnswer(i -> cs.stream()
                .filter(c -> c.getReminderId().equals(i.getArgument(0)) && c.getOccurrenceDate().equals(i.getArgument(1))).findFirst());
        when(completions.findByOccurrenceDateGreaterThanEqual(any())).thenAnswer(i -> cs.stream()
                .filter(c -> !c.getOccurrenceDate().isBefore(i.getArgument(0))).toList());
        doAnswer(i -> cs.remove((ReminderCompletion) i.getArgument(0))).when(completions).delete(any());
        when(completions.deleteByReminderId(any())).thenAnswer(i -> {
            int n = cs.size();
            cs.removeIf(c -> c.getReminderId().equals(i.getArgument(0)));
            return n - cs.size();
        });

        ReminderAlertSentRepository alerts = mock(ReminderAlertSentRepository.class);
        // The unique key on (reminder, date, heads-up), as Postgres would enforce it.
        when(alerts.saveAndFlush(any())).thenAnswer(i -> {
            ReminderAlertSent a = i.getArgument(0);
            boolean dup = as.stream().anyMatch(x -> x.getReminderId().equals(a.getReminderId())
                    && x.getOccurrenceDate().equals(a.getOccurrenceDate()) && x.getHeadsUpKey().equals(a.getHeadsUpKey()));
            if (dup) throw new DataIntegrityViolationException("uk_reminder_alert");
            as.add(a);
            return a;
        });
        when(alerts.findByReminderIdAndOccurrenceDate(any(), any())).thenAnswer(i -> as.stream()
                .filter(a -> a.getReminderId().equals(i.getArgument(0)) && a.getOccurrenceDate().equals(i.getArgument(1))).toList());
        when(alerts.deleteByReminderId(any())).thenAnswer(i -> {
            int n = as.size();
            as.removeIf(a -> a.getReminderId().equals(i.getArgument(0)));
            return n - as.size();
        });

        UserRepository users = mock(UserRepository.class);
        List<User> people = List.of(
                User.builder().id(1L).username("bryan").displayName("Bryan").role(User.Role.ADMIN).build(),
                User.builder().id(2L).username("mai").displayName("Mai").role(User.Role.USER).build(),
                User.builder().id(3L).username("visitor").role(User.Role.GUEST).build());
        when(users.findByStatus(User.AccountStatus.ACTIVE)).thenReturn(people);
        when(users.findAllById(any())).thenAnswer(i -> people.stream()
                .filter(u -> ((Collection<?>) i.getArgument(0)).contains(u.getId())).toList());

        notifications = mock(NotificationService.class);
        when(notifications.wanting(anyList(), eq(AlertType.REMINDER))).thenAnswer(i ->
                ((List<Long>) i.getArgument(0)).stream().filter(wanting::contains).toList());
        when(notifications.send(any(), any(), any(), any(), any())).thenReturn(new Notification());

        clock = new TestClock(home(2026, 11, 1, 10, 0));
        service = new ReminderService(reminders, completions, alerts, users, notifications, clock);
        scheduler = new ReminderScheduler(service, alerts, clock);
    }

    private static ReminderRequest.HeadsUp preset(String kind) {
        return new ReminderRequest.HeadsUp(kind, null, null);
    }

    /** The owner's example: trash goes Friday by 8 AM, heads-ups Thursday afternoon and evening. */
    private static ReminderRequest trash() {
        return new ReminderRequest("Trash day", "Take the bins out tonight", "WEEKLY", List.of("FRI"), null, null, "08:00",
                List.of(preset("AFTERNOON_BEFORE"), preset("EVENING_BEFORE")), null);
    }

    private ReminderResponse addTrash() {
        return service.create(trash(), 1L);
    }

    // ── Creating ──

    @Test
    @DisplayName("a new reminder reads back with its rule, heads-ups in order, and the next occurrence")
    void create() {
        ReminderResponse r = addTrash();
        assertEquals("Trash day", r.name());
        assertEquals("WEEKLY", r.repeat());
        assertEquals(List.of("FRI"), r.weekdays());
        assertEquals("08:00", r.dueBy());
        assertEquals(List.of("AFTERNOON_BEFORE", "EVENING_BEFORE"), r.headsUps().stream().map(ReminderResponse.HeadsUp::key).toList());
        assertEquals("14:00", r.headsUps().get(0).time());
        assertTrue(r.alerts(), "alerts default on");
        assertEquals("2026-11-06", r.occurrence().date());
        assertEquals("2026-11-05T14:00", r.occurrence().showFrom());
        assertEquals("2026-11-06T08:00", r.occurrence().dueAt());
        assertFalse(r.occurrence().visible());
        assertEquals("Bryan", r.createdBy());
    }

    @Test
    @DisplayName("validation says what's wrong in plain words")
    void validation() {
        LocalDate today = LocalDate.of(2026, 11, 11);
        assertMessage("Give the reminder a name", new ReminderRequest("  ", null, "WEEKLY", List.of("FRI"), null, null, null, null, null), today);
        assertMessage("Keep the name to 60 characters", new ReminderRequest("x".repeat(61), null, "WEEKLY", List.of("FRI"), null, null, null, null, null), today);
        assertMessage("Keep the note to 200 characters", new ReminderRequest("Trash", "y".repeat(201), "WEEKLY", List.of("FRI"), null, null, null, null, null), today);
        assertMessage("Choose how often it repeats", new ReminderRequest("Trash", null, "DAILY", null, null, null, null, null, null), today);
        assertMessage("Pick at least one day of the week", new ReminderRequest("Trash", null, "WEEKLY", List.of(), null, null, null, null, null), today);
        assertMessage("Unknown day of the week: FUNDAY", new ReminderRequest("Trash", null, "WEEKLY", List.of("FUNDAY"), null, null, null, null, null), today);
        assertMessage("Pick a day of the month from 1 to 31", new ReminderRequest("Rent", null, "MONTHLY", null, 32, null, null, null, null), today);
        assertMessage("Pick a date", new ReminderRequest("Vet", null, "ONCE", null, null, "next week", null, null, null), today);
        assertMessage("That date has already passed", new ReminderRequest("Vet", null, "ONCE", null, null, "2026-11-10", null, null, null), today);
        assertMessage("Times look like 08:00", new ReminderRequest("Trash", null, "WEEKLY", List.of("FRI"), null, null, "8am", null, null), today);
        assertMessage("Unknown heads-up: SOON", new ReminderRequest("Trash", null, "WEEKLY", List.of("FRI"), null, null, null, List.of(preset("SOON")), null), today);
        assertMessage("Say how many days before", new ReminderRequest("Trash", null, "WEEKLY", List.of("FRI"), null, null, null, List.of(preset("DAYS_BEFORE")), null), today);
        assertMessage("Days before must be 1 to 14", new ReminderRequest("Trash", null, "WEEKLY", List.of("FRI"), null, null, null,
                List.of(new ReminderRequest.HeadsUp("DAYS_BEFORE", 15, null)), null), today);
        assertMessage("Pick a time for the heads-up on the day", new ReminderRequest("Trash", null, "WEEKLY", List.of("FRI"), null, null, null,
                List.of(preset("AT_TIME")), null), today);
        assertMessage("The heads-up at 9:00 AM comes after the 8:00 AM done-by time", new ReminderRequest("Trash", null, "WEEKLY", List.of("FRI"), null, null, "08:00",
                List.of(new ReminderRequest.HeadsUp("AT_TIME", null, "09:00")), null), today);
        assertMessage("Nothing to save", null, today);

        // A past one-time date may stay while that reminder is edited.
        assertDoesNotThrow(() -> ReminderService.validate(new ReminderRequest("Vet", null, "ONCE", null, null, "2026-11-10", null, null, null),
                today, LocalDate.of(2026, 11, 10)));
        // Days are read loosely ("friday", "Mon").
        assertDoesNotThrow(() -> ReminderService.validate(new ReminderRequest("Trash", null, "weekly", List.of("friday", "Mon"), null, null, null, null, null),
                today, null));
    }

    private static void assertMessage(String expected, ReminderRequest req, LocalDate today) {
        IllegalArgumentException e = assertThrows(IllegalArgumentException.class, () -> ReminderService.validate(req, today, null));
        assertEquals(expected, e.getMessage());
    }

    // ── Home's window ──

    @Test
    @DisplayName("on Home from the first heads-up until the done-by time, then it clears itself")
    void visibility() {
        addTrash();
        clock.set(2026, 11, 12, 13, 59);
        assertTrue(service.due().isEmpty());
        assertFalse(service.list().get(0).occurrence().visible());

        clock.set(2026, 11, 12, 14, 0);
        List<DueReminderResponse> due = service.due();
        assertEquals(1, due.size());
        assertEquals("2026-11-13", due.get(0).date());
        assertEquals("08:00", due.get(0).dueBy());
        assertEquals("Take the bins out tonight", due.get(0).note());
        assertTrue(service.list().get(0).occurrence().visible());

        clock.set(2026, 11, 13, 7, 59);
        assertEquals(1, service.due().size());

        clock.set(2026, 11, 13, 8, 0);
        assertTrue(service.due().isEmpty(), "past the done-by time it doesn't pile up");
        assertEquals("2026-11-20", service.list().get(0).occurrence().date());
    }

    @Test
    @DisplayName("Done hides it for everyone and records who; Undo brings it back; next week it returns")
    void completeAndUndo() {
        Long id = addTrash().id();
        clock.set(2026, 11, 12, 19, 0);
        ReminderResponse done = service.complete(id, LocalDate.of(2026, 11, 13), 2L);
        assertTrue(done.occurrence().completed());
        assertFalse(done.occurrence().visible());
        assertEquals("Mai", done.occurrence().completedBy());
        assertEquals("2026-11-12T19:00", done.occurrence().completedAt());
        assertEquals("2026-11-20", done.nextOccurrence().date());
        assertTrue(service.due().isEmpty());

        // Twice is harmless.
        service.complete(id, LocalDate.of(2026, 11, 13), 1L);
        assertEquals(1, cs.size());
        assertEquals(2L, cs.get(0).getUserId());

        ReminderResponse undone = service.undo(id, LocalDate.of(2026, 11, 13), 2L);
        assertFalse(undone.occurrence().completed());
        assertNull(undone.nextOccurrence());
        assertEquals(1, service.due().size());

        service.complete(id, LocalDate.of(2026, 11, 13), 2L);
        clock.set(2026, 11, 19, 14, 0);
        assertEquals("2026-11-20", service.due().get(0).date(), "the next occurrence comes back");
    }

    @Test
    @DisplayName("completing a day the reminder isn't due, or one long over, is refused")
    void completeChecks() {
        Long id = addTrash().id();
        clock.set(2026, 11, 12, 19, 0);
        assertEquals("That reminder isn't due on 2026-11-12",
                assertThrows(IllegalArgumentException.class, () -> service.complete(id, LocalDate.of(2026, 11, 12), 1L)).getMessage());
        assertEquals("That day is already over",
                assertThrows(IllegalArgumentException.class, () -> service.complete(id, LocalDate.of(2026, 11, 6), 1L)).getMessage());
        // Just after the done-by time (the tap was on its way) still counts.
        clock.set(2026, 11, 13, 8, 30);
        assertDoesNotThrow(() -> service.complete(id, LocalDate.of(2026, 11, 13), 1L));
        assertThrows(ReminderService.NotFound.class, () -> service.complete(99L, LocalDate.of(2026, 11, 13), 1L));
    }

    @Test
    @DisplayName("monthly on the 31st shows in a short month on its last day")
    void monthlyShortMonth() {
        service.create(new ReminderRequest("Rent", null, "MONTHLY", null, 31, null, null, List.of(preset("MORNING_OF")), null), 1L);
        clock.set(2026, 11, 30, 7, 0);
        assertEquals("2026-11-30", service.due().get(0).date());
    }

    @Test
    @DisplayName("deleting removes its completions and alert records")
    void delete() {
        Long id = addTrash().id();
        clock.set(2026, 11, 12, 14, 0);
        scheduler.runAlerts(clock.instant());
        service.complete(id, LocalDate.of(2026, 11, 13), 1L);
        service.delete(id, 1L);
        assertTrue(rs.isEmpty());
        assertTrue(cs.isEmpty());
        assertTrue(as.isEmpty());
        assertThrows(ReminderService.NotFound.class, () -> service.delete(id, 1L));
    }

    // ── Alerts ──

    @Test
    @DisplayName("each heads-up goes out once, to members only, with plain time-aware wording")
    void alertsOnce() {
        addTrash();
        clock.set(2026, 11, 12, 13, 59);
        assertEquals(0, scheduler.runAlerts(clock.instant()));

        clock.set(2026, 11, 12, 14, 0);
        assertEquals(1, scheduler.runAlerts(clock.instant()));
        verify(notifications).send(1L, AlertType.REMINDER, Severity.INFO, "Reminder: Trash day", "Tomorrow (Fri, Nov 13). Take the bins out tonight.");
        verify(notifications).send(2L, AlertType.REMINDER, Severity.INFO, "Reminder: Trash day", "Tomorrow (Fri, Nov 13). Take the bins out tonight.");
        verify(notifications, never()).send(eq(3L), any(), any(), any(), any());

        // The next ticks (and a restart: the records are what's checked) send nothing more.
        clock.set(2026, 11, 12, 14, 1);
        assertEquals(0, scheduler.runAlerts(clock.instant()));
        assertTrue(service.pendingAlerts(clock.instant()).isEmpty());

        clock.set(2026, 11, 12, 18, 0);
        assertEquals(1, scheduler.runAlerts(clock.instant()));
        assertEquals(List.of("AFTERNOON_BEFORE", "EVENING_BEFORE"), as.stream().map(ReminderAlertSent::getHeadsUpKey).toList());
        assertTrue(as.stream().allMatch(ReminderAlertSent::isSent));
        verify(notifications, times(4)).send(any(), any(), any(), any(), any());
    }

    @Test
    @DisplayName("a heads-up on the day says Today, by the done-by time")
    void sameDayWording() {
        service.create(new ReminderRequest("Trash day", null, "WEEKLY", List.of("FRI"), null, null, "08:00",
                List.of(preset("MORNING_OF")), null), 1L);
        clock.set(2026, 11, 13, 7, 0);
        assertEquals(1, scheduler.runAlerts(clock.instant()));
        verify(notifications).send(1L, AlertType.REMINDER, Severity.INFO, "Reminder: Trash day", "Today, by 8:00 AM.");
    }

    @Test
    @DisplayName("a send that collides with one already recorded is rolled back, not sent twice")
    void dedupeOnTheKey() {
        addTrash();
        clock.set(2026, 11, 12, 14, 0);
        List<ReminderService.PendingAlert> pending = service.pendingAlerts(clock.instant());
        assertEquals(1, pending.size());
        assertTrue(service.send(pending.get(0), clock.instant()));
        assertThrows(DataIntegrityViolationException.class, () -> service.send(pending.get(0), clock.instant()));
        verify(notifications, times(2)).send(any(), any(), any(), any(), any()); // the first send's two members only
    }

    @Test
    @DisplayName("a done occurrence gets no alerts, and one done while queued isn't sent")
    void doneGetsNoAlerts() {
        Long id = addTrash().id();
        clock.set(2026, 11, 12, 13, 0);
        service.complete(id, LocalDate.of(2026, 11, 13), 1L);
        clock.set(2026, 11, 12, 18, 0);
        assertEquals(0, scheduler.runAlerts(clock.instant()));
        verify(notifications, never()).send(any(), any(), any(), any(), any());

        service.undo(id, LocalDate.of(2026, 11, 13), 1L);
        List<ReminderService.PendingAlert> pending = service.pendingAlerts(clock.instant());
        assertEquals(1, pending.size());
        service.complete(id, LocalDate.of(2026, 11, 13), 1L);
        assertFalse(service.send(pending.get(0), clock.instant()));
        verify(notifications, never()).send(any(), any(), any(), any(), any());
    }

    @Test
    @DisplayName("after downtime: only the latest missed heads-up is sent while the occurrence is still ahead")
    void downtime() {
        addTrash();
        // Down from before 2 PM until 7 PM Thursday.
        clock.set(2026, 11, 12, 19, 0);
        List<ReminderService.PendingAlert> pending = service.pendingAlerts(clock.instant());
        assertEquals(1, pending.size());
        assertEquals(List.of("AFTERNOON_BEFORE", "EVENING_BEFORE"), pending.get(0).keys());
        assertEquals("EVENING_BEFORE", pending.get(0).sendKey());

        assertEquals(1, scheduler.runAlerts(clock.instant()));
        verify(notifications, times(2)).send(any(), any(), any(), any(), any()); // once per member
        assertFalse(as.get(0).isSent(), "the afternoon one is recorded as passed over");
        assertTrue(as.get(1).isSent());
        assertEquals(0, scheduler.runAlerts(clock.instant()));
    }

    @Test
    @DisplayName("after downtime past the done-by time: nothing stale is sent")
    void downtimePastDue() {
        addTrash();
        clock.set(2026, 11, 13, 9, 0);
        assertTrue(service.pendingAlerts(clock.instant()).isEmpty());
        assertEquals(0, scheduler.runAlerts(clock.instant()));
        verify(notifications, never()).send(any(), any(), any(), any(), any());
    }

    @Test
    @DisplayName("heads-ups due before a reminder was added or its alerts turned on aren't sent")
    void notBeforeSetUp() {
        clock.set(2026, 11, 12, 15, 0);
        Long id = addTrash().id();
        assertTrue(service.pendingAlerts(clock.instant()).isEmpty(), "the 2 PM one was before it existed");
        clock.set(2026, 11, 12, 18, 0);
        assertEquals(List.of("EVENING_BEFORE"), service.pendingAlerts(clock.instant()).get(0).keys());

        service.setAlerts(id, false, 1L);
        assertTrue(service.pendingAlerts(clock.instant()).isEmpty(), "alerts off: Home only");
        clock.set(2026, 11, 12, 18, 30);
        service.setAlerts(id, true, 1L);
        assertTrue(service.pendingAlerts(clock.instant()).isEmpty(), "turned back on after 6 PM: not sent late");
    }

    @Test
    @DisplayName("members who turned reminder alerts off don't get them")
    void preferences() {
        wanting = Set.of(1L);
        addTrash();
        clock.set(2026, 11, 12, 14, 0);
        scheduler.runAlerts(clock.instant());
        verify(notifications).send(eq(1L), any(), any(), any(), any());
        verify(notifications, never()).send(eq(2L), any(), any(), any(), any());
    }

    @Test
    @DisplayName("N days before at a chosen time")
    void daysBefore() {
        service.create(new ReminderRequest("Recycling", null, "WEEKLY", List.of("MON"), null, null, null,
                List.of(new ReminderRequest.HeadsUp("DAYS_BEFORE", 3, "17:30")), null), 1L);
        clock.set(2026, 11, 13, 17, 29);
        assertTrue(service.due().isEmpty());
        clock.set(2026, 11, 13, 17, 30);
        assertEquals("2026-11-16", service.due().get(0).date());
        assertEquals(1, scheduler.runAlerts(clock.instant()));
        verify(notifications).send(1L, AlertType.REMINDER, Severity.INFO, "Reminder: Recycling", "In 3 days (Mon, Nov 16).");
    }

    @Test
    @DisplayName("editing keeps the reminder and its completions; a reminder limit stops runaway lists")
    void editAndLimit() {
        Long id = addTrash().id();
        ReminderResponse r = service.update(id, new ReminderRequest("Trash and recycling", null, "WEEKLY", List.of("FRI", "TUE"),
                null, null, null, List.of(preset("NIGHT_BEFORE")), false), 2L);
        assertEquals("Trash and recycling", r.name());
        assertEquals(List.of("TUE", "FRI"), r.weekdays());
        assertNull(r.dueBy());
        assertFalse(r.alerts());
        assertThrows(ReminderService.NotFound.class, () -> service.update(99L, trash(), 1L));

        for (int i = rs.size(); i < ReminderService.MAX_REMINDERS; i++) addTrash();
        assertThrows(IllegalArgumentException.class, this::addTrash);
    }
}
