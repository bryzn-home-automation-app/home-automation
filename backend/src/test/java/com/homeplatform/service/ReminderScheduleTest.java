package com.homeplatform.service;

import com.homeplatform.service.ReminderSchedule.HeadsUp;
import com.homeplatform.service.ReminderSchedule.HeadsUpKind;
import com.homeplatform.service.ReminderSchedule.Rule;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.util.List;
import java.util.Optional;

import static java.time.DayOfWeek.*;
import static org.junit.jupiter.api.Assertions.*;

/** Occurrences, heads-up times, Home's window and the alert wording, all on the home's clock. */
class ReminderScheduleTest {

    private static final LocalTime EIGHT = LocalTime.of(8, 0);

    private static LocalDate d(int y, int m, int day) {
        return LocalDate.of(y, m, day);
    }

    /** A home wall-clock time as an instant. */
    private static Instant home(int y, int m, int day, int h, int min) {
        return ReminderSchedule.instant(LocalDateTime.of(y, m, day, h, min));
    }

    @Nested
    @DisplayName("weekly")
    class Weekly {
        @Test
        @DisplayName("the next chosen weekday, across the end of the week and the year")
        void next() {
            Rule fri = Rule.weekly(List.of(FRIDAY));
            assertEquals(d(2026, 11, 13), fri.firstOnOrAfter(d(2026, 11, 11)).orElseThrow()); // Wed → Fri
            assertEquals(d(2026, 11, 13), fri.firstOnOrAfter(d(2026, 11, 13)).orElseThrow()); // that day itself
            assertEquals(d(2026, 11, 20), fri.firstOnOrAfter(d(2026, 11, 14)).orElseThrow()); // Sat → next Fri

            Rule monFri = Rule.weekly(List.of(MONDAY, FRIDAY));
            assertEquals(d(2026, 11, 16), monFri.firstOnOrAfter(d(2026, 11, 14)).orElseThrow()); // Sat → Mon

            Rule thu = Rule.weekly(List.of(THURSDAY));
            assertEquals(d(2026, 12, 31), thu.firstOnOrAfter(d(2026, 12, 30)).orElseThrow());
            assertEquals(d(2027, 1, 7), thu.firstOnOrAfter(d(2027, 1, 1)).orElseThrow());
        }

        @Test
        @DisplayName("no weekdays: never due")
        void none() {
            assertTrue(Rule.weekly(List.of()).firstOnOrAfter(d(2026, 11, 11)).isEmpty());
        }

        @Test
        @DisplayName("occursOn matches only the chosen weekdays")
        void occursOn() {
            Rule r = Rule.weekly(List.of(FRIDAY));
            assertTrue(r.occursOn(d(2026, 11, 13)));
            assertFalse(r.occursOn(d(2026, 11, 12)));
        }
    }

    @Nested
    @DisplayName("monthly")
    class Monthly {
        @Test
        @DisplayName("the 29th to 31st fall on the last day of a shorter month")
        void shortMonths() {
            Rule r31 = Rule.monthly(31);
            assertEquals(d(2026, 2, 28), r31.firstOnOrAfter(d(2026, 2, 1)).orElseThrow());
            assertEquals(d(2028, 2, 29), r31.firstOnOrAfter(d(2028, 2, 1)).orElseThrow()); // leap year
            assertEquals(d(2026, 4, 30), r31.firstOnOrAfter(d(2026, 4, 1)).orElseThrow());
            assertEquals(d(2026, 1, 31), r31.firstOnOrAfter(d(2026, 1, 31)).orElseThrow());
            assertEquals(d(2026, 3, 30), Rule.monthly(30).firstOnOrAfter(d(2026, 3, 1)).orElseThrow());
            assertEquals(d(2026, 2, 28), Rule.monthly(29).firstOnOrAfter(d(2026, 2, 1)).orElseThrow());

            assertTrue(Rule.monthly(29).occursOn(d(2026, 2, 28)));
            assertFalse(Rule.monthly(29).occursOn(d(2028, 2, 28)), "a leap February has the 29th itself");
            assertTrue(Rule.monthly(29).occursOn(d(2028, 2, 29)));
            assertFalse(Rule.monthly(31).occursOn(d(2026, 4, 29)));
        }

