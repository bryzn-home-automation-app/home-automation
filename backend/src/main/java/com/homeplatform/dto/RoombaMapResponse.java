package com.homeplatform.dto;

import com.fasterxml.jackson.databind.JsonNode;

/**
 * Floor-plan map payload. {@code geojson} is the stored map bundle passed
 * through unchanged as a parsed JSON object (not a double-encoded string).
 */
public record RoombaMapResponse(
        String robotId,
        String mapId,
        String mapVersion,
        String name,
        JsonNode geojson,
        String updatedAt
) {}
