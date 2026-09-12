package com.homeplatform.service;

import com.homeplatform.service.ForecastService.AnomalyClass;
import com.homeplatform.service.ForecastService.AnomalyScore;
import com.homeplatform.service.ForecastService.DriftAssessment;
import com.homeplatform.service.ForecastService.DriftState;
import com.homeplatform.service.ForecastService.HourlyAnomaly;
import com.homeplatform.service.ForecastService.HourlyAnomalyClass;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.time.LocalDate;
import java.util.List;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Unit tests for the robust-statistics core of {@link ForecastService}: the
 * recency-weighted robust residual scale that drives the confidence band, the
 * robust (Huber IRLS) daily regression, the robust median helpers behind the
 * day-of-week multipliers, and anomaly scoring. All exercise pure/stateless
 * package-private helpers — no Spring context / DB required.
 */
class ForecastServiceTest {

    private static final double EPS = 1e-9;
    private static final double MAD_TO_STD = 1.4826; // mirrors the constant in ForecastService

    // ── Recency-weighted robust residual scale (confidence band) ──────────

    @Test
    @DisplayName("uniform ages reduce to the plain robust scale (MAD-to-std * median|r|)")
    void uniformAgesEqualPlainRobustScale() {
        // |residuals| 3, 4, 12 all at age 0 -> weighted median = plain median = 4.
        List<double[]> data = List.of(
                new double[]{3, 0}, new double[]{-4, 0}, new double[]{12, 0});
        double expected = MAD_TO_STD * 4.0;
        assertEquals(expected, ForecastService.recencyWeightedRobustSigma(data, 7.0), EPS);
    }

    @Test
    @DisplayName("older errors are down-weighted by the half-life")
    void olderErrorsDownWeighted() {
        double halfLife = 7.0;

        // Same-magnitude residuals -> scale is |r|-scaled regardless of age.
        List<double[]> fresh = List.of(new double[]{10, 0}, new double[]{10, 0});
        List<double[]> aged  = List.of(new double[]{10, 0}, new double[]{10, halfLife});
        assertEquals(MAD_TO_STD * 10.0, ForecastService.recencyWeightedRobustSigma(fresh, halfLife), EPS);
        assertEquals(MAD_TO_STD * 10.0, ForecastService.recencyWeightedRobustSigma(aged, halfLife), EPS);

        // Fresh small error (weight 1) + aged large error (weight 0.5): the fresh
        // point alone already carries > half the weight, so it is the weighted
        // median. The robust scale therefore tracks the recent small error rather
        // than being dragged up by the stale large one.
        List<double[]> mixed = List.of(new double[]{2, 0}, new double[]{20, halfLife});
        double weighted = ForecastService.recencyWeightedRobustSigma(mixed, halfLife);
        double unweighted = MAD_TO_STD * 11.0; // plain median of {2, 20} = 11
        assertEquals(MAD_TO_STD * 2.0, weighted, EPS);
        assertTrue(weighted < unweighted,
                "recent-heavy weighting should pull the spread below the flat robust scale");
    }

    @Test
    @DisplayName("a fresh miss still moves the estimate (but modestly, not explosively)")
    void freshMissMovesEstimate() {
        double halfLife = 7.0;
        List<double[]> beforeMiss = List.of(
                new double[]{1, 3}, new double[]{-1, 5}, new double[]{2, 8});
        List<double[]> afterMiss = List.of(
                new double[]{1, 3}, new double[]{-1, 5}, new double[]{2, 8},
                new double[]{25, 0});

        double sigmaBefore = ForecastService.recencyWeightedRobustSigma(beforeMiss, halfLife);
        double sigmaAfter = ForecastService.recencyWeightedRobustSigma(afterMiss, halfLife);
        assertTrue(sigmaAfter > sigmaBefore, "a fresh residual should still move the estimate");
        // Robust: a single 25 against tiny history does NOT blow the band up ~25x
        // the way a squared-error RMS would.
        assertTrue(sigmaAfter < sigmaBefore * 3,
                "one fresh miss must not explode the robust band");
    }

    @Test
    @DisplayName("empty input yields NaN (caller treats as no signal)")
    void emptyInputIsNaN() {
        assertTrue(Double.isNaN(ForecastService.recencyWeightedRobustSigma(List.of(), 7.0)));
    }

