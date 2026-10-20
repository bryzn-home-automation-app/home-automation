package com.homeplatform.dto;

/** Admin view of a discovered device. Deliberately omits the HA entity ID. */
public record SmartDeviceResponse(
        String id,
        String kind,
        String name,
        boolean enabled,
        String lastSeenAt
) {}
