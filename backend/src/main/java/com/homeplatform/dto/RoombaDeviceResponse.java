package com.homeplatform.dto;

/** Static device identity + firmware for the dashboard header. */
public record RoombaDeviceResponse(
        String robotId,
        String sku,
        String series,
        String family,
        String serialNumber,
        String firmware,
        String updatedAt
) {}
