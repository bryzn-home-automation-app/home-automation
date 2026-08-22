package com.homeplatform.dto;

/**
 * One historical mission. Timestamps are UTC ISO-8601 strings (with 'Z'). The
 * enrichment fields (missionId/missionNumber/error/errorText/initiator/cycle)
 * are populated for runs recorded after the run-detail work; older runs leave
 * them null.
 */
public record RoombaRunResponse(
        Long id,
        String startedAt,
        String completedAt,
        Integer durationMinutes,
        Integer squareFeet,
        String status,
        String missionId,
        Integer missionNumber,
        Integer error,
        String errorText,
        String initiator,
        String cycle,
        String source
) {}
