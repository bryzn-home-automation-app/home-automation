package com.homeplatform.dto;

import java.util.List;

/**
 * A reminder with its rule and where it stands now. {@code occurrence} is the due date being
 * worked towards (the first whose done-by time is still ahead), done or not; when it's done,
 * {@code nextOccurrence} is the one after. Dates "2026-11-13", times "HH:mm", moments
 * "2026-11-12T14:00" (home wall clock).
 */
public record ReminderResponse(Long id, String name, String note, String repeat, List<String> weekdays,
                               Integer dayOfMonth, String date, String dueBy, List<HeadsUp> headsUps,
                               boolean alerts, Occurrence occurrence, Occurrence nextOccurrence,
                               String createdBy, String updatedAt) {

    /** {@code time} is resolved for presets too, so a page can say "2:00 PM". */
    public record HeadsUp(String key, String kind, String label, int days, String time) {}

    /** {@code visible}: on Home right now (inside its window and not done). */
    public record Occurrence(String date, String showFrom, String dueAt, boolean visible, boolean completed,
                             String completedBy, String completedAt) {}
}
