package com.homeplatform.service;

import com.homeplatform.dto.RoombaScheduleSkipResponse;
import com.homeplatform.model.AlertType;
import com.homeplatform.model.Notification.Severity;
import com.homeplatform.model.RoombaCommand;
import com.homeplatform.model.RoombaNativeSchedule;
import com.homeplatform.model.RoombaScheduleSkip;
import com.homeplatform.model.User;
import com.homeplatform.repository.RoombaCommandRepository;
import com.homeplatform.repository.RoombaNativeScheduleRepository;
import com.homeplatform.repository.RoombaScheduleSkipRepository;
import com.homeplatform.repository.RoombaStatusRepository;
import com.homeplatform.repository.UserRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.time.Clock;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.time.ZonedDateTime;
import java.util.List;
import java.util.NoSuchElementException;
import java.util.Optional;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * Skipping a scheduled clean, backend side: what may be skipped, when it starts and is switched
 * back on (home time to UTC), the wake-up command for the poller, undo, and the one alert per
 * skip that couldn't be made or left a schedule off. 9:00 AM at home is 15:00 UTC in November.
 */
class RoombaScheduleSkipServiceTest {

    private static final ZoneId HOME = ZoneId.of("America/Chicago");
    private static final String TUE_THU = "hh_irbt.hh.home_TUETHU_s";

    private RoombaScheduleSkipRepository skips;
    private RoombaNativeScheduleRepository schedules;
    private RoombaCommandRepository commands;
    private NotificationService notifications;
    private UserRepository users;

    @BeforeEach
    void setUp() {
        skips = mock(RoombaScheduleSkipRepository.class);
        schedules = mock(RoombaNativeScheduleRepository.class);
        commands = mock(RoombaCommandRepository.class);
        notifications = mock(NotificationService.class);
        users = mock(UserRepository.class);
        when(skips.save(any())).thenAnswer(inv -> {
            RoombaScheduleSkip s = inv.getArgument(0);
            s.setId(7L);
            return s;
        });
        when(skips.findByHouseholdScheduleIdAndStateIn(anyString(), any())).thenReturn(List.of());
        mirror(TUE_THU, "[2, 3, 4]", true);
    }

    private RoombaScheduleSkipService at(int month, int day, int hour, int minute) {
        Clock clock = Clock.fixed(ZonedDateTime.of(2026, month, day, hour, minute, 0, 0, HOME).toInstant(), ZoneOffset.UTC);
        return new RoombaScheduleSkipService(skips, schedules, commands, mock(RoombaStatusRepository.class),
                notifications, users, clock);
    }

    private void mirror(String id, String days, boolean enabled) {
        when(schedules.findAllByOrderByIdAsc()).thenReturn(List.of(RoombaNativeSchedule.builder()
                .id(13L).householdScheduleId(id).robotId("BLID")
                .options("{\"name\":\"Regular Schedule\",\"schedule_id\":\"" + id + "\",\"enabled\":" + enabled
                        + ",\"start\":{\"day\":" + days + ",\"hour\":9,\"min\":0}}")
                .updatedAt(LocalDateTime.of(2026, 10, 8, 14, 30)).build()));
    }

    private static RoombaScheduleSkip row(String state) {
        return RoombaScheduleSkip.builder().id(7L).householdScheduleId(TUE_THU).scheduleId(TUE_THU)
                .skipDate(LocalDate.of(2026, 11, 17)).scheduleHour(9).scheduleMinute(0)
                .scheduledFor(LocalDateTime.of(2026, 11, 17, 15, 0)).restoreAfter(LocalDateTime.of(2026, 11, 17, 15, 30))
                .state(state).attempts(0).build();
    }

    @Nested
    @DisplayName("skip")
    class Skip {

        @Test
        @DisplayName("tomorrow's clean: stored with its UTC start and switch-back time, and the poller is woken")
        void skipsTomorrow() {
            RoombaScheduleSkipResponse r = at(11, 16, 20, 0).skip(TUE_THU, "2026-11-17", "user:1");

            ArgumentCaptor<RoombaScheduleSkip> saved = ArgumentCaptor.forClass(RoombaScheduleSkip.class);
            verify(skips).save(saved.capture());
            RoombaScheduleSkip s = saved.getValue();
            assertEquals(LocalDateTime.of(2026, 11, 17, 15, 0), s.getScheduledFor());
            assertEquals(LocalDateTime.of(2026, 11, 17, 15, 30), s.getRestoreAfter());
            assertEquals("PENDING", s.getState());
            assertEquals(TUE_THU, s.getScheduleId());
            assertEquals(0, s.getAttempts());
            assertEquals(LocalDateTime.of(2026, 11, 17, 2, 0), s.getNextCheckAt(), "the poller looks at once");
            assertEquals("BLID", s.getRobotId());

            ArgumentCaptor<RoombaCommand> cmd = ArgumentCaptor.forClass(RoombaCommand.class);
            verify(commands).save(cmd.capture());
            assertEquals("skip_clean", cmd.getValue().getCommand());
            assertEquals("7", cmd.getValue().getArg());
            assertEquals("PENDING", cmd.getValue().getStatus());

            assertEquals("2026-11-17", r.date());
            assertEquals("2026-11-17T15:00Z", r.scheduledFor());
            assertFalse(r.undoRequested());
        }

