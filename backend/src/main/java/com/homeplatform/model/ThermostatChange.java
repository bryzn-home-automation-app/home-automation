package com.homeplatform.model;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;
import java.util.UUID;

/**
 * One detected change to a thermostat's setpoint, mode, or hold, and who made it.
 * Append-only. Values are the state after the change; timestamps are UTC.
 */
@Entity
@Table(name = "thermostat_changes")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ThermostatChange {

    /** Who changed it — see {@code schema.sql} for the meaning of each. */
    public enum ActorType { APP, HOME_ASSISTANT, ECOBEE }

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "device_id", nullable = false)
    private Long deviceId;

    @Column(name = "changed_at", nullable = false)
    private LocalDateTime changedAt;

    /** Comma-separated subset of {@code setpoint,mode,preset}. */
    @Column(name = "changed_fields", nullable = false, length = 60)
    private String changedFields;

    @Enumerated(EnumType.STRING)
    @Column(name = "actor_type", nullable = false, length = 20)
    private ActorType actorType;

    @Column(name = "actor_user_id")
    private Long actorUserId;

    @Column(name = "actor_name", nullable = false, length = 120)
    private String actorName;

    @Column(name = "hvac_mode", length = 30)
    private String hvacMode;

    @Column(name = "preset_mode", length = 60)
    private String presetMode;

    @Column(name = "target_temperature")
    private Double targetTemperature;

    @Column(name = "heat_setpoint")
    private Double heatSetpoint;

    @Column(name = "cool_setpoint")
    private Double coolSetpoint;

    @Column(nullable = false, length = 100)
    private String source;

    @Column(name = "source_provider", nullable = false, length = 50)
    private String sourceProvider;

    @Column(name = "ingestion_batch_id")
    private UUID ingestionBatchId;

    @Column(name = "processing_version", nullable = false, length = 20)
    @Builder.Default
    private String processingVersion = "1.0";

    @Column(name = "created_at", nullable = false)
    private LocalDateTime createdAt;
}