    /**
     * The acceptance bar from the design doc (Scenario A): a lone bad day must
     * not blow the band up, while a persistently elevated run legitimately must.
     */
    @Test
    @DisplayName("band is single-spike resistant yet persistent-elevation responsive")
    void bandResistsSpikeButTracksPersistentElevation() {
        double halfLife = 7.0;

        // Chronological, oldest -> newest, ages 4..0.
        // Calm week.
        List<double[]> calm = List.of(
                new double[]{17, 4}, new double[]{18, 3}, new double[]{19, 2},
                new double[]{20, 1}, new double[]{19, 0});
        // Same week but day-2 was a one-off 35 kWh miss.
        List<double[]> spike = List.of(
                new double[]{17, 4}, new double[]{18, 3}, new double[]{35, 2},
                new double[]{20, 1}, new double[]{19, 0});
        // Persistently climbing errors.
        List<double[]> persistent = List.of(
                new double[]{17, 4}, new double[]{21, 3}, new double[]{23, 2},
                new double[]{25, 1}, new double[]{26, 0});

        double sigmaCalm = ForecastService.recencyWeightedRobustSigma(calm, halfLife);
        double sigmaSpike = ForecastService.recencyWeightedRobustSigma(spike, halfLife);
        double sigmaPersistent = ForecastService.recencyWeightedRobustSigma(persistent, halfLife);

        // Single 35 spike leaves the band essentially unchanged (weighted median
        // stays at 19 -> 28.17 either way).
        assertEquals(sigmaCalm, sigmaSpike, 1e-6,
                "one anomalous 35 kWh day must not widen the band");
        assertEquals(MAD_TO_STD * 19.0, sigmaSpike, 1e-6);

        // Persistent elevation genuinely widens it (weighted median rises to 23).
        assertEquals(MAD_TO_STD * 23.0, sigmaPersistent, 1e-6);
        assertTrue(sigmaPersistent > sigmaCalm * 1.15,
                "a persistently elevated error sequence must widen the band");
    }

    // ── Robust median helpers (day-of-week multipliers) ───────────────────

    @Test
    @DisplayName("median ignores a single bizarre observation the mean would chase")
    void medianResistsOutlier() {
        // Six actual/predicted ratios: five near 1.0 and one wild 3.0 (a bizarre
        // Monday). The mean is dragged up; the median stays near the true center.
        List<Double> ratios = List.of(1.0, 1.05, 0.95, 1.02, 0.98, 3.0);
        double mean = ratios.stream().mapToDouble(Double::doubleValue).average().orElse(0);
        double median = ForecastService.median(ratios);
        assertTrue(mean > 1.3, "arithmetic mean is pulled up by the outlier: " + mean);
        assertTrue(median > 0.99 && median < 1.05,
                "median shrugs off the outlier: " + median);
    }

    @Test
    @DisplayName("weightedMedian with uniform weights equals the plain median")
    void weightedMedianReducesToPlainMedian() {
        List<double[]> pts = List.of(
                new double[]{5, 1}, new double[]{1, 1}, new double[]{3, 1},
                new double[]{9, 1}, new double[]{11, 1});
        // plain median of {1,3,5,9,11} = 5
        assertEquals(5.0, ForecastService.weightedMedian(pts), EPS);
    }

    // ── Robust regression (Huber IRLS) ────────────────────────────────────

    @Test
    @DisplayName("robust regression resists a single extreme day that skews OLS")
    void robustRegressionResistsOutlier() {
        // True relationship: kwh = 10 + 2*cdd (hdd held at 0). Eight clean points
        // exactly on the line, plus one gross outlier (cdd=3 -> 100 kWh instead of 16).
        double[] cdd = {0, 1, 2, 3, 4, 5, 6, 7, 3};
        double[] y   = {10, 12, 14, 16, 18, 20, 22, 24, 100};
        double[][] x = new double[y.length][2];
        for (int i = 0; i < y.length; i++) {
            x[i][0] = cdd[i]; // cdd
            x[i][1] = 0;      // hdd
        }

        double[] ols = ForecastService.olsRegression(y, x);
        double[] robust = ForecastService.robustRegression(y, x);

        double trueIntercept = 10, trueSlope = 2;
        // Robust estimates land close to truth...
        assertEquals(trueSlope, robust[1], 0.5, "robust cdd slope near true 2.0");
        assertEquals(trueIntercept, robust[0], 3.0, "robust intercept near true 10");
        // ...and strictly closer than OLS, which the outlier drags off.
        assertTrue(Math.abs(robust[1] - trueSlope) < Math.abs(ols[1] - trueSlope),
                "robust slope should beat OLS slope");
        assertTrue(Math.abs(robust[0] - trueIntercept) < Math.abs(ols[0] - trueIntercept),
                "robust intercept should beat OLS intercept");
    }

