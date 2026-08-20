package com.homeplatform.dto;

/**
 * Live status card payload. {@code running} and {@code online} are derived
 * (see {@code RoombaService}); timestamps are ISO-8601 strings.
 */
public record RoombaStatusResponse(
        String robotId,
        String name,
        Integer batteryPct,
        String phase,
        String cycle,
        Integer error,
        boolean running,
        Boolean binPresent,
        Boolean tankPresent,
        String currentMissionId,
        String missionStart,
        Integer sqft,
        Integer runtimeMinutes,
        Integer dockState,
        Integer lifetimeMissions,
        Integer lifetimeRunMinutes,
        String mapVersion,
        boolean online,
        String updatedAt
) {}
