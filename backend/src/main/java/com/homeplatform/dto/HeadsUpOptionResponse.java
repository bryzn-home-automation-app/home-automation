package com.homeplatform.dto;

/**
 * A heads-up choice for the add/edit form. Presets carry their day ({@code daysBefore}, 1 = the
 * day before, 0 = on the day) and clock time ("14:00"); {@code custom} ones take the member's
 * own number of days and/or time ({@code time} is then the suggested one, or null).
 */
public record HeadsUpOptionResponse(String kind, String label, Integer daysBefore, String time, boolean custom) {}
