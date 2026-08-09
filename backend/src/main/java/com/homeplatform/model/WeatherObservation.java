package com.homeplatform.model;

import jakarta.persistence.*;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import lombok.*;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.UUID;

/**
 * Append-only daily weather observation. Never updated or deleted.
 * Shared enrichment for electric, gas, and water dashboards.
 */
@Entity
@Table(name = "weather_observations")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class WeatherObservation {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @NotNull
    @Column(name = "observation_date", nullable = false)
    private LocalDate observationDate;

    @NotBlank
    @Column(name = "station_code", nullable = false, length = 100)
    private String stationCode;

    @Column(name = "high_temp_f", precision = 5, scale = 2)
    private BigDecimal highTempF;

    @Column(name = "low_temp_f", precision = 5, scale = 2)
    private BigDecimal lowTempF;

    @Column(name = "avg_temp_f", precision = 5, scale = 2)
    private BigDecimal avgTempF;

    @Column(name = "humidity_pct", precision = 5, scale = 2)
    private BigDecimal humidityPct;

    @Column(name = "precipitation_inches", precision = 8, scale = 3)
    private BigDecimal precipitationInches;

    // --- Audit / traceability metadata ---

    @NotBlank
    @Column(nullable = false, length = 100)
    private String source;

    @NotBlank
    @Column(name = "source_provider", nullable = false, length = 50)
    @Builder.Default
    private String sourceProvider = "open-meteo";

    @Column(name = "ingestion_batch_id")
    private UUID ingestionBatchId;

    @NotBlank
    @Column(name = "processing_version", nullable = false, length = 20)
    @Builder.Default
    private String processingVersion = "1.0";

    @Column(name = "created_at", nullable = false, updatable = false)
    @Builder.Default
    private LocalDateTime createdAt = LocalDateTime.now();
}
