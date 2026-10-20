package com.homeplatform.dto;

/** One battery history point. {@code at} is an ISO-8601 instant. */
public record CameraBatteryReadingResponse(
        String at,
        double percent,
        Boolean charging,
        String chargingStatus
) {}
