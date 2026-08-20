package com.homeplatform.dto;

/**
 * One historical mission. Timestamps are ISO-8601 strings. {@code missionId}
 * has no backing column on {@code roomba_runs} yet, so it is currently null.
 */
public record RoombaRunResponse(
        Long id,
        String startedAt,
        String completedAt,
        Integer durationMinutes,
        Integer squareFeet,
        String status,
        String missionId
) {}