    @Test
    @DisplayName("with no outliers robust regression matches OLS")
    void robustRegressionMatchesOlsWhenClean() {
        double[] cdd = {0, 1, 2, 3, 4, 5, 6, 7};
        double[] y   = {10, 12, 14, 16, 18, 20, 22, 24};
        double[][] x = new double[y.length][2];
        for (int i = 0; i < y.length; i++) { x[i][0] = cdd[i]; x[i][1] = 0; }

        double[] ols = ForecastService.olsRegression(y, x);
        double[] robust = ForecastService.robustRegression(y, x);
        assertEquals(ols[0], robust[0], 1e-6);
        assertEquals(ols[1], robust[1], 1e-6);
    }

    // ── Anomaly scoring ───────────────────────────────────────────────────

    @Test
    @DisplayName("anomaly scoring classifies by robust z into normal / anomalous / severe")
    void anomalyScoreClassification() {
        double scale = 10.0;

        AnomalyScore normal = ForecastService.scoreAnomaly(67, 65, scale); // z = 0.2
        assertEquals(AnomalyClass.NORMAL, normal.classification());
        assertEquals(2.0, normal.residual(), EPS);
        assertEquals(0.2, normal.z(), EPS);

        AnomalyScore anomalous = ForecastService.scoreAnomaly(90, 65, scale); // z = 2.5
        assertEquals(AnomalyClass.ANOMALOUS, anomalous.classification());

        AnomalyScore severe = ForecastService.scoreAnomaly(140, 65, scale); // z = 7.5
        assertEquals(AnomalyClass.SEVERE, severe.classification());
        assertEquals(75.0, severe.residual(), EPS);
    }

    @Test
    @DisplayName("classification uses residual magnitude, so under-consumption also flags")
    void anomalyScoreNegativeResidual() {
        // Actual far BELOW forecast -> large negative z, still severe by magnitude.
        AnomalyScore s = ForecastService.scoreAnomaly(20, 65, 10.0); // z = -4.5
        assertEquals(AnomalyClass.SEVERE, s.classification());
        assertTrue(s.z() < 0);
        assertEquals(45.0, s.absResidual(), EPS);
    }

    @Test
    @DisplayName("non-positive robust scale yields z=0 / NORMAL, never a divide-by-zero")
    void anomalyScoreGuardsZeroScale() {
        AnomalyScore s = ForecastService.scoreAnomaly(140, 65, 0.0);
        assertEquals(0.0, s.z(), EPS);
        assertEquals(AnomalyClass.NORMAL, s.classification());
        assertFalse(Double.isNaN(s.z()));
    }

    // ── Drift / regime-change detection (Phase 2) ─────────────────────────

    private static final double HIST_MAE = 10.5; // matches the doc's current in-sample MAE example
    private static final LocalDate ASOF = LocalDate.of(2026, 9, 11);

    @Test
    @DisplayName("small noisy residuals with no streak -> NORMAL")
    void driftNormalCase() {
        List<Double> residuals = List.of(1.0, -2.0, 1.5, -1.0, 2.0, -1.5, 1.0); // newest-first
        DriftAssessment a = ForecastService.computeDriftAssessment(ASOF, HIST_MAE, residuals, Map.of());
        assertEquals(DriftState.NORMAL, a.state());
        assertTrue(a.maeRatio() < 1.5, "ratio should be well under the drift threshold: " + a.maeRatio());
    }

