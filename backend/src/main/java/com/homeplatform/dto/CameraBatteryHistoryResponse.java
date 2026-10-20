package com.homeplatform.dto;

import java.util.List;

/**
 * Battery readings (oldest first) plus the daylight windows in the same range, so the
 * chart can shade night. {@code daylight} is empty when the property location isn't set.
 */
public record CameraBatteryHistoryResponse(
        List<CameraBatteryReadingResponse> readings,
        List<Window> daylight
) {
    public record Window(String from, String to) {}
}
