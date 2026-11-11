package com.homeplatform.dto;

/**
 * A reminder showing on Home now: its due date ("2026-11-13"), done-by time ("08:00", null =
 * end of day) and when its window opened and closes (home wall clock).
 */
public record DueReminderResponse(Long id, String name, String note, String date, String dueBy,
                                  String showFrom, String dueAt) {}
