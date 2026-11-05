package com.homeplatform.model;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.LocalDateTime;
import java.util.UUID;

/**
 * One completed Roomba mission. The poller INSERTs a row when it sees a mission
 * end, then overwrites it with the cloud's mission history (source
 * "irobot-history"), which has the robot's own totals, outcome and rooms; runs
 * the poller missed are inserted from the history. Rows are never deleted.
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

    @Column(name = "mission_id", length = 64)
    private String missionId;

    @Column(name = "mission_number")
    private Integer missionNumber;

    @Column(name = "error")
    private Integer error;

    @Column(name = "error_text", length = 255)
    private String errorText;

    @Column(length = 40)
    private String initiator;

    @Column(length = 40)
    private String cycle;

    /** Minutes docked to recharge mid-mission (history only; included in durationMinutes). */
    @Column(name = "charge_minutes")
    private Integer chargeMinutes;

    @Column(name = "pause_minutes")
    private Integer pauseMinutes;

    /** Times the dock emptied the bin during the run. */
    @Column(name = "evacuations")
    private Integer evacuations;

    /** The cloud's raw outcome code (ok, stuck, cncl, usrEnd …). */
    @Column(name = "done_code", length = 20)
    private String doneCode;

    /** Rooms/zones the run was sent to: [{id, type, suction, twoPass, mode}]. */
    @JdbcTypeCode(SqlTypes.JSON)
    private String regions;

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
