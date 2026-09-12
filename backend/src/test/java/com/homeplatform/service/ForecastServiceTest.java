package com.homeplatform.service;

import com.homeplatform.service.ForecastService.AnomalyClass;
import com.homeplatform.service.ForecastService.AnomalyScore;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.List;

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
}
