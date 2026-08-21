package com.homeplatform.model;

import jakarta.persistence.*;
import lombok.*;

import java.time.LocalDateTime;

/**
 * A queued control command. The backend enqueues (ADMIN only); the poller — which
 * owns the single robot connection — picks up PENDING rows, sends them, and updates
 * status (SENT → OK/FAILED). "OK" means the broker accepted it, not that the robot
 * necessarily acted (see the poller / ENHANCEMENTS.md "accepted ≠ done").
 */
@Entity
@Table(name = "roomba_commands")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class RoombaCommand {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "robot_id", length = 64)
    private String robotId;

    @Column(nullable = false, length = 40)
    private String command;

    @Column(length = 120)
    private String arg;

    @Column(nullable = false, length = 20)
    private String status;

    @Column(length = 500)
    private String detail;

    @Column(name = "requested_by", length = 120)
    private String requestedBy;

    @Column(name = "created_at", nullable = false)
    private LocalDateTime createdAt;

    @Column(name = "processed_at")
    private LocalDateTime processedAt;
}