    @Test
    @DisplayName("doc's noisy-but-zero-bias example (+18,-20,+21,-19,+20) -> ANOMALOUS, not drifting")
    void driftAnomalousNoStreak() {
        List<Double> residuals = List.of(18.0, -20.0, 21.0, -19.0, 20.0); // newest-first
        DriftAssessment a = ForecastService.computeDriftAssessment(ASOF, HIST_MAE, residuals, Map.of());
        assertEquals(DriftState.ANOMALOUS, a.state());
        assertEquals(1, a.streakLength(), "alternating signs break the streak immediately");
        assertTrue(a.maeRatio() > 1.5, "large errors should clear the magnitude threshold: " + a.maeRatio());
    }

    @Test
    @DisplayName("doc's consistent-positive-bias example (+18,+21,+19,+23,+20) -> DRIFT_SUSPECTED")
    void driftSuspectedConsistentBias() {
        List<Double> residuals = List.of(18.0, 21.0, 19.0, 23.0, 20.0); // newest-first, all positive
        DriftAssessment a = ForecastService.computeDriftAssessment(ASOF, HIST_MAE, residuals, Map.of());
        assertEquals(DriftState.DRIFT_SUSPECTED, a.state());
        assertEquals(5, a.streakLength());
        assertEquals(1, a.streakSign());
        assertEquals(20.2, a.recentMae(), 1e-9);
        assertTrue(a.maeRatio() > ForecastService.DRIFT_MAE_RATIO_THRESHOLD
                        && a.maeRatio() < ForecastService.REGIME_MAE_RATIO_THRESHOLD,
                "ratio should sit between drift and regime thresholds: " + a.maeRatio());
    }

    @Test
    @DisplayName("longer, larger same-direction run -> REGIME_CHANGE_SUSPECTED")
    void driftRegimeChangeSuspected() {
        // 7-in-a-row positive residuals, ratio well above the regime threshold.
        List<Double> residuals = List.of(28.0, 30.0, 27.0, 29.0, 31.0, 28.0, 29.0); // newest-first
        DriftAssessment a = ForecastService.computeDriftAssessment(ASOF, HIST_MAE, residuals, Map.of());
        assertEquals(DriftState.REGIME_CHANGE_SUSPECTED, a.state());
        assertEquals(7, a.streakLength());
        assertTrue(a.maeRatio() >= ForecastService.REGIME_MAE_RATIO_THRESHOLD,
                "ratio should clear the regime threshold: " + a.maeRatio());
    }

    @Test
    @DisplayName("too few graded samples caps the verdict at ANOMALOUS even with a huge same-direction ratio")
    void driftInsufficientSamplesCapsAtAnomalous() {
        List<Double> residuals = List.of(50.0, 45.0); // only 2 samples, both positive, huge ratio
        DriftAssessment a = ForecastService.computeDriftAssessment(ASOF, HIST_MAE, residuals, Map.of());
        assertEquals(DriftState.ANOMALOUS, a.state());
        assertNotEquals(DriftState.REGIME_CHANGE_SUSPECTED, a.state());
        assertNotEquals(DriftState.DRIFT_SUSPECTED, a.state());
    }

    @Test
    @DisplayName("empty residual window -> NORMAL, no NaN propagation crash")
    void driftEmptyWindowIsNormal() {
        DriftAssessment a = ForecastService.computeDriftAssessment(ASOF, HIST_MAE, List.of(), Map.of());
        assertEquals(DriftState.NORMAL, a.state());
        assertEquals(0, a.sampleCount());
    }

    @Test
    @DisplayName("context window MAE ratios are carried through but don't affect the primary-window state")
    void driftContextRatiosCarried() {
        List<Double> primary = List.of(18.0, 21.0, 19.0, 23.0, 20.0);
        Map<Integer, List<Double>> context = Map.of(
                3, List.of(18.0, 21.0, 19.0),
                14, List.of(18.0, 21.0, 19.0, 23.0, 20.0, 5.0, -3.0));
        DriftAssessment a = ForecastService.computeDriftAssessment(ASOF, HIST_MAE, primary, context);
        assertEquals(DriftState.DRIFT_SUSPECTED, a.state());
        assertEquals(2, a.contextMaeRatios().size());
        assertTrue(a.contextMaeRatios().get(3) > 1.5);
    }

