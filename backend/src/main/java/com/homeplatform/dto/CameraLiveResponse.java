package com.homeplatform.dto;

/**
 * Where to open a live view: a same-origin WebSocket path carrying a short-lived
 * ticket. Must be opened before {@code expiresAt}; the stream itself isn't cut then.
 */
public record CameraLiveResponse(
        String url,
        String expiresAt
) {}
