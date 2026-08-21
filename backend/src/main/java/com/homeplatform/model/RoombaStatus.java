package com.homeplatform.model;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.LocalDateTime;

/**
 * Latest live-status snapshot for a single robot. The poller UPSERTs one row
 * per robot (UNIQUE robot_id); the backend only reads it.
 */
@Entity
@Table(name = "roomba_status")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class RoombaStatus {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "robot_id", nullable = false, unique = true, length = 64)
    private String robotId;

    @Column(length = 120)
    private String name;

    @Column(name = "battery_pct")
    private Integer batteryPct;

    @Column(length = 40)
    private String phase;

    @Column(length = 40)
    private String cycle;

    @Column
    private Integer error;

    @Column(name = "error_text", length = 255)
    private String errorText;

    @Column(name = "bin_present")
    private Boolean binPresent;

    @Column(name = "tank_present")
    private Boolean tankPresent;

    @Column(name = "current_mission_id", length = 64)
    private String currentMissionId;

    @Column(name = "mission_start")
    private LocalDateTime missionStart;

    @Column
    private Integer sqft;

    @Column(name = "runtime_minutes")
    private Integer runtimeMinutes;

    @Column(name = "dock_state")
    private Integer dockState;

    @Column(name = "dock_error")
    private Integer dockError;

    @Column(name = "dock_text", length = 120)
    private String dockText;

    @Column(name = "not_ready")
    private Integer notReady;

    @Column(length = 40)
    private String initiator;

    @Column(name = "detected_pad", length = 40)
    private String detectedPad;

    @Column(name = "charge_cycles")
    private Integer chargeCycles;

    @Column(name = "charge_errors")
    private Integer chargeErrors;

    @Column(name = "fault_text", length = 255)
    private String faultText;

    /** Wear/stall/cliff counters (bbrun) as stored JSON; passed through to the API. */
    @JdbcTypeCode(SqlTypes.JSON)
    private String wear;

    @Column(name = "lifetime_missions")
    private Integer lifetimeMissions;

    @Column(name = "lifetime_run_minutes")
    private Integer lifetimeRunMinutes;

    @Column(name = "map_version", length = 64)
    private String mapVersion;

    /** Full shadow payload as stored JSON (jsonb on Postgres). Not exposed by the API. */
    @JdbcTypeCode(SqlTypes.JSON)
    private String raw;

    @Column(name = "updated_at", nullable = false)
    private LocalDateTime updatedAt;
}
