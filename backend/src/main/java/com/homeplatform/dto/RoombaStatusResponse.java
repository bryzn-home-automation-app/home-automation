package com.homeplatform.dto;

import com.fasterxml.jackson.databind.JsonNode;

import java.util.List;

/**
 * Live status card payload. {@code running}, {@code online}, {@code needsAttention}
 * and {@code attentionReasons} are derived (see {@code RoombaService}); {@code errorText}
 * / {@code dockText} are decoded by the poller; timestamps are ISO-8601 strings.
 */
public record RoombaStatusResponse(
        String robotId,
        String name,
        Integer batteryPct,
        String phase,
        String cycle,
        Integer error,
        String errorText,
        boolean running,
        Boolean binPresent,
        Boolean tankPresent,
        String currentMissionId,
        String missionStart,
        Integer sqft,
        Integer runtimeMinutes,
        Integer dockState,
        Integer dockError,
        String dockText,
        Integer notReady,
        String initiator,
        String detectedPad,
        Integer chargeCycles,
        Integer chargeErrors,
        String faultText,
        JsonNode wear,
        Integer lifetimeMissions,
        Integer lifetimeRunMinutes,
        String mapVersion,
        boolean online,
        boolean needsAttention,
        List<String> attentionReasons,
        String updatedAt
) {}
