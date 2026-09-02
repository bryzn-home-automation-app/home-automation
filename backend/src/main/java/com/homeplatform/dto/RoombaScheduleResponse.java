package com.homeplatform.dto;

import java.util.List;

/**
 * A recurring cleaning schedule as returned to the client. {@code time} is the
 * local "HH:mm"; {@code daysOfWeek} are ISO-8601 day numbers (1 = Monday …
 * 7 = Sunday); timestamps are UTC ISO-8601.
 */
public record RoombaScheduleResponse(
        Long id,
        String name,
        boolean enabled,
        List<Integer> daysOfWeek,
        String time,
        String targetType,
        List<String> roomIds,
        List<String> roomLabels,
        String suction,
        String passes,
        String mode,
        String lastFiredAt,
        String createdAt) {}