        @Test
        @DisplayName("after this month's day, next month's (also across the year)")
        void rollsOver() {
            assertEquals(d(2026, 12, 5), Rule.monthly(5).firstOnOrAfter(d(2026, 11, 6)).orElseThrow());
            assertEquals(d(2027, 1, 15), Rule.monthly(15).firstOnOrAfter(d(2026, 12, 16)).orElseThrow());
            // Jan 31 done, the next is Feb's last day.
            assertEquals(d(2026, 2, 28), Rule.monthly(31).firstOnOrAfter(d(2026, 2, 1)).orElseThrow());
        }
    }

    @Test
    @DisplayName("one time: that date, then never again")
    void once() {
        Rule r = Rule.once(d(2026, 11, 20));
        assertEquals(Optional.of(d(2026, 11, 20)), r.firstOnOrAfter(d(2026, 11, 11)));
        assertEquals(Optional.of(d(2026, 11, 20)), r.firstOnOrAfter(d(2026, 11, 20)));
        assertTrue(r.firstOnOrAfter(d(2026, 11, 21)).isEmpty());
        assertTrue(ReminderSchedule.upcoming(r, null, home(2026, 11, 21, 0, 0), 5).isEmpty());
        assertEquals(List.of(d(2026, 11, 20)), ReminderSchedule.upcoming(r, null, home(2026, 11, 20, 23, 59), 5));
    }

    @Nested
    @DisplayName("done-by time")
    class DoneBy {
        @Test
        @DisplayName("an occurrence is over at its done-by time, else at the end of its day")
        void over() {
            Rule fri = Rule.weekly(List.of(FRIDAY));
            assertEquals(d(2026, 11, 13), ReminderSchedule.upcoming(fri, EIGHT, home(2026, 11, 13, 7, 59), 1).get(0));
            assertEquals(d(2026, 11, 20), ReminderSchedule.upcoming(fri, EIGHT, home(2026, 11, 13, 8, 0), 1).get(0));
            assertEquals(d(2026, 11, 13), ReminderSchedule.upcoming(fri, null, home(2026, 11, 13, 23, 59), 1).get(0));
            assertEquals(d(2026, 11, 20), ReminderSchedule.upcoming(fri, null, home(2026, 11, 14, 0, 0), 1).get(0));
        }

        @Test
        @DisplayName("upcoming lists occurrences in order")
        void list() {
            assertEquals(List.of(d(2026, 11, 13), d(2026, 11, 16), d(2026, 11, 20)),
                    ReminderSchedule.upcoming(Rule.weekly(List.of(MONDAY, FRIDAY)), null, home(2026, 11, 11, 12, 0), 3));
        }

        @Test
        @DisplayName("dueAt: the time on the day, or the next midnight")
        void dueAt() {
            assertEquals(LocalDateTime.of(2026, 11, 13, 8, 0), ReminderSchedule.dueAt(d(2026, 11, 13), EIGHT));
            assertEquals(LocalDateTime.of(2026, 11, 14, 0, 0), ReminderSchedule.dueAt(d(2026, 11, 13), null));
        }
    }

    @Nested
    @DisplayName("heads-ups")
    class HeadsUps {
        @Test
        @DisplayName("presets land on their day and time")
        void presets() {
            LocalDate fri = d(2026, 11, 13);
            assertEquals(LocalDateTime.of(2026, 11, 12, 8, 0), HeadsUp.preset(HeadsUpKind.MORNING_BEFORE).at(fri));
            assertEquals(LocalDateTime.of(2026, 11, 12, 14, 0), HeadsUp.preset(HeadsUpKind.AFTERNOON_BEFORE).at(fri));
            assertEquals(LocalDateTime.of(2026, 11, 12, 18, 0), HeadsUp.preset(HeadsUpKind.EVENING_BEFORE).at(fri));
            assertEquals(LocalDateTime.of(2026, 11, 12, 20, 0), HeadsUp.preset(HeadsUpKind.NIGHT_BEFORE).at(fri));
            assertEquals(LocalDateTime.of(2026, 11, 13, 7, 0), HeadsUp.preset(HeadsUpKind.MORNING_OF).at(fri));
            assertEquals(LocalDateTime.of(2026, 11, 13, 6, 15), HeadsUp.atTime(LocalTime.of(6, 15)).at(fri));
        }

