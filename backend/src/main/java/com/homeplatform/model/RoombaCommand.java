package com.homeplatform.model;

import jakarta.persistence.*;
import lombok.*;

import java.time.LocalDateTime;

/**
 * A queued control command. The backend enqueues (ADMIN only); an insert trigger NOTIFYs
 * the poller — which owns the single robot connection — and it picks up PENDING rows,
 * sends them, and updates status (SENT → OK/FAILED). A robot command whose effect shows in
 * the robot's state (pause, resume, stop, dock, a clean from idle) stays SENT until the
 * poller reads the robot reacting, then OK; if it never does, FAILED with the reason. For
 * the rest "OK" means the broker accepted it, not that the robot necessarily acted (see
 * roomba-poller/command_flow.py and ENHANCEMENTS.md "accepted ≠ done").
 * {@code processedAt} is when the command was sent.
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

    // Scalar for simple/favorite commands; a JSON blob for rename_room
    // ({room_id,name?,type?}) and split_room ({room_id,points:[[x,y],...]}) —
    // roomy enough for a multi-corner divide polyline.
    @Column(length = 1024)
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