    @Test
    @DisplayName("computeStreak: leading zero residual yields no streak")
    void computeStreakZeroBreaksImmediately() {
        int[] streak = ForecastService.computeStreak(List.of(0.0, 5.0, 6.0));
        assertEquals(0, streak[0]);
        assertEquals(0, streak[1]);
    }

    @Test
    @DisplayName("computeStreak: sign flip stops the run at the flip")
    void computeStreakStopsAtSignFlip() {
        int[] streak = ForecastService.computeStreak(List.of(5.0, 6.0, -1.0, 7.0));
        assertEquals(2, streak[0]);
        assertEquals(1, streak[1]);
    }

    @Test
    @DisplayName("mae(): empty list is NaN, non-empty averages absolute values")
    void maeHelper() {
        assertTrue(Double.isNaN(ForecastService.mae(List.of())));
        assertEquals(3.0, ForecastService.mae(List.of(-1.0, 2.0, 6.0)), EPS);
    }

    // ── Robust hourly-shape aggregation (doc §6) ──────────────────────────

    @Test
    @DisplayName("robustHourlyShape uses a per-hour median, so one freak hour can't skew that hour's learned fraction")
    void robustHourlyShapeResistsSingleHourOutlier() {
        // Hour 18 has four normal 3 kWh evenings plus ONE space-heater night at
        // 30 kWh; every other hour is a flat 1 kWh across five days. The mean would
        // let that one 30 kWh reading dominate hour 18's fraction; the median (3.0)
        // shrugs it off. Mirrors medianResistsOutlier at the hourly-shape level.
        List<double[]> pairs = new java.util.ArrayList<>();
        double[] hour18 = {3, 3, 3, 3, 30};
        for (double v : hour18) pairs.add(new double[]{18, v});
        for (int h = 0; h < 24; h++) {
            if (h == 18) continue;
            for (int d = 0; d < 5; d++) pairs.add(new double[]{h, 1.0});
        }

        List<Double> shape = ForecastService.robustHourlyShape(pairs);

        assertEquals(24, shape.size());
        double sum = shape.stream().mapToDouble(Double::doubleValue).sum();
        assertEquals(1.0, sum, 1e-9, "shape must normalize to ~1");

        // Median hour-18 kWh = 3.0, every other hour = 1.0 -> 23*1 + 3 = 26 total.
        assertEquals(3.0 / 26.0, shape.get(18), 1e-9, "hour 18 uses the median 3.0, not the outlier-chasing mean");
        assertEquals(1.0 / 26.0, shape.get(0), 1e-9);

        // What the arithmetic mean would have produced for hour 18 (mean = 8.4),
        // proving the median materially changed the answer.
        double meanShape18 = 8.4 / (23 * 1.0 + 8.4);
        assertTrue(shape.get(18) < meanShape18 * 0.5,
                "median fraction must be far below the mean's outlier-inflated fraction");
    }

    @Test
    @DisplayName("robustHourlyShape: an empty bucket yields an all-zero (unnormalizable) shape, not NaN")
    void robustHourlyShapeEmptyBucket() {
        List<Double> shape = ForecastService.robustHourlyShape(List.of());
        assertEquals(24, shape.size());
        assertTrue(shape.stream().allMatch(v -> v == 0.0));
    }

    // ── Hourly anomaly classification (doc §8) ────────────────────────────

    /** Flat learned shape (1/24 each) — keeps expected = predicted/24 per hour. */
    private static List<Double> flatShape() {
        return java.util.Collections.nCopies(24, 1.0 / 24);
    }

    @Test
    @DisplayName("localized spike: +30 kWh concentrated in 3 afternoon hours -> LOCALIZED_SPIKE")
    void classifyLocalizedSpike() {
        // Predicted 65 kWh, flat expected ~2.708/hr. Every hour lands on expectation
        // except 14/15/16 which each run +10 kWh -> +30 daily. 3 hours hold 100% of
        // the excess (k <= 3).
        double predicted = 65.0;
        double perHour = predicted / 24.0;
        double[] actual = new double[24];
        for (int h = 0; h < 24; h++) actual[h] = perHour;
        actual[14] += 10; actual[15] += 10; actual[16] += 10;
        double actualTotal = predicted + 30;

        HourlyAnomaly a = ForecastService.classifyHourlyAnomaly(predicted, actualTotal, actual, flatShape());
        assertEquals(HourlyAnomalyClass.LOCALIZED_SPIKE, a.classification());
        assertEquals(30.0, a.dailyResidual(), 1e-9);
        assertEquals(3, a.concentrationHours());
        assertEquals(3, a.topHours().length);
    }

