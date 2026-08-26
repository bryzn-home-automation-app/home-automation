package com.homeplatform.dto;

import java.util.List;

/**
 * Clean a set of rooms (multi-region clean). {@code roomIds} is the rooms to
 * clean — "clean everything" is simply every mapped room, "clean selection" is
 * a chosen subset (must be non-empty). {@code suction} is a level name
 * (low|medium|high|turbo) or null for the robot default; {@code passes} is
 * one|two or null for auto; {@code mode} is vacuum|mop|vacmop or null for the
 * robot default (Combo only).
 */
public record RoombaCleanRequest(List<String> roomIds, String suction, String passes, String mode) {}
