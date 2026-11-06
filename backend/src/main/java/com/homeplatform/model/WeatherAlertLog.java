package com.homeplatform.model;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

/**
 * Each weather check already made for a member, so it's made once: a daily forecast
 * check is keyed by its check time ("2026-11-05T20:00"), a National Weather Service
 * warning by its id. {@code sent} says whether it turned into an alert.
 */
@Entity
@Table(name = "weather_alert_log",
        uniqueConstraints = @UniqueConstraint(columnNames = {"user_id", "alert_type", "alert_key"}))
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class WeatherAlertLog {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "user_id", nullable = false)
    private Long userId;

    @Enumerated(EnumType.STRING)
    @Column(name = "alert_type", nullable = false, length = 40)
    private AlertType alertType;

    @Column(name = "alert_key", nullable = false, length = 255)
    private String alertKey;

    @Column(nullable = false)
    private boolean sent;

    @Column(name = "created_at", nullable = false)
    @Builder.Default
    private LocalDateTime createdAt = LocalDateTime.now();
}
