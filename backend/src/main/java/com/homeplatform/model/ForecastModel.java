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

    /**
     * Min/max CDD and HDD actually seen in the training window. A linear
     * regression fit only on (say) three months of hot-summer data has no
     * evidence at all for cooler days — its intercept is just where the
     * fitted line happens to cross zero, not a physically meaningful
     * baseline. Evaluating it on a CDD/HDD outside this range extrapolates
     * that line arbitrarily far, which for this model shape reliably goes
     * negative and gets floored at a nonsensical flat 0 kWh. predict()
     * clamps its inputs to this range instead of clamping the output, so a
     * day outside the model's experience gets its nearest in-range estimate
     * rather than a fabricated zero.
     */
    /**
     * AR(1) coefficient: weight on yesterday's total kWh. Home usage is
     * strongly autocorrelated (high-usage days cluster), so the lag term
     * captures behavioral variance the degree-day regression can't see.
     * Null on models trained before this feature existed, or when there
     * weren't enough consecutive-day pairs to fit it — predict() then
     * behaves exactly like the pre-lag model.
     */
    @Column(name = "lag_coeff", precision = 12, scale = 6)
    private BigDecimal lagCoeff;

    /**
     * Mean of the lag feature over the training rows. When a prediction has
     * no usable previous-day kWh (cold start, data gap), predict() substitutes
     * this mean so the lag term contributes its average effect instead of
     * silently dropping to zero (which would bias every such prediction low).
     */
    @Column(name = "lag_mean", precision = 10, scale = 3)
    private BigDecimal lagMean;

    @Column(name = "cdd_min", precision = 10, scale = 3)
    private BigDecimal cddMin;

    @Column(name = "cdd_max", precision = 10, scale = 3)
    private BigDecimal cddMax;

    @Column(name = "hdd_min", precision = 10, scale = 3)
    private BigDecimal hddMin;

    @Column(name = "hdd_max", precision = 10, scale = 3)
    private BigDecimal hddMax;

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
