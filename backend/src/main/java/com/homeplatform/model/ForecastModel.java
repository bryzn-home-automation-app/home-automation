package com.homeplatform.model;

import jakarta.persistence.*;
import lombok.*;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.Map;

@Entity
@Table(name = "forecast_model")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ForecastModel {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "created_at", nullable = false, updatable = false)
    @Builder.Default
    private LocalDateTime createdAt = LocalDateTime.now();

    @Column(name = "data_points_used", nullable = false)
    private int dataPointsUsed;

    @Column(name = "r_squared", precision = 8, scale = 6)
    private BigDecimal rSquared;

    @Column(precision = 10, scale = 3)
    private BigDecimal mae;

    @Column(precision = 8, scale = 4)
    private BigDecimal mape;

    @Column(nullable = false, precision = 12, scale = 6)
    private BigDecimal intercept;

    @Column(name = "cdd_coeff", nullable = false, precision = 12, scale = 6)
    private BigDecimal cddCoeff;

    @Column(name = "hdd_coeff", nullable = false, precision = 12, scale = 6)
    private BigDecimal hddCoeff;

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "dow_adjustments", columnDefinition = "jsonb")
    @Builder.Default
    private Map<String, Double> dowAdjustments = Map.of();

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "hourly_profiles", columnDefinition = "jsonb")
    @Builder.Default
    private Map<String, Object> hourlyProfiles = Map.of();

    @JdbcTypeCode(SqlTypes.JSON)
    @Column(name = "seasonal_factors", columnDefinition = "jsonb")
    @Builder.Default
    private Map<String, Double> seasonalFactors = Map.of();

    @Column(name = "training_start")
    private LocalDate trainingStart;

    @Column(name = "training_end")
    private LocalDate trainingEnd;
}
