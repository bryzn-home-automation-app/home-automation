package com.homeplatform.model;

import jakarta.persistence.*;
import lombok.*;

import java.time.LocalDateTime;

/**
 * Latest live position for a single robot. The poller UPSERTs one row per robot
 * (UNIQUE robot_id) from {@code watch_live_map()} while a mission runs; the
 * backend only reads it (and gates it on freshness). {@code x}/{@code y} are
 * meters in the same coordinate space as the stored map bundle GeoJSON;
 * {@code theta} is the raw wire heading in radians.
 */
@Entity
@Table(name = "roomba_position")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class RoombaPosition {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "robot_id", nullable = false, unique = true, length = 64)
    private String robotId;

    @Column
    private Double x;

    @Column
    private Double y;

    @Column
    private Double theta;

    @Column(name = "updated_at", nullable = false)
    private LocalDateTime updatedAt;
}
