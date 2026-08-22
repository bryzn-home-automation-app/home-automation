package com.homeplatform.dto;

import java.util.List;

/**
 * Combine two or more mapped rooms into one (the inverse of a divide). {@code roomIds}
 * are the map's room_ids to merge (at least two). EXPERIMENTAL: never validated on
 * hardware and not cleanly reversible.
 */
public record RoombaMergeRoomsRequest(List<String> roomIds) {}
