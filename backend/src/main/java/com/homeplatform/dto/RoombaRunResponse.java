package com.homeplatform.dto;

import java.util.List;

/**
 * One historical mission. Timestamps are UTC ISO-8601 strings (with 'Z'). The
 * enrichment fields (missionId/missionNumber/error/errorText/initiator/cycle)
 * are populated for runs recorded after the run-detail work; older runs leave
 * them null. The history fields (chargeMinutes … settings) come from the cloud's
 * mission history and are null on a run it hasn't confirmed yet
 * ({@code verified} false).
 *
 * @param durationMinutes start to finish, including any recharge stops
 * @param rooms           names of the rooms the run was sent to (empty = whole home / unknown)
 * @param settings        e.g. "Vacuum · Turbo · 2 passes", from the first room's settings
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
        String source,
        Integer chargeMinutes,
        Integer evacuations,
        String doneCode,
        List<String> rooms,
        String settings,
        boolean verified
) {}
