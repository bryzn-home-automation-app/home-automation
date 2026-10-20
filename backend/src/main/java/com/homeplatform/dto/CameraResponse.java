package com.homeplatform.dto;

/**
 * A camera exposed through Home Assistant. {@code id} is the app device ID, not the HA
 * entity ID. Battery fields are null for wired cameras ({@code powerSource} "wired")
 * and until a battery camera first reports. {@code charging} is null when the camera
 * doesn't report it — the UI infers it from the level's trend.
 */
public record CameraResponse(
        String id,
        String name,
        boolean available,
        String powerSource,
        Double batteryPercent,
        Boolean charging,
        String chargingStatus,
        String batteryUpdatedAt,
        String lastMotionAt,
        String lastPersonAt,
        boolean liveAvailable,
        String lastSeenAt
) {}
