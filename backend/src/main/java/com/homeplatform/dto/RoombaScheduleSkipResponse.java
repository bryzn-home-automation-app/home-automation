package com.homeplatform.dto;

/**
 * A skipped scheduled clean for the Roomba page. {@code date}, {@code hour} and {@code minute}
 * are the home's clock; the instants are ISO-8601 UTC. {@code state}: PENDING (the schedule
 * isn't switched off yet) · APPLYING · APPLIED (off until {@code restoreAfter}) · RESTORED ·
 * CANCELLED · FAILED.
 */
public record RoombaScheduleSkipResponse(
        Long id,
        String householdScheduleId,
        String scheduleId,
        String date,
        int hour,
        int minute,
        String scheduledFor,
        String restoreAfter,
        String state,
        String detail,
        String lastError,
        boolean undoRequested,
        String requestedBy,
        String createdAt,
        String appliedAt,
        String finishedAt
) {}
