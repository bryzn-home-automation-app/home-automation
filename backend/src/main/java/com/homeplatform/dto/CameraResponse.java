package com.homeplatform.dto;

/** A camera exposed through Home Assistant. {@code id} is the app device ID, not the HA entity ID. */
public record CameraResponse(
        String id,
        String name,
        String lastSeenAt
) {}
