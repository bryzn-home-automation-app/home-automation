package com.homeplatform.dto;

/**
 * Clean one specific room (region clean). {@code suction} is a level name
 * (low|medium|high|turbo) or null for the robot default; {@code passes} is
 * one|two or null for auto. This is confirmed working on the Combo 105.
 */
public record RoombaCleanRoomRequest(String roomId, String suction, String passes) {}
