package com.homeplatform.model;

import jakarta.persistence.*;
import lombok.*;

import java.time.LocalDateTime;
import java.util.UUID;

/**
 * One thermostat history point. Append-only: rows are INSERTed on meaningful state
 * changes and by the periodic snapshot; never updated or deleted. Timestamps are UTC.
 */
@Entity
@Table(name = "thermostat_readings")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ThermostatReading {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "device_id", nullable = false)
    private Long deviceId;

    @Column(name = "recorded_at", nullable = false)
    private LocalDateTime recordedAt;

    private Double temperature;

    private Double humidity;

    @Column(name = "target_temperature")
    private Double targetTemperature;

    @Column(name = "heat_setpoint")
    private Double heatSetpoint;

    @Column(name = "cool_setpoint")
    private Double coolSetpoint;

    @Column(name = "hvac_mode", length = 30)
    private String hvacMode;

    @Column(name = "hvac_action", length = 30)
    private String hvacAction;

    @Column(name = "preset_mode", length = 60)
    private String presetMode;

    @Column(name = "temperature_unit", length = 5)
    private String temperatureUnit;

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
