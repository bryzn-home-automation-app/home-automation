package com.homeplatform.service;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Unit tests for the recency-weighted confidence-band math introduced in the
 * forecast interval redesign. Exercises the pure {@code recencyWeightedStd}
 * helper directly — no Spring context / DB required.
 */
class ForecastServiceTest {

    private static final double EPS = 1e-9;

    @Test
    @DisplayName("uniform ages reduce to plain RMS of residuals")
    void uniformAgesEqualPlainRms() {
        // residuals 3, -4, 12 all at age 0 -> RMS = sqrt((9+16+144)/3)
        List<double[]> data = List.of(
                new double[]{3, 0}, new double[]{-4, 0}, new double[]{12, 0});
        double expected = Math.sqrt((9.0 + 16.0 + 144.0) / 3.0);
        assertEquals(expected, ForecastService.recencyWeightedStd(data, 7.0), EPS);
    }

    @Test
    @DisplayName("older errors are down-weighted by the half-life")
    void olderErrorsDownWeighted() {
        // A large error exactly one half-life old counts half as much as a fresh
        // error of the same magnitude.
        double halfLife = 7.0;
        List<double[]> fresh = List.of(new double[]{10, 0}, new double[]{10, 0});
        List<double[]> aged  = List.of(new double[]{10, 0}, new double[]{10, halfLife});

        double sigmaFresh = ForecastService.recencyWeightedStd(fresh, halfLife);
        double sigmaAged  = ForecastService.recencyWeightedStd(aged, halfLife);

        // Both same-magnitude residuals, so RMS is 10 either way, but verify the
        // weighting is actually applied by mixing magnitudes.
        assertEquals(10.0, sigmaFresh, EPS);
        assertEquals(10.0, sigmaAged, EPS);

        // Fresh small error + aged large error: aged error is discounted, so the
        // weighted RMS sits below the unweighted RMS of {2, 20}.
        List<double[]> mixed = List.of(new double[]{2, 0}, new double[]{20, halfLife});
        double unweighted = Math.sqrt((4.0 + 400.0) / 2.0);            // ≈ 14.28
        double weighted = ForecastService.recencyWeightedStd(mixed, halfLife);
        // w_fresh=1, w_aged=0.5 -> sqrt((1*4 + 0.5*400)/(1.5))
        double expected = Math.sqrt((4.0 + 0.5 * 400.0) / 1.5);        // ≈ 11.83
        assertEquals(expected, weighted, EPS);
        assertTrue(weighted < unweighted,
                "recent-heavy weighting should pull the spread below the flat RMS");
    }

    @Test
    @DisplayName("band widens when a fresh miss dominates a quiet history")
    void freshMissWidensBand() {
        double halfLife = 7.0;
        // History of tiny errors, then a big fresh miss today.
        List<double[]> beforeMiss = List.of(
                new double[]{1, 3}, new double[]{-1, 5}, new double[]{2, 8});
        List<double[]> afterMiss = List.of(
                new double[]{1, 3}, new double[]{-1, 5}, new double[]{2, 8},
                new double[]{25, 0});

        double sigmaBefore = ForecastService.recencyWeightedStd(beforeMiss, halfLife);
        double sigmaAfter = ForecastService.recencyWeightedStd(afterMiss, halfLife);
        assertTrue(sigmaAfter > sigmaBefore * 2,
                "a large fresh residual should sharply widen the band");
    }

    @Test
    @DisplayName("empty input yields NaN (caller treats as no signal)")
    void emptyInputIsNaN() {
        assertTrue(Double.isNaN(ForecastService.recencyWeightedStd(List.of(), 7.0)));
    }
}
