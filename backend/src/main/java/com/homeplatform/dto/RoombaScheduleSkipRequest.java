package com.homeplatform.dto;

/** Skip one scheduled clean: which schedule, and the day of the clean at home (YYYY-MM-DD). */
public record RoombaScheduleSkipRequest(String householdScheduleId, String date) {}
