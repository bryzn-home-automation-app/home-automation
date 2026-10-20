package com.homeplatform.model;

import jakarta.persistence.*;
import lombok.*;

import java.time.LocalDateTime;
import java.util.UUID;

/**
 * One battery history point for a battery camera. Append-only: rows are INSERTed when
 * the level or charging state changes and by the periodic snapshot; never updated or
 * deleted. Timestamps are UTC.
 */
@Entity
@Table(name = "camera_battery_readings")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class CameraBatteryReading {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "device_id", nullable = false)
    private Long deviceId;

    @Column(name = "recorded_at", nullable = false)
    private LocalDateTime recordedAt;

    @Column(name = "battery_percent", nullable = false)
    private Double batteryPercent;

    private Boolean charging;

    @Column(name = "charging_status", length = 60)
    private String chargingStatus;

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
