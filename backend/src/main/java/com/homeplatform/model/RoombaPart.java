package com.homeplatform.model;

import jakarta.persistence.*;
import lombok.*;

import java.time.LocalDateTime;

/**
 * One consumable / maintenance counter for a robot, as reported by the iRobot cloud
 * ({@code GET /v1/robots/{blid}/parts} — the record behind the iRobot app's
 * Maintenance screen). The poller fully replaces a robot's rows on each refresh.
 *
 * <p>Semantics (confirmed on a Roomba Combo G2 / G284020): {@code countRemaining} is the
 * net life left and {@code countUsed} what has been consumed since the counter was last
 * reset, both in {@code countType} units ({@code minutes}, {@code mission},
 * {@code combo_missions}, {@code evacs}, {@code pad_washes_used}); {@code counter} is the
 * cloud's own ceil(percent used). {@code counterCategory} is {@code replacement} (swap the
 * part) or {@code maintenance} (clean it); {@code resetBy} says whether the user resets it
 * in the app or the cloud/dock does it automatically (e.g. a new dock bag).
 */
@Entity
@Table(name = "roomba_parts",
        uniqueConstraints = @UniqueConstraint(name = "uq_roomba_parts_robot_part", columnNames = {"robot_id", "part_id"}))
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class RoombaPart {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "robot_id", nullable = false, length = 64)
    private String robotId;

    @Column(name = "part_id", nullable = false, length = 40)
    private String partId;

    @Column(name = "count_type", length = 40)
    private String countType;

    private Integer counter;

    @Column(name = "count_remaining")
    private Integer countRemaining;

    @Column(name = "count_used")
    private Integer countUsed;

    @Column(name = "minutes_remaining")
    private Integer minutesRemaining;

    @Column(name = "counter_category", length = 40)
    private String counterCategory;

    @Column(name = "reset_by", length = 20)
    private String resetBy;

    /** Cloud-side "last updated" for this counter (only some parts carry it). */
    @Column(name = "last_updated_at")
    private LocalDateTime lastUpdatedAt;

    @Column(name = "updated_at", nullable = false)
    private LocalDateTime updatedAt;
}