        @Test
        @DisplayName("N days before: calendar days back, across a month end, 9 AM unless chosen")
        void daysBefore() {
            assertEquals(LocalDateTime.of(2026, 11, 10, 9, 0), HeadsUp.daysBefore(3, null).at(d(2026, 11, 13)));
            assertEquals(LocalDateTime.of(2026, 2, 27, 17, 30), HeadsUp.daysBefore(3, LocalTime.of(17, 30)).at(d(2026, 3, 2)));
            assertEquals(LocalDateTime.of(2026, 10, 30, 9, 0), HeadsUp.daysBefore(14, null).at(d(2026, 11, 13)));
            assertThrows(IllegalArgumentException.class, () -> HeadsUp.daysBefore(0, null));
            assertThrows(IllegalArgumentException.class, () -> HeadsUp.daysBefore(15, null));
            assertThrows(IllegalArgumentException.class, () -> HeadsUp.atTime(null));
            assertThrows(IllegalArgumentException.class, () -> HeadsUp.preset(HeadsUpKind.AT_TIME));
        }

        @Test
        @DisplayName("keys round-trip; presets are stored by name so their times can change in one place")
        void keys() {
            for (HeadsUp h : List.of(HeadsUp.preset(HeadsUpKind.AFTERNOON_BEFORE), HeadsUp.daysBefore(3, LocalTime.of(9, 0)),
                    HeadsUp.atTime(LocalTime.of(14, 30)), HeadsUp.preset(HeadsUpKind.MORNING_OF))) {
                assertEquals(h, HeadsUp.parse(h.key()));
            }
            assertEquals("AFTERNOON_BEFORE", HeadsUp.preset(HeadsUpKind.AFTERNOON_BEFORE).key());
            assertEquals("DAYS_BEFORE:3@09:00", HeadsUp.daysBefore(3, null).key());
            assertEquals("AT_TIME@14:30", HeadsUp.atTime(LocalTime.of(14, 30)).key());
            assertThrows(IllegalArgumentException.class, () -> HeadsUp.parse("SOMETIME"));
            assertThrows(IllegalArgumentException.class, () -> HeadsUp.parse("DAYS_BEFORE:x@09:00"));
            assertThrows(IllegalArgumentException.class, () -> HeadsUp.parse("AT_TIME@25:00"));
        }

        @Test
        @DisplayName("stored lists come back earliest first, without repeats or unreadable keys")
        void storage() {
            String stored = ReminderSchedule.join(List.of(HeadsUp.preset(HeadsUpKind.EVENING_BEFORE),
                    HeadsUp.preset(HeadsUpKind.AFTERNOON_BEFORE), HeadsUp.preset(HeadsUpKind.EVENING_BEFORE),
                    HeadsUp.daysBefore(2, null), HeadsUp.preset(HeadsUpKind.MORNING_OF)));
            assertEquals("DAYS_BEFORE:2@09:00,AFTERNOON_BEFORE,EVENING_BEFORE,MORNING_OF", stored);
            assertEquals(4, ReminderSchedule.split(stored + ",FROM_THE_FUTURE").size());
            assertTrue(ReminderSchedule.split("").isEmpty());
            assertTrue(ReminderSchedule.split(null).isEmpty());
        }
    }

    @Nested
    @DisplayName("Home's window")
    class Window {
        private final List<HeadsUp> trash = List.of(HeadsUp.preset(HeadsUpKind.AFTERNOON_BEFORE), HeadsUp.preset(HeadsUpKind.EVENING_BEFORE));
        private final LocalDate fri = d(2026, 11, 13);

