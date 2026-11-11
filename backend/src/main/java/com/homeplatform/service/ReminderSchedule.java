package com.homeplatform.service;

import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collection;
import java.util.Comparator;
import java.util.EnumSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * The date logic behind household reminders, with no I/O: when a reminder is due (its
 * occurrences), when each heads-up fires, and the window in which it shows on Home (from its
 * earliest heads-up until its done-by time). Every time is the home's wall clock
 * ({@link #HOME}); instants come from {@link #instant} so a DST change is handled once, here.
 *
 * <p><b>The heads-up presets and their clock times live in {@link HeadsUpKind}</b>: change a
 * time there and every reminder that uses that preset follows.
 */
public final class ReminderSchedule {

    /** The home's time zone (the same one the weather alerts and the schedulers use). */
    public static final ZoneId HOME = WeatherAlertService.CHICAGO;

    /** "N days before" goes out at this time unless another is chosen. */
    public static final LocalTime DAYS_BEFORE_DEFAULT_TIME = LocalTime.of(9, 0);
    public static final int MAX_DAYS_BEFORE = 14;
    /** How many occurrences ahead are looked at (several can overlap with long heads-ups). */
    static final int LOOKAHEAD = 40;

    private static final DateTimeFormatter HH_MM = DateTimeFormatter.ofPattern("HH:mm");

    private ReminderSchedule() {}

    // ── Rule ──

    public enum Repeat { WEEKLY, MONTHLY, ONCE }

    /**
     * When a reminder is due: weekly on some weekdays, monthly on a day of the month (the
     * month's last day when it's shorter, so the 31st is Feb 28/29, Apr 30, ...), or once.
     */
    public record Rule(Repeat repeat, Set<DayOfWeek> weekdays, Integer dayOfMonth, LocalDate date) {

        public static Rule weekly(Collection<DayOfWeek> days) {
            return new Rule(Repeat.WEEKLY, days.isEmpty() ? EnumSet.noneOf(DayOfWeek.class) : EnumSet.copyOf(days), null, null);
        }

        public static Rule monthly(int dayOfMonth) {
            return new Rule(Repeat.MONTHLY, Set.of(), dayOfMonth, null);
        }

        public static Rule once(LocalDate date) {
            return new Rule(Repeat.ONCE, Set.of(), null, date);
        }

        public boolean occursOn(LocalDate d) {
            return switch (repeat) {
                case WEEKLY -> weekdays.contains(d.getDayOfWeek());
                case MONTHLY -> d.getDayOfMonth() == Math.min(dayOfMonth, d.lengthOfMonth());
                case ONCE -> d.equals(date);
            };
        }

        /** The first due date on or after {@code from}, or empty (a one-time date already past, or no weekdays). */
        public Optional<LocalDate> firstOnOrAfter(LocalDate from) {
            switch (repeat) {
                case WEEKLY -> {
                    for (int i = 0; i < 7; i++) {
                        LocalDate d = from.plusDays(i);
                        if (weekdays.contains(d.getDayOfWeek())) return Optional.of(d);
                    }
                    return Optional.empty();
                }
                case MONTHLY -> {
                    LocalDate first = from.withDayOfMonth(1);
                    for (int i = 0; i < 2; i++) {
                        LocalDate month = first.plusMonths(i);
                        LocalDate d = month.withDayOfMonth(Math.min(dayOfMonth, month.lengthOfMonth()));
                        if (!d.isBefore(from)) return Optional.of(d);
                    }
                    return Optional.empty(); // unreachable: next month always qualifies
                }
                default -> {
                    return date != null && !date.isBefore(from) ? Optional.of(date) : Optional.empty();
                }
            }
        }
    }

    // ── Heads-ups ──

    /**
     * The heads-up choices. Presets carry their own day and clock time — the one place to change
     * them. {@code DAYS_BEFORE} and {@code AT_TIME} take the member's own number and/or time.
     */
    public enum HeadsUpKind {
        DAYS_BEFORE("Days before", null, null),
        MORNING_BEFORE("Morning before", 1, LocalTime.of(8, 0)),
        AFTERNOON_BEFORE("Afternoon before", 1, LocalTime.of(14, 0)),
        EVENING_BEFORE("Evening before", 1, LocalTime.of(18, 0)),
        NIGHT_BEFORE("Night before", 1, LocalTime.of(20, 0)),
        MORNING_OF("Morning of", 0, LocalTime.of(7, 0)),
        AT_TIME("At a time on the day", 0, null);

        private final String label;
        private final Integer daysBefore;
        private final LocalTime time;

        HeadsUpKind(String label, Integer daysBefore, LocalTime time) {
            this.label = label;
            this.daysBefore = daysBefore;
            this.time = time;
        }

        public String label() { return label; }
        /** Null for DAYS_BEFORE (chosen). */
        public Integer daysBefore() { return daysBefore; }
        /** Null when the member picks the time. */
        public LocalTime time() { return time; }
        public boolean preset() { return daysBefore != null && time != null; }

        public static Optional<HeadsUpKind> of(String name) {
            if (name == null) return Optional.empty();
            return Arrays.stream(values()).filter(k -> k.name().equalsIgnoreCase(name.trim())).findFirst();
        }
    }

    /** One heads-up: a day before the due date (0 = on the day) and a time. */
    public record HeadsUp(HeadsUpKind kind, int daysBefore, LocalTime time) {

        public static HeadsUp preset(HeadsUpKind kind) {
            if (!kind.preset()) throw new IllegalArgumentException(kind.label() + " needs a time");
            return new HeadsUp(kind, kind.daysBefore(), kind.time());
        }

        public static HeadsUp daysBefore(int days, LocalTime time) {
            if (days < 1 || days > MAX_DAYS_BEFORE) {
                throw new IllegalArgumentException("Days before must be 1 to " + MAX_DAYS_BEFORE);
            }
            return new HeadsUp(HeadsUpKind.DAYS_BEFORE, days, time == null ? DAYS_BEFORE_DEFAULT_TIME : time.withSecond(0).withNano(0));
        }

        public static HeadsUp atTime(LocalTime time) {
            if (time == null) throw new IllegalArgumentException("Pick a time for the heads-up on the day");
            return new HeadsUp(HeadsUpKind.AT_TIME, 0, time.withSecond(0).withNano(0));
        }

        /**
         * The stored and dedupe key: a preset's name ("AFTERNOON_BEFORE"), so changing its
         * clock time in {@link HeadsUpKind} moves every reminder; else "DAYS_BEFORE:3@09:00" /
         * "AT_TIME@14:30".
         */
        public String key() {
            return switch (kind) {
                case DAYS_BEFORE -> "DAYS_BEFORE:" + daysBefore + "@" + time.format(HH_MM);
                case AT_TIME -> "AT_TIME@" + time.format(HH_MM);
                default -> kind.name();
            };
        }

        /** Parses {@link #key()}; throws IllegalArgumentException for anything else. */
        public static HeadsUp parse(String key) {
            String k = key == null ? "" : key.trim();
            try {
                if (k.startsWith("DAYS_BEFORE:")) {
                    String[] p = k.substring("DAYS_BEFORE:".length()).split("@", 2);
                    return daysBefore(Integer.parseInt(p[0]), p.length > 1 ? LocalTime.parse(p[1]) : null);
                }
                if (k.startsWith("AT_TIME@")) return atTime(LocalTime.parse(k.substring("AT_TIME@".length())));
            } catch (NumberFormatException | DateTimeParseException e) {
                throw new IllegalArgumentException("Unreadable heads-up: " + key);
            }
            HeadsUpKind kind = HeadsUpKind.of(k).filter(HeadsUpKind::preset)
                    .orElseThrow(() -> new IllegalArgumentException("Unreadable heads-up: " + key));
            return preset(kind);
        }

        /** When it fires for the occurrence due on {@code due}, on the home's clock. */
        public LocalDateTime at(LocalDate due) {
            return due.minusDays(daysBefore).atTime(time);
        }
    }

    /** Keys joined for storage, in firing order, without repeats. */
    public static String join(List<HeadsUp> headsUps) {
        return sorted(headsUps).stream().map(HeadsUp::key).collect(Collectors.joining(","));
    }

    /** The stored list back; unreadable keys are skipped (never stop a reminder over one). */
    public static List<HeadsUp> split(String stored) {
        List<HeadsUp> out = new ArrayList<>();
        if (stored == null || stored.isBlank()) return out;
        for (String key : stored.split(",")) {
            try {
                out.add(HeadsUp.parse(key));
            } catch (IllegalArgumentException ignored) {
                // a key from a future version, or hand-edited: leave it out
            }
        }
        return sorted(out);
    }

    /** Earliest first (most days before, then the earlier time); duplicates by key dropped. */
    public static List<HeadsUp> sorted(List<HeadsUp> headsUps) {
        Map<String, HeadsUp> unique = new LinkedHashMap<>();
        headsUps.stream()
                .sorted(Comparator.comparingInt((HeadsUp h) -> -h.daysBefore()).thenComparing(h -> h.time()))
                .forEach(h -> unique.putIfAbsent(h.key(), h));
        return new ArrayList<>(unique.values());
    }

    // ── Windows ──

    /** When the occurrence due on {@code due} stops showing: its done-by time, else the end of that day. */
    public static LocalDateTime dueAt(LocalDate due, LocalTime dueBy) {
        return dueBy == null ? due.plusDays(1).atStartOfDay() : due.atTime(dueBy);
    }

    /** When it starts showing on Home: the earliest heads-up, or the start of the day without any. */
    public static LocalDateTime showFrom(LocalDate due, List<HeadsUp> headsUps) {
        return headsUps.stream().map(h -> h.at(due)).min(Comparator.naturalOrder()).orElse(due.atStartOfDay());
    }

    /**
     * A home wall-clock time as an instant. A time in the spring-forward gap (2:30 AM that
     * doesn't exist) moves forward by the gap; in the fall-back hour the first 1:30 is used.
     */
    public static Instant instant(LocalDateTime homeTime) {
        return homeTime.atZone(HOME).toInstant();
    }

    public static LocalDate homeDate(Instant now) {
        return LocalDate.ofInstant(now, HOME);
    }

    /**
     * Due dates that aren't over at {@code now} (done-by time still ahead), soonest first, at
     * most {@code limit}. The first is the one people are working towards.
     */
    public static List<LocalDate> upcoming(Rule rule, LocalTime dueBy, Instant now, int limit) {
        List<LocalDate> out = new ArrayList<>();
        LocalDate from = homeDate(now);
        while (out.size() < limit) {
            Optional<LocalDate> next = rule.firstOnOrAfter(from);
            if (next.isEmpty()) break;
            LocalDate d = next.get();
            if (instant(dueAt(d, dueBy)).isAfter(now)) out.add(d);
            from = d.plusDays(1);
        }
        return out;
    }

    /** Whether the occurrence due on {@code due} shows on Home at {@code now} (ignoring completion). */
    public static boolean inWindow(LocalDate due, LocalTime dueBy, List<HeadsUp> headsUps, Instant now) {
        return !now.isBefore(instant(showFrom(due, headsUps))) && now.isBefore(instant(dueAt(due, dueBy)));
    }

    /**
     * The heads-ups of one occurrence whose time has come at {@code now} and that were set up
     * before they fired (not before {@code alertsFrom}), earliest first.
     */
    public static List<HeadsUp> dueHeadsUps(LocalDate due, List<HeadsUp> headsUps, Instant alertsFrom, Instant now) {
        return headsUps.stream()
                .filter(h -> {
                    Instant at = instant(h.at(due));
                    return !at.isAfter(now) && !at.isBefore(alertsFrom);
                })
                .toList();
    }

    // ── Words ──

    private static final DateTimeFormatter DAY = DateTimeFormatter.ofPattern("EEE, MMM d", Locale.US);

    /** "8:00 AM". */
    public static String clock(LocalTime t) {
        int h = t.getHour() % 12 == 0 ? 12 : t.getHour() % 12;
        return String.format(Locale.US, "%d:%02d %s", h, t.getMinute(), t.getHour() < 12 ? "AM" : "PM");
    }

    /**
     * An alert's body: when it's due, then the reminder's note. "Tomorrow (Fri, Nov 13). Take
     * the bins out tonight." / "Today, by 8:00 AM." / "In 3 days (Mon, Nov 16)."
     */
    public static String message(LocalDate due, LocalTime dueBy, String note, LocalDate today) {
        long days = due.toEpochDay() - today.toEpochDay();
        String when;
        if (days <= 0) when = "Today" + (dueBy != null ? ", by " + clock(dueBy) : "") + ".";
        else if (days == 1) when = "Tomorrow (" + due.format(DAY) + ").";
        else when = "In " + days + " days (" + due.format(DAY) + ").";
        if (note == null || note.isBlank()) return when;
        String n = note.trim();
        char last = n.charAt(n.length() - 1);
        return when + " " + n + (last == '.' || last == '!' || last == '?' ? "" : ".");
    }
}
