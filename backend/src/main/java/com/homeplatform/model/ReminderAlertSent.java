package com.homeplatform.model;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDate;
import java.time.LocalDateTime;

/**
 * A heads-up already handled for one occurrence, so it goes out once, even across restarts
 * (the unique key is the dedupe). {@code sent} is false for one passed over: after downtime
 * only the latest due heads-up of an occurrence is sent.
 */
@Entity
@Table(name = "reminder_alerts_sent",
        uniqueConstraints = @UniqueConstraint(name = "uk_reminder_alert", columnNames = {"reminder_id", "occurrence_date", "heads_up_key"}))
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ReminderAlertSent {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "reminder_id", nullable = false)
    private Long reminderId;

    @Column(name = "occurrence_date", nullable = false)
    private LocalDate occurrenceDate;

    @Column(name = "heads_up_key", nullable = false, length = 40)
    private String headsUpKey;

    @Column(nullable = false)
    private boolean sent;

    @Column(name = "sent_at", nullable = false)
    private LocalDateTime sentAt;
}
