package com.homeplatform.model;

import jakarta.persistence.*;
import lombok.*;

import java.time.LocalDateTime;

/** Static device identity + firmware for a robot. Poller UPSERTs once per connect. */
@Entity
@Table(name = "roomba_device")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class RoombaDevice {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "robot_id", nullable = false, unique = true, length = 64)
    private String robotId;

    @Column(length = 40)
    private String sku;

    @Column(length = 20)
    private String series;

    @Column(length = 60)
    private String family;

    @Column(name = "serial_number", length = 60)
    private String serialNumber;

    @Column(length = 60)
    private String firmware;

    @Column(name = "updated_at", nullable = false)
    private LocalDateTime updatedAt;
}
