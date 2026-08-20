package com.homeplatform.model;

import jakarta.persistence.*;
import lombok.*;

import java.time.LocalDateTime;
import java.util.UUID;

/**
 * One completed Roomba mission. Append-only: the poller INSERTs a row per
 * completed mission; rows are never updated or deleted.
 */
@Entity
@Table(name = "roomba_runs")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class RoombaRun {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "started_at", nullable = false)
    private LocalDateTime startedAt;

    @Column(name = "completed_at")
    private LocalDateTime completedAt;

    @Column(name = "duration_minutes")
    private Integer durationMinutes;

    @Column(name = "dirt_events")
    private Integer dirtEvents;

    @Column(name = "square_feet")
    private Integer squareFeet;

    @Column(length = 50)
    private String status;

    @Column(length = 100)
    private String source;

    @Column(name = "source_provider", length = 50)
    private String sourceProvider;

    @Column(name = "ingestion_batch_id")
    private UUID ingestionBatchId;

    @Column(name = "processing_version", length = 20)
    private String processingVersion;

    @Column(name = "created_at")
    private LocalDateTime createdAt;
}
