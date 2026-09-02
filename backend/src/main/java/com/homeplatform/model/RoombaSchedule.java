package com.homeplatform.model;

import jakarta.persistence.*;
import lombok.*;

import java.time.LocalDateTime;
import java.time.LocalTime;

/**
 * An app-managed recurring cleaning schedule. A {@code @Scheduled} job fires the
 * matching clean (whole-house or a chosen room set) at {@link #timeOfDay} on each
 * selected weekday, reusing the same {@code roomba_commands} queue + command shapes
 * as the manual "Start a clean" UI. The poller (which owns the robot connection)
 * drains the enqueued command exactly as it does for a manually-triggered clean.
 *
 * <p>Table auto-creates under the app's {@code ddl-auto: update}.
 */
@Entity
@Table(name = "roomba_schedules")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class RoombaSchedule {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 120)
    private String name;

    @Column(nullable = false)
    private boolean enabled;

    /**
     * Which weekdays this schedule fires on, as a CSV of ISO-8601 day numbers
     * (1 = Monday … 7 = Sunday), e.g. "1,3,5". Never empty for a valid schedule.
     */
    @Column(name = "days_of_week", nullable = false, length = 32)
    private String daysOfWeek;

    /** Local (America/Chicago) wall-clock time of day the clean fires. */
    @Column(name = "time_of_day", nullable = false)
    private LocalTime timeOfDay;

    /** WHOLE_HOUSE (every mapped room, start fallback) or ROOMS (a chosen subset). */
    @Column(name = "target_type", nullable = false, length = 20)
    private String targetType;

    /** CSV of selected room ids (only for target_type = ROOMS). */
    @Column(name = "room_ids", length = 1024)
    private String roomIds;

    /** CSV of the selected rooms' display labels at save time (for the UI list). */
    @Column(name = "room_labels", length = 1024)
    private String roomLabels;

    /** Suction level name (low|medium|high|turbo) or null for the robot default. */
    @Column(length = 16)
    private String suction;

    /** Passes (one|two) or null for auto. */
    @Column(length = 8)
    private String passes;

    /** Operating mode (vacuum|mop|vacmop) or null for the robot default (Combo only). */
    @Column(length = 16)
    private String mode;

    /**
     * UTC minute-start of the last fire. The scheduler compares this against the
     * current minute to guarantee a schedule fires at most once per matching
     * minute (idempotent across restarts / double ticks).
     */
    @Column(name = "last_fired_at")
    private LocalDateTime lastFiredAt;

    @Column(name = "created_at", nullable = false)
    private LocalDateTime createdAt;
}