        @Test
        @DisplayName("today's clean while it is still to come")
        void skipsToday() {
            RoombaScheduleSkipResponse r = at(11, 17, 7, 30).skip(TUE_THU, "2026-11-17", "user:1");
            assertEquals("2026-11-17T15:00Z", r.scheduledFor());
        }

        @Test
        @DisplayName("refuses a clean that has started, or starts within two minutes")
        void refusesStartedOrTooSoon() {
            var started = assertThrows(IllegalArgumentException.class, () -> at(11, 17, 9, 0).skip(TUE_THU, "2026-11-17", "u"));
            assertEquals("That clean has already started.", started.getMessage());
            var soon = assertThrows(IllegalArgumentException.class, () -> at(11, 17, 8, 59).skip(TUE_THU, "2026-11-17", "u"));
            assertTrue(soon.getMessage().contains("too soon"));
            verify(skips, never()).save(any());
            verify(commands, never()).save(any());
        }

        @Test
        @DisplayName("only today or tomorrow, and only a day the schedule cleans on")
        void refusesOtherDays() {
            var later = assertThrows(IllegalArgumentException.class, () -> at(11, 16, 20, 0).skip(TUE_THU, "2026-11-18", "u"));
            assertEquals("Only today's or tomorrow's clean can be skipped.", later.getMessage());
            var monday = assertThrows(IllegalArgumentException.class, () -> at(11, 15, 20, 0).skip(TUE_THU, "2026-11-16", "u"));
            assertEquals("That schedule doesn't clean on Monday.", monday.getMessage());
            assertThrows(IllegalArgumentException.class, () -> at(11, 16, 20, 0).skip(TUE_THU, "tomorrow", "u"));
            assertThrows(IllegalArgumentException.class, () -> at(11, 16, 20, 0).skip("gone", "2026-11-17", "u"));
        }

        @Test
        @DisplayName("a schedule switched off has nothing to skip, unless it is off for a skip of ours")
        void switchedOff() {
            mirror(TUE_THU, "[2, 3, 4]", false);
            assertThrows(IllegalArgumentException.class, () -> at(11, 17, 7, 0).skip(TUE_THU, "2026-11-18", "u"));
            RoombaScheduleSkip today = row("APPLIED");
            when(skips.findByHouseholdScheduleIdAndStateIn(eq(TUE_THU), any())).thenReturn(List.of(today));
            RoombaScheduleSkipResponse r = at(11, 17, 7, 0).skip(TUE_THU, "2026-11-18", "u");
            assertEquals("2026-11-18", r.date());
        }

        @Test
        @DisplayName("the same clean twice is refused; once undone it can be skipped again")
        void duplicates() {
            RoombaScheduleSkip existing = row("PENDING");
            when(skips.findByHouseholdScheduleIdAndStateIn(eq(TUE_THU), any())).thenReturn(List.of(existing));
            var e = assertThrows(IllegalArgumentException.class, () -> at(11, 16, 20, 0).skip(TUE_THU, "2026-11-17", "u"));
            assertEquals("That clean is already skipped.", e.getMessage());
            existing.setUndoRequestedAt(LocalDateTime.of(2026, 11, 17, 1, 0));
            assertNotNull(at(11, 16, 20, 0).skip(TUE_THU, "2026-11-17", "u"));
        }

        @Test
        @DisplayName("Sunday is 0 or 7, and the start follows the home clock across the end of daylight saving")
        void sundayAndDst() {
            // Sun Nov 1 2026: clocks went back at 2 AM, so 9:00 AM is CST, 15:00 UTC.
            mirror(TUE_THU, "[0]", true);
            assertEquals("2026-11-01T15:00Z", at(10, 31, 20, 0).skip(TUE_THU, "2026-11-01", "u").scheduledFor());
            mirror(TUE_THU, "[7]", true);
            assertEquals("2026-11-01T15:00Z", at(10, 31, 20, 0).skip(TUE_THU, "2026-11-01", "u").scheduledFor());
            // Sat Oct 31 is still CDT: 9:00 AM is 14:00 UTC.
            mirror(TUE_THU, "[6]", true);
            assertEquals("2026-10-31T14:00Z", at(10, 30, 20, 0).skip(TUE_THU, "2026-10-31", "u").scheduledFor());
            assertTrue(RoombaScheduleSkipService.runsOn(Set.of(1, 5), LocalDate.of(2026, 11, 16)));
            assertFalse(RoombaScheduleSkipService.runsOn(Set.of(1, 5), LocalDate.of(2026, 11, 15)));
        }
    }

