package com.homeplatform.model;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.LocalDateTime;

/**
 * Current floor-plan map bundle for a single robot. The poller UPSERTs when the
 * map_version changes (UNIQUE robot_id); the backend only reads it.
 */
@Entity
@Table(name = "roomba_map")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class RoombaMap {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "robot_id", nullable = false, unique = true, length = 64)
    private String robotId;

    @Column(name = "map_id", length = 80)
    private String mapId;

    @Column(name = "map_version", length = 64)
    private String mapVersion;

    @Column(length = 120)
    private String name;

    /**
     * Parsed GeoJSON bundle ({@code {manifest?, metadata?, rooms, borders, floorPlan,
     * dockPose}}) stored as JSON (jsonb on Postgres). Passed through unchanged by the API.
     */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(nullable = false)
    private String geojson;

    @Column(name = "updated_at", nullable = false)
    private LocalDateTime updatedAt;
}
