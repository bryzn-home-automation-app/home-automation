package com.homeplatform.model;

import jakarta.persistence.*;
import lombok.*;

import java.time.LocalDateTime;
import java.util.UUID;

/**
 * A device discovered through a smart-home provider (currently Home Assistant).
 * {@code publicId} is the stable ID the API exposes; {@code providerEntityId}
 * (e.g. an HA {@code climate.*} entity ID) never leaves the backend.
 * Timestamps are UTC.
 */
@Entity
@Table(name = "smart_devices")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class SmartDevice {

    public enum Kind { THERMOSTAT, CAMERA }

    public static final String PROVIDER_HOME_ASSISTANT = "home-assistant";

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "public_id", nullable = false, unique = true)
    private UUID publicId;

    @Column(nullable = false, length = 30)
    private String provider;

    @Column(name = "provider_entity_id", nullable = false, unique = true, length = 255)
    private String providerEntityId;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private Kind kind;

    @Column(length = 255)
    private String name;

    @Column(nullable = false)
    private boolean enabled;

    @Column(name = "last_seen_at")
    private LocalDateTime lastSeenAt;

    @Column(name = "created_at", nullable = false)
    private LocalDateTime createdAt;

    @Column(name = "updated_at", nullable = false)
    private LocalDateTime updatedAt;
}
