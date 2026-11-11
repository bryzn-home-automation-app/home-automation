package com.homeplatform.model;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;

/**
 * A household reminder for a recurring chore (Reminders page), shared by every member.
 * The rule and heads-ups are plain strings (see schema.sql and
 * {@code ReminderSchedule}), not enums: Hibernate's enum CHECK constraints never learn
 * new values. Times are the home's wall clock (America/Chicago).
 */
@Entity
@Table(name = "reminders")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class Reminder {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 60)
    private String name;

    @Column(length = 200)
    private String note;

    /** WEEKLY, MONTHLY or ONCE. */
    @Column(name = "repeat_kind", nullable = false, length = 10)
    private String repeatKind;

    /** WEEKLY: "MON,FRI". */
    @Column(length = 30)
    private String weekdays;

    /** MONTHLY: 1–31 (past the end of a short month = its last day). */
    @Column(name = "day_of_month")
    private Integer dayOfMonth;

    /** ONCE: the day. */
    @Column(name = "once_date")
    private LocalDate onceDate;

    /** Done by this time on the due day; null = by the end of the day. */
    @Column(name = "due_by")
    private LocalTime dueBy;

    /** Comma list of heads-up keys ({@code ReminderSchedule.HeadsUp#key()}). */
    @Column(name = "heads_ups", nullable = false, length = 500)
    @Builder.Default
    private String headsUps = "";

    /** Alerts (in-app + phone) at each heads-up; off = it only shows on Home. */
    @Column(name = "alerts_enabled", nullable = false)
    @Builder.Default
    private boolean alertsEnabled = true;

    /** Heads-ups due before this (the last edit) aren't sent: nobody needs a 6 PM alert set up at 7 PM. */
    @Column(name = "alerts_from", nullable = false)
    private LocalDateTime alertsFrom;

    @Column(name = "created_by")
    private Long createdBy;

    @Column(name = "created_at", nullable = false)
    private LocalDateTime createdAt;

    @Column(name = "updated_by")
    private Long updatedBy;

    @Column(name = "updated_at", nullable = false)
    private LocalDateTime updatedAt;
}
