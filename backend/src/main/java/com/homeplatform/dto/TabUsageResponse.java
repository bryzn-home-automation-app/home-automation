package com.homeplatform.dto;

import java.time.Instant;
import java.util.List;

/**
 * Tab usage over the last {@code days}, per member and for the household as a whole.
 * Active minutes come from the app's heartbeat, sent once a minute while a page is
 * visible and in use. Visits count each time a member opens a tab.
 */
public record TabUsageResponse(int days, List<TabTotal> household, List<Member> members) {

    public record TabTotal(String tab, long visits, long activeMinutes) {}

    public record Member(Long userId, String username, String displayName, String role,
                         Instant lastActiveAt, long visits, long activeMinutes, List<TabTotal> tabs) {}
}
