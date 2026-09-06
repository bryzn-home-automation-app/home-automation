package com.homeplatform.dto;

import java.util.List;

/**
 * Display-ready view of a real (robot/cloud-side) schedule. Derived from the raw
 * ScheduleOptions JSON at read time — see {@code RoombaService#getNativeSchedules()}.
 */
public record RoombaNativeScheduleResponse(
        String householdScheduleId,
        String name,
        String frequency,
        List<Integer> days,      // ISO weekday numbers, 1=Mon..7=Sun (confirmed on hardware)
        Integer hour,
        Integer minute,
        boolean enabled,
        int roomCount,
        List<Integer> operatingModes,  // distinct vendor mode codes used across this schedule's regions
        String updatedAt
) {
}