        @Test
        @DisplayName("from the earliest heads-up until the done-by time")
        void window() {
            assertEquals(LocalDateTime.of(2026, 11, 12, 14, 0), ReminderSchedule.showFrom(fri, trash));
            assertFalse(ReminderSchedule.inWindow(fri, EIGHT, trash, home(2026, 11, 12, 13, 59)));
            assertTrue(ReminderSchedule.inWindow(fri, EIGHT, trash, home(2026, 11, 12, 14, 0)));
            assertTrue(ReminderSchedule.inWindow(fri, EIGHT, trash, home(2026, 11, 13, 7, 59)));
            assertFalse(ReminderSchedule.inWindow(fri, EIGHT, trash, home(2026, 11, 13, 8, 0)));
        }

        @Test
        @DisplayName("without heads-ups it shows on the day itself")
        void noHeadsUps() {
            assertEquals(fri.atStartOfDay(), ReminderSchedule.showFrom(fri, List.of()));
            assertFalse(ReminderSchedule.inWindow(fri, null, List.of(), home(2026, 11, 12, 23, 59)));
            assertTrue(ReminderSchedule.inWindow(fri, null, List.of(), home(2026, 11, 13, 0, 0)));
            assertTrue(ReminderSchedule.inWindow(fri, null, List.of(), home(2026, 11, 13, 23, 59)));
        }

        @Test
        @DisplayName("heads-ups due now, but none set up after they fired")
        void dueHeadsUps() {
            Instant created = home(2026, 11, 1, 10, 0);
            assertEquals(List.of(), ReminderSchedule.dueHeadsUps(fri, trash, created, home(2026, 11, 12, 13, 59)));
            assertEquals(List.of(trash.get(0)), ReminderSchedule.dueHeadsUps(fri, trash, created, home(2026, 11, 12, 14, 0)));
            assertEquals(trash, ReminderSchedule.dueHeadsUps(fri, trash, created, home(2026, 11, 12, 19, 0)));
            // Added at 3 PM Thursday: the 2 PM heads-up is skipped, the 6 PM one isn't.
            assertEquals(List.of(trash.get(1)),
                    ReminderSchedule.dueHeadsUps(fri, trash, home(2026, 11, 12, 15, 0), home(2026, 11, 12, 18, 0)));
        }
    }

    @Nested
    @DisplayName("DST in America/Chicago")
    class Dst {
        @Test
        @DisplayName("spring forward (Mar 8, 2026): wall-clock times keep their meaning; 2:30 AM moves to 3:30 AM CDT")
        void spring() {
            // Sat Mar 7 6 PM is still CST (UTC-6).
            assertEquals(Instant.parse("2026-03-08T00:00:00Z"),
                    ReminderSchedule.instant(HeadsUp.preset(HeadsUpKind.EVENING_BEFORE).at(d(2026, 3, 8))));
            // 2:30 AM doesn't exist on Mar 8: it's 3:30 AM CDT.
            assertEquals(Instant.parse("2026-03-08T08:30:00Z"),
                    ReminderSchedule.instant(HeadsUp.atTime(LocalTime.of(2, 30)).at(d(2026, 3, 8))));
            // Sun 8 PM after the change is CDT (UTC-5).
            assertEquals(Instant.parse("2026-03-09T01:00:00Z"),
                    ReminderSchedule.instant(HeadsUp.preset(HeadsUpKind.NIGHT_BEFORE).at(d(2026, 3, 9))));
            // "1 day before" is the calendar day, not 24 hours: 23 hours apart across the change.
            Instant before = ReminderSchedule.instant(HeadsUp.daysBefore(1, LocalTime.of(9, 0)).at(d(2026, 3, 9)));
            assertEquals(Instant.parse("2026-03-08T14:00:00Z"), before);
            // A Sunday occurrence on the short day still ends at the next midnight.
            assertEquals(List.of(d(2026, 3, 8)),
                    ReminderSchedule.upcoming(Rule.weekly(List.of(SUNDAY)), null, Instant.parse("2026-03-09T04:59:00Z"), 1));
            assertEquals(List.of(d(2026, 3, 15)),
                    ReminderSchedule.upcoming(Rule.weekly(List.of(SUNDAY)), null, Instant.parse("2026-03-09T05:00:00Z"), 1));
        }

