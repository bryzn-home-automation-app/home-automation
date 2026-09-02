package com.homeplatform.dto;

import java.util.List;

/**
 * Create/update payload for a recurring cleaning schedule.
 *
 * @param name       display name (required)
 * @param enabled    whether the schedule is active (defaults to true when null)
 * @param daysOfWeek ISO-8601 day numbers (1 = Monday … 7 = Sunday), at least one
 * @param time       local (America/Chicago) time-of-day as "HH:mm"
 * @param targetType WHOLE_HOUSE or ROOMS
 * @param roomIds    selected room ids (required + non-empty when targetType = ROOMS)
 * @param roomLabels selected rooms' display labels (for the UI list; optional)
 * @param suction    level name low|medium|high|turbo, or null for the robot default
 * @param passes     one|two, or null for auto
 * @param mode       vacuum|mop|vacmop, or null for the robot default (Combo only)
 */
public record RoombaScheduleRequest(
        String name,
        Boolean enabled,
        List<Integer> daysOfWeek,
        String time,
        String targetType,
        List<String> roomIds,
        List<String> roomLabels,
        String suction,
        String passes,
        String mode) {}
