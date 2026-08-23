package com.homeplatform.model;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.LocalDateTime;

/**
 * Live cleaning-coverage for a single robot (UNIQUE robot_id). The poller UPSERTs
 * the latest {@code coverage.geojson} pulled from the robot's live-map bundle
 * while a mission runs; the backend only reads it. {@code coverage} is a GeoJSON
 * FeatureCollection whose features carry an {@code operatingModes} property
 * (e.g. "vacuuming" = cleaned, "traveling" = passed through).
 */
@Entity
@Table(name = "roomba_coverage")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class RoombaCoverage {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "robot_id", nullable = false, unique = true, length = 64)
    private String robotId;

    /** Identifies the mission this coverage belongs to (resets each run). */
    @Column(name = "mission_id", length = 64)
    private String missionId;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(nullable = false)
    private String coverage;

    @Column(name = "updated_at", nullable = false)
    private LocalDateTime updatedAt;
}
