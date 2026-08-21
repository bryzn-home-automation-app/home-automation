package com.homeplatform.dto;

/**
 * Rename a mapped room (and optionally set its category). {@code roomType} is a
 * RoomCategory wire value (snake_case, e.g. "living_room") or null to leave it
 * unchanged. At least one of {@code name}/{@code roomType} must be present — the
 * underlying robot API has no way to express "change nothing".
 */
public record RoombaRenameRoomRequest(String roomId, String name, String roomType) {}