    @Test
    @DisplayName("baseline shift: +12 kWh spread uniformly across all 24 hours -> BASELINE_SHIFT")
    void classifyBaselineShift() {
        // Every hour runs +0.5 kWh above expectation -> +12 daily, diffuse. Reaching
        // 70% of the excess needs ~17 hours (>= 12), and overnight is only ~29%.
        double predicted = 65.0;
        double perHour = predicted / 24.0;
        double[] actual = new double[24];
        for (int h = 0; h < 24; h++) actual[h] = perHour + 0.5;
        double actualTotal = predicted + 12;

        HourlyAnomaly a = ForecastService.classifyHourlyAnomaly(predicted, actualTotal, actual, flatShape());
        assertEquals(HourlyAnomalyClass.BASELINE_SHIFT, a.classification());
        assertTrue(a.concentrationHours() >= ForecastService.HOURLY_BASELINE_MIN_HOURS,
                "diffuse lift needs many hours to reach 70%: " + a.concentrationHours());
        assertTrue(a.overnightShare() < ForecastService.HOURLY_OVERNIGHT_SHARE);
    }

    @Test
    @DisplayName("persistent overnight increase: +30 kWh across five overnight hours -> OVERNIGHT_INCREASE")
    void classifyOvernightIncrease() {
        // Hours 0-4 each +6 kWh (=+30 daily), all in the 11pm-5am window, so the
        // overnight share is 100% (>= 50%). Spread over 5 hours so it is not a
        // <=3-hour localized spike.
        double predicted = 65.0;
        double perHour = predicted / 24.0;
        double[] actual = new double[24];
        for (int h = 0; h < 24; h++) actual[h] = perHour;
        for (int h = 0; h <= 4; h++) actual[h] += 6;
        double actualTotal = predicted + 30;

        HourlyAnomaly a = ForecastService.classifyHourlyAnomaly(predicted, actualTotal, actual, flatShape());
        assertEquals(HourlyAnomalyClass.OVERNIGHT_INCREASE, a.classification());
        assertEquals(1.0, a.overnightShare(), 1e-9);
        assertTrue(a.concentrationHours() > ForecastService.HOURLY_SPIKE_MAX_HOURS);
    }

    @Test
    @DisplayName("time-of-day shift: +30 kWh across a 6-hour evening block -> TIME_OF_DAY_SHIFT")
    void classifyTimeOfDayShift() {
        // Hours 17-22 each +5 kWh (=+30). Six hours (> spike max 3, < baseline 12)
        // and evening, not overnight -> the residual TIME_OF_DAY_SHIFT bucket.
        double predicted = 65.0;
        double perHour = predicted / 24.0;
        double[] actual = new double[24];
        for (int h = 0; h < 24; h++) actual[h] = perHour;
        for (int h = 17; h <= 22; h++) actual[h] += 5;
        double actualTotal = predicted + 30;

        HourlyAnomaly a = ForecastService.classifyHourlyAnomaly(predicted, actualTotal, actual, flatShape());
        assertEquals(HourlyAnomalyClass.TIME_OF_DAY_SHIFT, a.classification());
        assertTrue(a.concentrationHours() > ForecastService.HOURLY_SPIKE_MAX_HOURS
                && a.concentrationHours() < ForecastService.HOURLY_BASELINE_MIN_HOURS);
    }

    @Test
    @DisplayName("a daily residual below the significance floor is NORMAL, not decomposed")
    void classifyBelowFloorIsNormal() {
        double predicted = 65.0;
        double perHour = predicted / 24.0;
        double[] actual = new double[24];
        for (int h = 0; h < 24; h++) actual[h] = perHour;
        actual[14] += 3; // +3 kWh total, under max(5, 10% of 65 = 6.5)

        HourlyAnomaly a = ForecastService.classifyHourlyAnomaly(predicted, predicted + 3, actual, flatShape());
        assertEquals(HourlyAnomalyClass.NORMAL, a.classification());
        assertEquals(0, a.concentrationHours());
    }
}
