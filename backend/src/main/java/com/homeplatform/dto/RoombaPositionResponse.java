package com.homeplatform.dto;

/**
 * Live robot position for the map dot. {@code x}/{@code y} are meters in the
 * same coordinate space as the map bundle GeoJSON; {@code theta} is the raw
 * heading in radians (treat as provisional — see maps.md). Only returned while
 * fresh; a stale/absent row surfaces as 204 from the controller.
 */
public record RoombaPositionResponse(
        String robotId,
        Double x,
        Double y,
        Double theta,
        String updatedAt
) {}
