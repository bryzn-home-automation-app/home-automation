package com.homeplatform.model;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

/**
 * One member's choice for one {@link AlertType}. Only types someone changed have a row;
 * the rest follow the type's defaults.
 */
@Entity
@Table(name = "notification_preferences",
        uniqueConstraints = @UniqueConstraint(columnNames = {"user_id", "alert_type"}))
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class NotificationPreference {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "user_id", nullable = false)
    private Long userId;

    @Enumerated(EnumType.STRING)
    @Column(name = "alert_type", nullable = false, length = 40)
    private AlertType alertType;

    /** Shown in the Alerts list. Off means the alert isn't created for this member at all. */
    @Column(name = "in_app", nullable = false)
    private boolean inApp;

    /** Also pushed to their phone (only when {@link #inApp}). */
    @Column(nullable = false)
    private boolean push;

    @Column(name = "updated_at", nullable = false)
    @Builder.Default
    private LocalDateTime updatedAt = LocalDateTime.now();
}
