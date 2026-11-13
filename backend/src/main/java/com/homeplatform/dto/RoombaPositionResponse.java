package com.homeplatform.dto;

/**
 * Robot position for the map. {@code x}/{@code y} are meters in the
 * same coordinate space as the map bundle GeoJSON; {@code theta} is the raw
 * heading in radians (treat as provisional — see maps.md). {@code /position}
 * returns it only while fresh (the live dot; a stale/absent row is a 204);
 * {@code /position/last} returns it whatever its age (the "last seen" marker).
 */
public record RoombaPositionResponse(
        String robotId,
        Double x,
        Double y,
        Double theta,
        String updatedAt
) {}
