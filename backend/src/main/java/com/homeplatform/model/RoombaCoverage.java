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
 *
 * <p>The cloud's coverage has no pass count, so the poller also counts passes from
 * the live position stream (roomba-poller/coverage_passes.py) and writes them onto
 * this row: {@code passes} is the area cleaned twice or more, as
 * {@code {"v":1,"cell":0.05,"rects":[[ix,iy,w,h],...]}} in grid cells (metres =
 * value * cell), for the mission {@code passesMissionId}. The poller also keeps the
 * full grid in a {@code pass_grid} column (to carry on after a restart); the
 * backend never reads it, so it isn't mapped here (see schema.sql).
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

    /** Area cleaned twice or more this mission (null until the poller has counted any). */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "passes")
    private String passes;

    /** The mission {@link #passes} belongs to: its start, epoch seconds (as mission_id is). */
    @Column(name = "passes_mission_id", length = 64)
    private String passesMissionId;

    @Column(name = "passes_updated_at")
    private LocalDateTime passesUpdatedAt;
}
