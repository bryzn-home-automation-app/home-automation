package com.homeplatform.model;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;
import java.time.LocalTime;

/**
 * One member's timing and limit for one weather alert (whether it's on lives in
 * {@link NotificationPreference}, like every other alert type). Only alerts someone
 * adjusted have a row; the rest use the rule's defaults.
 */
@Entity
@Table(name = "weather_alert_settings",
        uniqueConstraints = @UniqueConstraint(columnNames = {"user_id", "alert_type"}))
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class WeatherAlertSetting {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "user_id", nullable = false)
    private Long userId;

    @Enumerated(EnumType.STRING)
    @Column(name = "alert_type", nullable = false, length = 40)
    private AlertType alertType;

    /** When the forecast is checked each day (Central time). */
    @Column(name = "check_at")
    private LocalTime checkAt;

    /** The check covers the hours from {@link #checkAt} until this time, at most 24 hours on. */
    @Column(name = "until_time")
    private LocalTime until;

    /** The rule's limit: % chance of rain, °F, mph gusts, or the warning level. */
    private Integer threshold;

    @Column(name = "updated_at", nullable = false)
    @Builder.Default
    private LocalDateTime updatedAt = LocalDateTime.now();
}