        @Test
        @DisplayName("fall back (Nov 1, 2026): 1:30 AM is the first one; days still end at local midnight")
        void fall() {
            assertEquals(Instant.parse("2026-11-01T06:30:00Z"),
                    ReminderSchedule.instant(HeadsUp.atTime(LocalTime.of(1, 30)).at(d(2026, 11, 1))));
            // Sun Nov 1 6 PM is CST (UTC-6).
            assertEquals(Instant.parse("2026-11-02T00:00:00Z"),
                    ReminderSchedule.instant(HeadsUp.preset(HeadsUpKind.EVENING_BEFORE).at(d(2026, 11, 2))));
            // Sat Oct 31 ends at midnight CDT; Sunday's 25-hour day ends at midnight CST.
            assertEquals(Instant.parse("2026-11-01T05:00:00Z"), ReminderSchedule.instant(ReminderSchedule.dueAt(d(2026, 10, 31), null)));
            assertEquals(Instant.parse("2026-11-02T06:00:00Z"), ReminderSchedule.instant(ReminderSchedule.dueAt(d(2026, 11, 1), null)));
            assertEquals(d(2026, 11, 1), ReminderSchedule.homeDate(Instant.parse("2026-11-02T05:59:00Z")));
        }
    }

    @Nested
    @DisplayName("alert wording")
    class Wording {
        private final LocalDate thu = d(2026, 11, 12);

        @Test
        @DisplayName("the day before: Tomorrow (Fri, Nov 13), then the note")
        void tomorrow() {
            assertEquals("Tomorrow (Fri, Nov 13). Take the bins out tonight.",
                    ReminderSchedule.message(d(2026, 11, 13), EIGHT, "Take the bins out tonight", thu));
            assertEquals("Tomorrow (Fri, Nov 13).", ReminderSchedule.message(d(2026, 11, 13), EIGHT, "  ", thu));
            assertEquals("Tomorrow (Fri, Nov 13). Bins out!", ReminderSchedule.message(d(2026, 11, 13), null, "Bins out!", thu));
        }

        @Test
        @DisplayName("on the day: Today, by the done-by time")
        void today() {
            assertEquals("Today, by 8:00 AM.", ReminderSchedule.message(d(2026, 11, 13), EIGHT, null, d(2026, 11, 13)));
            assertEquals("Today.", ReminderSchedule.message(d(2026, 11, 13), null, null, d(2026, 11, 13)));
        }

        @Test
        @DisplayName("further ahead: In N days (date)")
        void later() {
            assertEquals("In 3 days (Mon, Nov 16).", ReminderSchedule.message(d(2026, 11, 16), null, null, d(2026, 11, 13)));
        }

        @Test
        @DisplayName("clock times read like 8:00 AM")
        void clock() {
            assertEquals("8:00 AM", ReminderSchedule.clock(EIGHT));
            assertEquals("12:00 PM", ReminderSchedule.clock(LocalTime.NOON));
            assertEquals("12:30 AM", ReminderSchedule.clock(LocalTime.of(0, 30)));
            assertEquals("6:05 PM", ReminderSchedule.clock(LocalTime.of(18, 5)));
        }
    }

    @Test
    @DisplayName("every preset has its day and time in one place")
    void presetsInOnePlace() {
        for (HeadsUpKind k : HeadsUpKind.values()) {
            if (k == HeadsUpKind.DAYS_BEFORE || k == HeadsUpKind.AT_TIME) assertFalse(k.preset());
            else assertTrue(k.preset(), k + " should carry its own time");
        }
        assertEquals(DayOfWeek.FRIDAY, d(2026, 11, 13).getDayOfWeek());
    }
}
