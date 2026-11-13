package com.homeplatform.dto;

/**
 * What the Roomba's dock is complaining about (roomba_status.dock_issue*), or null on the
 * status when nothing. {@code kind} is the poller's decoded key (clean_water_empty,
 * clean_water_out, dirty_water_full, dirty_water_out, bag, mop, or other for a code nobody
 * has decoded); {@code code} the dock's own number; {@code since} when it began (ISO-8601 UTC).
 * The page and the alerts word it (utils/roombaStatus.ts, {@code RoombaDock}).
 */
public record RoombaDockIssue(String kind, Integer code, String since) {}
