package com.homeplatform.dto;

import java.util.List;

/**
 * Divide a mapped room in two along a user-drawn line. {@code points} are [x, y]
 * pairs in the map's meter coordinate space (at least two — the endpoints of the
 * divide line). EXPERIMENTAL: never validated on hardware and not cleanly reversible.
 */
public record RoombaSplitRoomRequest(String roomId, List<List<Double>> points) {}
