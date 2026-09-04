package com.homeplatform.model;

import jakarta.persistence.*;
import jakarta.validation.constraints.NotNull;
import lombok.*;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;

@Entity
@Table(name = "forecast_snapshot",
       uniqueConstraints = @UniqueConstraint(columnNames = {"forecast_date", "target_date"}))
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ForecastSnapshot {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "model_id", nullable = false)
    private ForecastModel model;

    @NotNull
    @Column(name = "forecast_date", nullable = false)
    private LocalDate forecastDate;

    @NotNull
    @Column(name = "target_date", nullable = false)
    private LocalDate targetDate;

    @NotNull
    @Column(name = "predicted_kwh", nullable = false, precision = 10, scale = 3)
    private BigDecimal predictedKwh;

    @Column(name = "actual_kwh", precision = 10, scale = 3)
    private BigDecimal actualKwh;

    @Column(name = "predicted_cost", precision = 10, scale = 2)
    private BigDecimal predictedCost;

    @Column(name = "actual_cost", precision = 10, scale = 2)
    private BigDecimal actualCost;

    @Column(name = "weather_high", precision = 5, scale = 2)
    private BigDecimal weatherHigh;

    @Column(name = "weather_low", precision = 5, scale = 2)
    private BigDecimal weatherLow;

    @Column(name = "weather_avg", precision = 5, scale = 2)
    private BigDecimal weatherAvg;

    @Column(precision = 8, scale = 4)
    private BigDecimal cdd;

    @Column(precision = 8, scale = 4)
    private BigDecimal hdd;

    @Column(name = "created_at", nullable = false, updatable = false)
    @Builder.Default
    private LocalDateTime createdAt = LocalDateTime.now();
}
