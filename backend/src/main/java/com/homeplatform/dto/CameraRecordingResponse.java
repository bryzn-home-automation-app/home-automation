package com.homeplatform.dto;

/**
 * A recording the camera's HomeBase stored (full quality, played back from the app).
 * {@code cameraId} is the app device ID; times are ISO-8601 with the station's offset.
 */
public record CameraRecordingResponse(
        String id,
        String cameraId,
        String cameraName,
        String startedAt,
        String endedAt,
        Long durationMs,
        long sizeBytes,
        boolean hasThumbnail
) {}
