package com.homeplatform.model;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.time.LocalDateTime;

/**
 * Latest state for one thermostat. Ingestion UPSERTs one row per device
 * (UNIQUE device_id), mirroring {@link RoombaStatus}. Timestamps are UTC.
 */
@Entity
@Table(name = "thermostat_status")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ThermostatStatus {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "device_id", nullable = false, unique = true)
    private Long deviceId;

    @Column(nullable = false)
    private boolean available;

    private Double temperature;

    private Double humidity;

    @Column(name = "target_temperature")
    private Double targetTemperature;

    @Column(name = "heat_setpoint")
    private Double heatSetpoint;

    @Column(name = "cool_setpoint")
    private Double coolSetpoint;

    @Column(name = "hvac_mode", length = 30)
    private String hvacMode;

    @Column(name = "hvac_action", length = 30)
    private String hvacAction;

    @Column(name = "preset_mode", length = 60)
    private String presetMode;

    @Column(name = "temperature_unit", length = 5)
    private String temperatureUnit;

    @Column(name = "min_temp")
    private Double minTemp;

    @Column(name = "max_temp")
    private Double maxTemp;

    /** JSON array of HA-supported hvac modes. */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "hvac_modes")
    private String hvacModes;

    /** JSON array of HA preset modes (ecobee comfort settings / holds). */
    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "preset_modes")
    private String presetModes;

    @Column(name = "state_updated_at")
    private LocalDateTime stateUpdatedAt;

    /** Full HA state payload as stored JSON. Not exposed by the API. */
    @JdbcTypeCode(SqlTypes.JSON)
    private String raw;

    @Column(name = "updated_at", nullable = false)
    private LocalDateTime updatedAt;
}
