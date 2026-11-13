package com.homeplatform.model;

import jakarta.persistence.*;
import lombok.*;

import java.time.LocalDate;
import java.time.LocalDateTime;

/**
 * One skipped scheduled clean. The robot's schedules live in iRobot's cloud, which has no
 * "skip once", so the poller switches the schedule off across the skipped start and back on
 * afterwards (roomba-poller/schedule_skips.py has the rules). The backend creates the row
 * and may ask for an undo; from then on only the poller moves {@code state}:
 * PENDING → APPLYING → APPLIED → RESTORED, or CANCELLED / FAILED. Plain VARCHAR states,
 * never a DB enum (ddl-auto never updates an enum's CHECK constraint).
 *
 * <p>Times are UTC wall clock like the other roomba_* rows; {@code skipDate} and the hour
 * and minute are the home's (America/Chicago), as the schedule itself counts them.
 */
@Entity
@Table(name = "roomba_schedule_skips")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class RoombaScheduleSkip {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "robot_id", length = 64)
    private String robotId;

    /** The schedule's container in the cloud (what the poller's write addresses). */
    @Column(name = "household_schedule_id", nullable = false, length = 160)
    private String householdScheduleId;

    /** The schedule inside that container (options.schedule_id); null = its only one. */
    @Column(name = "schedule_id", length = 160)
    private String scheduleId;

    @Column(name = "skip_date", nullable = false)
    private LocalDate skipDate;

    @Column(name = "schedule_hour", nullable = false)
    private Integer scheduleHour;

    @Column(name = "schedule_minute", nullable = false)
    private Integer scheduleMinute;

    /** The skipped start, UTC. */
    @Column(name = "scheduled_for", nullable = false)
    private LocalDateTime scheduledFor;

    /** From here the poller switches the schedule back on, UTC. */
    @Column(name = "restore_after", nullable = false)
    private LocalDateTime restoreAfter;

    @Column(nullable = false, length = 20)
    private String state;

    /** The schedule's on/off flag when the poller switched it off (true: it was on). */
    @Column(name = "original_enabled")
    private Boolean originalEnabled;

    @Column(length = 500)
    private String detail;

    @Column(name = "requested_by", length = 120)
    private String requestedBy;

    @Column(name = "created_at", nullable = false)
    private LocalDateTime createdAt;

    @Column(name = "applied_at")
    private LocalDateTime appliedAt;

    @Column(name = "finished_at")
    private LocalDateTime finishedAt;

    @Column(name = "undo_requested_at")
    private LocalDateTime undoRequestedAt;

    @Column(name = "undo_requested_by", length = 120)
    private String undoRequestedBy;

    /** When the poller next looks at it (a step due, a retry, a routine look). */
    @Column(name = "next_check_at")
    private LocalDateTime nextCheckAt;

    /** Failed cloud reads/writes in a row. */
    @Column(nullable = false)
    private Integer attempts;

    @Column(name = "last_error", length = 500)
    private String lastError;

    /** When the admins were told it failed (once per skip). */
    @Column(name = "alerted_at")
    private LocalDateTime alertedAt;

    @Column(name = "updated_at", nullable = false)
    private LocalDateTime updatedAt;
}