    @Nested
    @DisplayName("undo")
    class Undo {

        @Test
        @DisplayName("asks the poller through the undo columns only, and wakes it")
        void undo() {
            RoombaScheduleSkip s = row("APPLIED");
            when(skips.findById(7L)).thenReturn(Optional.of(s));
            when(skips.requestUndo(eq(7L), any(), eq("user:1"), any())).thenReturn(1);

            at(11, 16, 20, 0).undo(7L, "user:1");

            verify(skips).requestUndo(eq(7L), eq(LocalDateTime.of(2026, 11, 17, 2, 0)), eq("user:1"), any());
            verify(skips, never()).save(any());
            ArgumentCaptor<RoombaCommand> cmd = ArgumentCaptor.forClass(RoombaCommand.class);
            verify(commands).save(cmd.capture());
            assertEquals("undo_skip", cmd.getValue().getCommand());
            assertEquals("7", cmd.getValue().getArg());
        }

        @Test
        @DisplayName("a second undo, or one the poller beat, sends no second command")
        void onlyOnce() {
            RoombaScheduleSkip s = row("PENDING");
            s.setUndoRequestedAt(LocalDateTime.of(2026, 11, 17, 1, 0));
            when(skips.findById(7L)).thenReturn(Optional.of(s));
            assertTrue(at(11, 16, 20, 0).undo(7L, "u").undoRequested());
            verify(skips, never()).requestUndo(any(), any(), any(), any());
            verify(commands, never()).save(any());
        }

        @Test
        @DisplayName("a finished skip can't be undone; a missing one is not found")
        void ended() {
            when(skips.findById(7L)).thenReturn(Optional.of(row("RESTORED")));
            assertThrows(IllegalStateException.class, () -> at(11, 16, 20, 0).undo(7L, "u"));
            assertThrows(NoSuchElementException.class, () -> at(11, 16, 20, 0).undo(8L, "u"));
        }
    }

    @Nested
    @DisplayName("alerts")
    class Alerts {

        private void admins() {
            User a = User.builder().id(1L).role(User.Role.ADMIN).status(User.AccountStatus.ACTIVE).build();
            User b = User.builder().id(2L).role(User.Role.ADMIN).status(User.AccountStatus.ACTIVE).build();
            when(users.findByRoleAndStatus(User.Role.ADMIN, User.AccountStatus.ACTIVE)).thenReturn(List.of(a, b));
            when(skips.markAlerted(eq(7L), any())).thenReturn(1);
        }

        @Test
        @DisplayName("a skip the poller couldn't make tells every admin once, with the reason")
        void failed() {
            admins();
            RoombaScheduleSkip s = row("FAILED");
            s.setLastError("couldn't read the schedules (OSError: down)");
            when(skips.findByAlertedAtIsNullAndStateIn(any())).thenReturn(List.of(s));

            at(11, 17, 9, 5).alertFailures();

            ArgumentCaptor<String> msg = ArgumentCaptor.forClass(String.class);
            verify(notifications).send(eq(1L), eq(AlertType.ROOMBA_ERROR), eq(Severity.WARNING),
                    eq("Couldn't skip the Roomba's clean"), msg.capture());
            verify(notifications).send(eq(2L), eq(AlertType.ROOMBA_ERROR), eq(Severity.WARNING), anyString(), anyString());
            assertTrue(msg.getValue().startsWith("Tuesday's 9:00 AM clean was to be skipped"));
            assertTrue(msg.getValue().contains("OSError: down"));
        }

        @Test
        @DisplayName("a skip never switched off (the poller was down) alerts 10 minutes after the start")
        void neverApplied() {
            admins();
            when(skips.findByAlertedAtIsNullAndStateIn(any())).thenReturn(List.of(row("PENDING")));
            at(11, 17, 9, 5).alertFailures();
            verify(notifications, never()).send(any(), any(), any(), any(), any());
            at(11, 17, 9, 11).alertFailures();
            verify(notifications, times(2)).send(any(), eq(AlertType.ROOMBA_ERROR), eq(Severity.WARNING), anyString(), anyString());
        }

