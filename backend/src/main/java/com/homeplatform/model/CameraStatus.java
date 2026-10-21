package com.homeplatform.model;

import jakarta.persistence.*;
import lombok.*;

import java.time.LocalDateTime;

/**
 * Links and latest state for one camera. Discovery fills the links (the go2rtc stream
 * name and the sibling HA entities on the same device); ingestion keeps the state.
 * One row per device (UNIQUE device_id). Entity IDs and the stream name never leave
 * the backend. Timestamps are UTC.
 */
@Entity
@Table(name = "camera_status")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class CameraStatus {

    public static final String POWER_BATTERY = "battery";
    public static final String POWER_WIRED = "wired";

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "device_id", nullable = false, unique = true)
    private Long deviceId;

    @Column(name = "stream_name", length = 64)
    private String streamName;

    @Column(name = "power_source", length = 10)
    private String powerSource;

    @Column(name = "battery_entity_id")
    private String batteryEntityId;

    @Column(name = "charging_entity_id")
    private String chargingEntityId;

    @Column(name = "motion_entity_id")
    private String motionEntityId;

    @Column(name = "person_entity_id")
    private String personEntityId;

    /** JSON of CameraLinker.Controls (entity ids), null for cameras without movement. */
    @Column(name = "controls", columnDefinition = "text")
    private String controls;

    /** JSON list of occupied preset slots: [{index, option, home}]. */
    @Column(name = "preset_slots", columnDefinition = "text")
    private String presetSlots;

    @Column(nullable = false)
    private boolean available;

    @Column(name = "battery_percent")
    private Double batteryPercent;

    private Boolean charging;

    @Column(name = "charging_status", length = 60)
    private String chargingStatus;

    @Column(name = "battery_updated_at")
    private LocalDateTime batteryUpdatedAt;

    @Column(name = "unavailable_since")
    private LocalDateTime unavailableSince;

    @Column(name = "last_motion_at")
    private LocalDateTime lastMotionAt;

    @Column(name = "last_person_at")
    private LocalDateTime lastPersonAt;

    @Column(name = "updated_at", nullable = false)
    private LocalDateTime updatedAt;
}
