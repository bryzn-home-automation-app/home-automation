package com.homeplatform.model;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDate;
import java.time.LocalDateTime;

/** One occurrence (due date) of a reminder marked done, for the whole household: who and when. */
@Entity
@Table(name = "reminder_completions",
        uniqueConstraints = @UniqueConstraint(name = "uk_reminder_completion", columnNames = {"reminder_id", "occurrence_date"}))
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ReminderCompletion {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "reminder_id", nullable = false)
    private Long reminderId;

    @Column(name = "occurrence_date", nullable = false)
    private LocalDate occurrenceDate;

    @Column(name = "user_id")
    private Long userId;

    @Column(name = "completed_at", nullable = false)
    private LocalDateTime completedAt;
}
