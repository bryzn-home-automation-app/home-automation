package com.homeplatform.dto;

/** A queued/processed control command, for the control panel's activity list. */
public record RoombaCommandResponse(
        Long id,
        String command,
        String arg,
        String status,
        String detail,
        String requestedBy,
        String createdAt,
        String processedAt
) {}