        @Test
        @DisplayName("a schedule still off an hour after it should be back on is critical")
        void stillOff() {
            admins();
            RoombaScheduleSkip s = row("APPLIED");
            s.setLastError("couldn't switch the schedule on (TimeoutError: PUT timed out)");
            when(skips.findByAlertedAtIsNullAndStateIn(any())).thenReturn(List.of(s));
            at(11, 17, 10, 0).alertFailures();   // 30 min past the switch-back time
            verify(notifications, never()).send(any(), any(), any(), any(), any());

            at(11, 17, 10, 31).alertFailures();  // 61 min past it
            ArgumentCaptor<String> msg = ArgumentCaptor.forClass(String.class);
            verify(notifications).send(eq(1L), eq(AlertType.ROOMBA_ERROR), eq(Severity.CRITICAL),
                    eq("A Roomba schedule may still be off"), msg.capture());
            assertTrue(msg.getValue().contains("Turn it back on in the iRobot app"));
            assertTrue(msg.getValue().contains("PUT timed out"));
        }

        @Test
        @DisplayName("an undo the poller hasn't carried out within the hour alerts too")
        void undoNotDone() {
            RoombaScheduleSkip s = row("APPLIED");
            s.setUndoRequestedAt(LocalDateTime.of(2026, 11, 17, 2, 0));  // Mon 8 PM, for Tuesday's clean
            assertNull(RoombaScheduleSkipService.alertFor(s, LocalDateTime.of(2026, 11, 17, 2, 30)));
            var alert = RoombaScheduleSkipService.alertFor(s, LocalDateTime.of(2026, 11, 17, 3, 1));
            assertNotNull(alert);
            assertEquals(Severity.CRITICAL, alert.severity());
        }

        @Test
        @DisplayName("only one alert per skip, even with two backends racing")
        void once() {
            admins();
            when(skips.findByAlertedAtIsNullAndStateIn(any())).thenReturn(List.of(row("FAILED")));
            when(skips.markAlerted(eq(7L), any())).thenReturn(0);
            at(11, 17, 9, 5).alertFailures();
            verify(notifications, never()).send(any(), any(), any(), any(), any());
        }

        @Test
        @DisplayName("a skip that ended with its schedule gone from the cloud while off: a warning to check the app")
        void goneWhileOff() {
            admins();
            RoombaScheduleSkip s = row("RESTORED");
            s.setDetail(RoombaScheduleSkipService.GONE_WHILE_OFF);
            when(skips.findByAlertedAtIsNullAndStateAndDetail("RESTORED", RoombaScheduleSkipService.GONE_WHILE_OFF))
                    .thenReturn(List.of(s));
            at(11, 17, 9, 40).alertFailures();
            ArgumentCaptor<String> msg = ArgumentCaptor.forClass(String.class);
            verify(notifications).send(eq(1L), eq(AlertType.ROOMBA_ERROR), eq(Severity.WARNING),
                    eq("A skipped Roomba schedule has gone missing"), msg.capture());
            assertTrue(msg.getValue().contains("Check the iRobot app: the schedule we switched off is no longer there."));
            verify(skips).markAlerted(eq(7L), any());
            // Any other way a skip ends says nothing.
            RoombaScheduleSkip back = row("RESTORED");
            back.setDetail("Done. The schedule is back on.");
            assertNull(RoombaScheduleSkipService.alertFor(back, LocalDateTime.of(2026, 11, 17, 16, 0)));
        }

        @Test
        @DisplayName("nothing for a skip going to plan")
        void quiet() {
            assertNull(RoombaScheduleSkipService.alertFor(row("APPLIED"), LocalDateTime.of(2026, 11, 17, 15, 45)));
            assertNull(RoombaScheduleSkipService.alertFor(row("PENDING"), LocalDateTime.of(2026, 11, 17, 2, 0)));
            RoombaScheduleSkip undone = row("PENDING");
            undone.setUndoRequestedAt(LocalDateTime.of(2026, 11, 17, 1, 0));
            assertNull(RoombaScheduleSkipService.alertFor(undone, LocalDateTime.of(2026, 11, 17, 16, 0)));
        }
    }

    @Test
    @DisplayName("the page's list: skips under way plus the last two days")
    void recent() {
        when(skips.findRecent(any(), any())).thenReturn(List.of(row("APPLIED")));
        List<RoombaScheduleSkipResponse> out = at(11, 16, 20, 0).recent();
        assertEquals(1, out.size());
        verify(skips).findRecent(eq(List.of("PENDING", "APPLYING", "APPLIED")), eq(LocalDateTime.of(2026, 11, 15, 2, 0)));
    }
}
