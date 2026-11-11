package com.homeplatform.dto;

import java.util.List;

/**
 * Add or change a reminder. {@code repeat} is WEEKLY (with {@code weekdays}, "MON".."SUN"),
 * MONTHLY (with {@code dayOfMonth} 1–31) or ONCE (with {@code date}, "2026-11-13"). Times are
 * "HH:mm" on the home's clock; {@code dueBy} null = end of the day. {@code alerts} null = on.
 */
public record ReminderRequest(String name, String note, String repeat, List<String> weekdays, Integer dayOfMonth,
                              String date, String dueBy, List<HeadsUp> headsUps, Boolean alerts) {

    /** {@code kind} is a {@code ReminderSchedule.HeadsUpKind}; {@code days} for DAYS_BEFORE, {@code time} for DAYS_BEFORE / AT_TIME. */
    public record HeadsUp(String kind, Integer days, String time) {}
}
