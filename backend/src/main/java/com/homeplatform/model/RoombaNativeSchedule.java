package com.homeplatform.model;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.LocalDateTime;

/**
 * A real, robot/cloud-side cleaning schedule (roombapy-prime's ScheduleOptions),
 * as opposed to the old app-side-only scheduler this replaced. The poller fully
 * replaces this table's contents each "list_schedules" run, so a schedule
 * deleted natively (app or probe script) disappears here too. {@code options}
 * is the raw ScheduleOptions JSON, kept opaque so new upstream fields don't
 * need a migration to show up.
 */
@Entity
@Table(name = "roomba_native_schedule")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class RoombaNativeSchedule {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "household_schedule_id", nullable = false, unique = true, length = 160)
    private String householdScheduleId;

    @Column(name = "robot_id", length = 64)
    private String robotId;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(nullable = false)
    private String options;

    @Column(name = "updated_at", nullable = false)
    private LocalDateTime updatedAt;
}
