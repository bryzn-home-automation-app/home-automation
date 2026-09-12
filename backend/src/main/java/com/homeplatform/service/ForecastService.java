package com.homeplatform.service;

import com.homeplatform.model.ForecastModel;
import com.homeplatform.model.ForecastSnapshot;
import com.homeplatform.repository.ForecastModelRepository;
import com.homeplatform.repository.ForecastSnapshotRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.*;
import java.util.stream.Collectors;

@Service
public class ForecastService {

    private static final Logger log = LoggerFactory.getLogger(ForecastService.class);
    private static final double COMFORT_BASE = 65.0;
    private static final int MIN_DATA_POINTS = 7;

    // ── Recency-weighted confidence-band tuning ─────────────────
    // The band is derived from RECENT out-of-sample forecast errors (graded
    // snapshots: predicted vs. actual), NOT from the model's all-time in-sample
    // fit. This makes it react quickly — the user's explicit preference: "a
    // tighter forecast band that changes frequently but learns quickly over a
    // broad band that slowly improves."
    //
    // NOTE: this recency weighting applies ONLY to the interval width. The OLS
    // regression in trainModel() still fits on the FULL history so the mean
    // projection keeps learning long-run seasonal/degree-day signal. The two
    // deliberately use different memory lengths: long memory for the mean line
    // (retain seasonal history), short memory for the band (react to recent
    // accuracy). A single shared decay constant can't serve both.
    private static final double BAND_HALFLIFE_DAYS = 7.0;   // errors ~2 weeks old carry ~1/4 weight
    private static final int    BAND_WINDOW_DAYS   = 30;    // hard lookback cap on graded errors
    private static final int    BAND_MIN_SAMPLES   = 4;     // need this many graded days to trust OOS spread
    private static final double BAND_Z             = 1.28;  // ~80% prediction interval (normal)
    private static final double MAE_TO_STD         = 1.2533; // sqrt(pi/2): in-sample MAE -> std-equiv fallback

    // ── Robust-statistics tuning ────────────────────────────────
    // MAD (median absolute deviation) scaled by this constant is a consistent,
    // outlier-resistant estimator of the standard deviation for normally
    // distributed data. Used both for the robust regression's residual scale and
    // the confidence-band residual scale (replacing the old squared-error RMS,
    // which let a single extreme residual dominate).
    private static final double MAD_TO_STD   = 1.4826;
    // Huber tuning constant (residuals beyond HUBER_K robust-sigmas get their
    // influence tapered as k/|u| instead of contributing full least-squares
    // weight). 1.345 gives ~95% efficiency vs OLS under normal noise.
    private static final double HUBER_K      = 1.345;
    private static final int    IRLS_MAX_ITERS = 4;

    // ── Anomaly-scoring thresholds (robust z of residual/robust-scale) ──
    // Named (not inlined) so a later drift-detection phase can tune them without
    // hunting through the classifier. |z| below ANOMALY normal; ANOMALY..SEVERE
    // is unusual-but-plausible; above SEVERE is a hard outlier.
    static final double ANOMALY_Z_THRESHOLD = 2.0;
    static final double SEVERE_Z_THRESHOLD  = 3.5;

    // ── Drift-detection tuning (Phase 2) ─────────────────────────
    // Windows over graded (predicted vs. actual) ForecastSnapshots, freshest
    // prediction per target day — same invariant as computeIntervalSigma(). The
    // doc suggests 3/5/7/14 days; we use the 7-day window as the primary trigger
    // (long enough to separate noise from a real streak, short enough to react
    // within a week) and keep 3/5/14 as supporting context in the returned
    // record for a later dashboard, without wiring them into the state machine.
    static final int DRIFT_PRIMARY_WINDOW_DAYS = 7;
    static final int[] DRIFT_CONTEXT_WINDOW_DAYS = {3, 5, 14};
    // Need at least this many graded days in the primary window before trusting
    // a drift/regime verdict at all -- otherwise 2 bad days out of 2 look like a
    // 100% streak. Below this, the state can only be NORMAL or ANOMALOUS.
    static final int DRIFT_MIN_SAMPLES = 4;

    // MAE ratio = recent-window robust MAE / historical (in-sample) MAE.
    // Deliberately loose starting points per the doc's "avoid hardcoding overly
    // aggressive thresholds initially": 1.5x is a real but plausible bad week,
    // 2.0x is meaningfully worse than the model's own fit error.
    static final double DRIFT_MAE_RATIO_THRESHOLD  = 1.5;
    static final double REGIME_MAE_RATIO_THRESHOLD = 2.0;

    // Directional streak = consecutive freshest-per-day residuals (newest-first)
    // sharing the same sign. 3 same-direction days out of a 7-day window is
    // already a majority and worth flagging as suspected drift; 5+ in a row is
    // a strong, unlikely-by-chance run (doc's example: +18,+21,+19,+23,+20) that
    // graduates to a regime-change suspicion.
    static final int DRIFT_STREAK_THRESHOLD  = 3;
    static final int REGIME_STREAK_THRESHOLD = 5;

    // ── Hourly-anomaly classification tuning (doc §8) ────────────
    // Explains a daily residual by SHAPE: given a day's actual hourly breakdown
    // vs. the learned expected shape, classify WHERE the excess/deficit lives.
    // Diagnostic only — never feeds training or the retrain schedule (doc §9).
    //
    // A daily residual is only worth decomposing once it clears a significance
    // floor: the larger of an absolute kWh floor and a fraction of the predicted
    // total (so a big house-day and a small one scale the same). Below it the day
    // is NORMAL and we don't over-interpret hourly noise.
    static final double HOURLY_ANOMALY_MIN_RESIDUAL_KWH  = 5.0;
    static final double HOURLY_ANOMALY_MIN_RESIDUAL_FRAC = 0.10;
    // Concentration is measured as: how many hours (taken largest-first) it takes
    // to accumulate this fraction of the same-direction excess. Few hours => the
    // anomaly is concentrated; many hours => it is spread out.
    static final double HOURLY_CONCENTRATION_FRAC = 0.70;
    // <=3 hours carrying 70% of the excess is a localized spike (one load/event).
    static final int    HOURLY_SPIKE_MAX_HOURS    = 3;
    // Needing >=12 hours (half the day) to reach 70% means the lift is diffuse:
    // a baseline shift rather than any single daypart.
    static final int    HOURLY_BASELINE_MIN_HOURS = 12;
    // Overnight window (11pm–5am, 7 hours = 29% of the day). If it carries >=50%
    // of the excess it is over-represented -> persistent-overnight-increase shape.
    static final double HOURLY_OVERNIGHT_SHARE    = 0.50;
    static final int[]  OVERNIGHT_HOURS = {23, 0, 1, 2, 3, 4, 5};

    @Value("${app.kwh-rate:0.12}")
    private double kwhRate;

    private final JdbcTemplate jdbc;
    private final ForecastModelRepository modelRepo;
    private final ForecastSnapshotRepository snapshotRepo;
    private final AppEventService appEventService;

    public ForecastService(JdbcTemplate jdbc,
                           ForecastModelRepository modelRepo,
                           ForecastSnapshotRepository snapshotRepo,
                           AppEventService appEventService) {
        this.jdbc = jdbc;
        this.modelRepo = modelRepo;
        this.snapshotRepo = snapshotRepo;
        this.appEventService = appEventService;
    }

    // ── Public API ──────────────────────────────────────────

    public Optional<ForecastModel> getActiveModel() {
        return modelRepo.findFirstByOrderByCreatedAtDesc();
    }

    public List<ForecastSnapshot> getForecastRange(LocalDate start, LocalDate end) {
        return snapshotRepo.findByTargetDateBetweenOrderByTargetDateAsc(start, end);
    }

    public AccuracyReport getAccuracy(int trailingDays) {
        LocalDate since = LocalDate.now().minusDays(trailingDays);
        List<ForecastSnapshot> actuals = snapshotRepo.findWithActualsSince(since);
        if (actuals.isEmpty()) return new AccuracyReport(0, 0, 0, 0, 0, List.of());

        double sumAbsErr = 0, sumAbsPctErr = 0, sumSqErr = 0;
        int count = 0;
        List<AccuracyPoint> points = new ArrayList<>();

        for (ForecastSnapshot s : actuals) {
            if (s.getActualKwh() == null || s.getPredictedKwh() == null) continue;
            double pred = s.getPredictedKwh().doubleValue();
            double actual = s.getActualKwh().doubleValue();
            double err = Math.abs(pred - actual);
            sumAbsErr += err;
            sumSqErr += err * err;
            if (actual > 0) sumAbsPctErr += err / actual;
            count++;
            points.add(new AccuracyPoint(s.getTargetDate().toString(), pred, actual, err));
        }

        if (count == 0) return new AccuracyReport(0, 0, 0, 0, 0, List.of());
        double mae = sumAbsErr / count;
        double rmse = Math.sqrt(sumSqErr / count);
        double mape = (sumAbsPctErr / count) * 100;

        return new AccuracyReport(count, round2(mae), round2(rmse), round2(mape), trailingDays, points);
    }

    // ── Training ────────────────────────────────────────────

    public ForecastModel trainModel() {
        List<DailyDataPoint> data = loadTrainingData();
        if (data.size() < MIN_DATA_POINTS) {
            log.warn("ForecastService: only {} data points, need at least {}", data.size(), MIN_DATA_POINTS);
            return null;
        }

        // Phase 1: CDD/HDD multiple regression, fit robustly (Huber IRLS) on the
        // FULL history. A single extreme day (doc's example: expected 65, actual
        // 140) no longer drags the intercept/CDD/HDD coefficients — it keeps full
        // least-squares influence only while within HUBER_K robust-sigmas, then
        // its leverage is tapered. The original actual values are untouched: the
        // down-weighting lives only inside the fit, so every historical kwh stays
        // queryable for diagnostics / anomaly scoring.
        double[] kwhArr = new double[data.size()];
        double[][] xArr = new double[data.size()][2];
        for (int i = 0; i < data.size(); i++) {
            kwhArr[i] = data.get(i).kwh;
            xArr[i][0] = data.get(i).cdd;
            xArr[i][1] = data.get(i).hdd;
        }

        double[] coeffs = robustRegression(kwhArr, xArr);
        double intercept = coeffs[0], cddCoeff = coeffs[1], hddCoeff = coeffs[2];

        // Guard: singular matrix produces NaN/Inf — fall back to mean-based model
        if (!Double.isFinite(intercept) || !Double.isFinite(cddCoeff) || !Double.isFinite(hddCoeff)) {
            log.warn("ForecastService: OLS produced non-finite coefficients — falling back to mean model");
            intercept = Arrays.stream(kwhArr).average().orElse(0);
            cddCoeff = 0;
            hddCoeff = 0;
        }

        // R-squared
        double meanY = Arrays.stream(kwhArr).average().orElse(0);
        double ssTot = 0, ssRes = 0;
        for (int i = 0; i < data.size(); i++) {
            double predicted = intercept + cddCoeff * xArr[i][0] + hddCoeff * xArr[i][1];
            ssRes += Math.pow(kwhArr[i] - predicted, 2);
            ssTot += Math.pow(kwhArr[i] - meanY, 2);
        }
        double rSquared = ssTot > 0 ? 1.0 - (ssRes / ssTot) : 0;

        // MAE
        double sumAbsErr = 0;
        for (int i = 0; i < data.size(); i++) {
            double predicted = intercept + cddCoeff * xArr[i][0] + hddCoeff * xArr[i][1];
            sumAbsErr += Math.abs(kwhArr[i] - predicted);
        }
        double mae = sumAbsErr / data.size();

        // MAPE
        double sumAbsPctErr = 0;
        int mapeCount = 0;
        for (int i = 0; i < data.size(); i++) {
            if (kwhArr[i] > 0) {
                double predicted = intercept + cddCoeff * xArr[i][0] + hddCoeff * xArr[i][1];
                sumAbsPctErr += Math.abs(kwhArr[i] - predicted) / kwhArr[i];
                mapeCount++;
            }
        }
        double mape = mapeCount > 0 ? (sumAbsPctErr / mapeCount) * 100 : 0;

        // Phase 1 DOW adjustments: ratio of actual to regression-predicted, by day of week
        Map<DayOfWeek, List<Double>> dowRatios = new EnumMap<>(DayOfWeek.class);
        for (DailyDataPoint dp : data) {
            double predicted = intercept + cddCoeff * dp.cdd + hddCoeff * dp.hdd;
            if (predicted > 0) {
                dowRatios.computeIfAbsent(dp.dow, k -> new ArrayList<>()).add(dp.kwh / predicted);
            }
        }
        // Robust DOW factor: MEDIAN of the actual/predicted ratios per weekday,
        // not the arithmetic mean. Per-weekday samples are tiny (~7 with 49 total
        // points), so one bizarre Monday would otherwise permanently skew the
        // Monday multiplier; the median shrugs it off.
        Map<String, Double> dowAdj = new HashMap<>();
        for (var e : dowRatios.entrySet()) {
            double med = median(e.getValue());
            dowAdj.put(e.getKey().name(), round4(Double.isNaN(med) ? 1.0 : med));
        }

        // Phase 2: Hourly load shape profiles
        Map<String, Object> hourlyProfiles = buildHourlyProfiles(data);

        // Phase 3: Seasonal factors — computed from DOW-adjusted residuals so the
        // two corrections don't double-count day-of-week effects.
        Map<String, Double> seasonalFactors = buildSeasonalFactors(data, intercept, cddCoeff, hddCoeff, dowAdj);

        LocalDate start = data.get(0).date;
        LocalDate end = data.get(data.size() - 1).date;

        ForecastModel model = ForecastModel.builder()
                .dataPointsUsed(data.size())
                .rSquared(BigDecimal.valueOf(rSquared))
                .mae(BigDecimal.valueOf(mae))
                .mape(BigDecimal.valueOf(mape))
                .intercept(BigDecimal.valueOf(intercept))
                .cddCoeff(BigDecimal.valueOf(cddCoeff))
                .hddCoeff(BigDecimal.valueOf(hddCoeff))
                .dowAdjustments(dowAdj)
                .hourlyProfiles(hourlyProfiles)
                .seasonalFactors(seasonalFactors)
                .trainingStart(start)
                .trainingEnd(end)
                .build();

        model = modelRepo.save(model);
        log.info("ForecastService: trained model #{} — {} points, R²={}, MAE={}, MAPE={}%",
                model.getId(), data.size(),
                String.format("%.4f", rSquared),
                String.format("%.2f", mae),
                String.format("%.1f", mape));

        appEventService.info("forecast", "ForecastService",
                String.format("Model #%d trained: %d data points, R²=%.4f, MAE=%.2f kWh, MAPE=%.1f%%",
                        model.getId(), data.size(), rSquared, mae, mape));

        return model;
    }

    // ── Prediction ──────────────────────────────────────────

    public double predict(ForecastModel model, double avgTempF, DayOfWeek dow, int month) {
        double cdd = Math.max(0, avgTempF - COMFORT_BASE);
        double hdd = Math.max(0, COMFORT_BASE - avgTempF);
        double base = model.getIntercept().doubleValue()
                + model.getCddCoeff().doubleValue() * cdd
                + model.getHddCoeff().doubleValue() * hdd;

        // DOW adjustment
        Double dowFactor = model.getDowAdjustments().get(dow.name());
        if (dowFactor != null && dowFactor > 0) base *= dowFactor;

        // Seasonal adjustment (Phase 3)
        Double seasonFactor = model.getSeasonalFactors().get(String.valueOf(month));
        if (seasonFactor != null && seasonFactor > 0) base *= seasonFactor;

        return Math.max(0, base);
    }

    public List<DailyForecast> generateForecasts(ForecastModel model, List<WeatherForecastDay> forecastWeather) {
        // Recency-weighted residual spread (kWh) drives the band width. A single
        // sigma is applied additively around each day's projection (homoscedastic
        // band, consistent with the OLS assumption), rather than the old
        // percentage-of-prediction margin gated by an all-time confidence score.
        double sigma = computeIntervalSigma(model, LocalDate.now());

        List<DailyForecast> results = new ArrayList<>();
        for (WeatherForecastDay wx : forecastWeather) {
            double kwh = predict(model, wx.avgTemp, wx.date.getDayOfWeek(), wx.date.getMonthValue());
            double cost = kwh * kwhRate;
            double cdd = Math.max(0, wx.avgTemp - COMFORT_BASE);
            double hdd = Math.max(0, COMFORT_BASE - wx.avgTemp);

            double confidencePct;
            double margin;
            if (sigma > 0) {
                // Absolute band from recent out-of-sample error.
                margin = BAND_Z * sigma;
                // Report an equivalent confidence for the KPI/tooltip: tight band
                // relative to the day's projection => high confidence.
                confidencePct = kwh > 0
                        ? Math.max(0.05, Math.min(0.99, 1.0 - margin / kwh))
                        : 0.05;
            } else {
                // Cold start: no graded history and no usable in-sample MAE — fall
                // back to the legacy data-volume/R² confidence heuristic.
                confidencePct = computeConfidence(model, wx.date);
                margin = kwh * (1.0 - confidencePct);
            }

            double lower = Math.max(0, kwh - margin);
            results.add(new DailyForecast(
                    wx.date.toString(), round2(kwh), round2(cost),
                    round2(lower), round2(kwh + margin),
                    round2(wx.highTemp), round2(wx.lowTemp), round2(wx.avgTemp),
                    round2(cdd), round2(hdd), round2(confidencePct * 100)));
        }
        return results;
    }

    /**
     * Recency-weighted residual spread (kWh) used as the confidence-band sigma.
     *
     * <p>Primary signal: the model's <em>out-of-sample</em> forecast errors —
     * graded {@link ForecastSnapshot}s where an actual reading has since arrived.
     * For each target day we keep only the freshest prediction (latest
     * {@code forecast_date}) so a single day isn't over-counted by its 0..N-day-
     * ahead predictions, and so the spread reflects the model's real operational
     * skill rather than being inflated by long-horizon guesses. Each residual is
     * weighted by {@code 0.5^(ageDays / BAND_HALFLIFE_DAYS)}, ageDays measured
     * from today to the target date — so the band tightens within days when
     * recent predictions land and widens just as fast when they miss.
     *
     * <p>Cold-start fallback (fewer than {@link #BAND_MIN_SAMPLES} graded days):
     * the model's in-sample MAE scaled to a std-equivalent, so the band is still
     * defined on day one. Returns {@code -1} only when even that is unavailable,
     * signalling the caller to use the legacy confidence heuristic.
     */
    double computeIntervalSigma(ForecastModel model, LocalDate today) {
        LocalDate since = today.minusDays(BAND_WINDOW_DAYS);
        List<ForecastSnapshot> graded;
        try {
            graded = snapshotRepo.findRecentWithActuals(since);
        } catch (Exception e) {
            log.warn("ForecastService: recent-residual query failed, using in-sample fallback: {}", e.getMessage());
            graded = List.of();
        }

        // Freshest prediction per target day.
        Map<LocalDate, ForecastSnapshot> freshest = new HashMap<>();
        for (ForecastSnapshot s : graded) {
            if (s.getActualKwh() == null || s.getPredictedKwh() == null) continue;
            freshest.merge(s.getTargetDate(), s,
                    (a, b) -> a.getForecastDate().isAfter(b.getForecastDate()) ? a : b);
        }

        if (freshest.size() >= BAND_MIN_SAMPLES) {
            List<double[]> residualAge = new ArrayList<>(freshest.size());
            for (ForecastSnapshot s : freshest.values()) {
                double resid = s.getPredictedKwh().doubleValue() - s.getActualKwh().doubleValue();
                long age = Math.max(0, ChronoUnit.DAYS.between(s.getTargetDate(), today));
                residualAge.add(new double[]{resid, age});
            }
            double sigma = recencyWeightedRobustSigma(residualAge, BAND_HALFLIFE_DAYS);
            if (Double.isFinite(sigma) && sigma > 0) return sigma;
        }

        // Cold-start fallback: in-sample MAE -> std-equivalent.
        if (model.getMae() != null && model.getMae().doubleValue() > 0) {
            return model.getMae().doubleValue() * MAE_TO_STD;
        }
        return -1;
    }

    /**
     * Exponentially recency-weighted <em>robust</em> residual scale (a
     * std-equivalent). Each element is {@code [residual, ageDays]}; weight is
     * {@code 0.5^(ageDays/halfLifeDays)}.
     *
     * <p>This replaces the former squared-error RMS. Squaring let a single
     * extreme residual dominate the aggregate, so one fluke day would keep the
     * band inflated for most of a week. Instead we take the recency-weighted
     * MEDIAN of the absolute residuals (spread about zero, matching the OLS
     * assumption that residuals sum to ~0) and scale it by {@link #MAD_TO_STD}
     * to be std-equivalent. A lone spike sits at the tail of the sorted
     * magnitudes and never becomes the weighted median, so it barely moves the
     * estimate — yet a persistently elevated run shifts the whole distribution
     * and the median rises with it. Pure/stateless for unit testing.
     */
    static double recencyWeightedRobustSigma(List<double[]> residualAge, double halfLifeDays) {
        if (residualAge.isEmpty()) return Double.NaN;
        List<double[]> absWeighted = new ArrayList<>(residualAge.size());
        for (double[] ra : residualAge) {
            double w = Math.pow(0.5, ra[1] / halfLifeDays);
            absWeighted.add(new double[]{Math.abs(ra[0]), w});
        }
        double wMedian = weightedMedian(absWeighted);
        return Double.isNaN(wMedian) ? Double.NaN : MAD_TO_STD * wMedian;
    }

    // ── Anomaly scoring ─────────────────────────────────────────

    /**
     * Score a single graded observation (actual vs. predicted) against the
     * model's current robust residual scale. Convenience entry point that pulls
     * the scale from {@link #computeIntervalSigma} — the same recency-weighted
     * robust spread that drives the confidence band — so "how wide is the band"
     * and "how anomalous is this day" stay on one consistent yardstick.
     *
     * <p>Not persisted and not exposed via any endpoint yet — that's later
     * dashboard/drift work. It is a real, callable, unit-testable method so a
     * follow-up phase can query it (e.g. to feed drift-state detection) rather
     * than re-deriving the scale.
     */
    public AnomalyScore scoreObservation(ForecastModel model, LocalDate asOf, double actual, double predicted) {
        double scale = computeIntervalSigma(model, asOf);
        return scoreAnomaly(actual, predicted, scale);
    }

    /**
     * Robust z-score of a residual and its classification. {@code robustScale}
     * is the std-equivalent robust spread (e.g. from
     * {@link #recencyWeightedRobustSigma}); a non-positive/non-finite scale means
     * "no usable spread yet" and yields a {@code z} of 0 / NORMAL rather than a
     * divide-by-zero. Sign convention: residual = actual - predicted (positive =
     * consumed more than forecast). Pure/stateless for unit testing.
     */
    static AnomalyScore scoreAnomaly(double actual, double predicted, double robustScale) {
        double residual = actual - predicted;
        double z = (Double.isFinite(robustScale) && robustScale > 0) ? residual / robustScale : 0.0;
        double absZ = Math.abs(z);
        AnomalyClass cls;
        if (absZ >= SEVERE_Z_THRESHOLD)       cls = AnomalyClass.SEVERE;
        else if (absZ >= ANOMALY_Z_THRESHOLD) cls = AnomalyClass.ANOMALOUS;
        else                                   cls = AnomalyClass.NORMAL;
        return new AnomalyScore(actual, predicted, residual, Math.abs(residual), robustScale, z, cls);
    }

    // ── Drift / regime-change detection (Phase 2) ────────────────

    /**
     * DB-querying entry point: assesses whether recent forecast errors look
     * like an isolated anomaly, a suspected drift, or a suspected regime
     * change, using the same freshest-prediction-per-target-day graded
     * {@link ForecastSnapshot} pattern as {@link #computeIntervalSigma}. Does
     * NOT feed back into training or retraining — purely diagnostic. Logs a
     * WARN app event (category "forecast") when the state is non-NORMAL so it
     * surfaces in the Debug Dashboard's Forecast Events panel.
     */
    public DriftAssessment assessDrift(LocalDate asOf) {
        Optional<ForecastModel> modelOpt = getActiveModel();
        if (modelOpt.isEmpty()) {
            return new DriftAssessment(asOf, 0, Double.NaN, Double.NaN, Double.NaN,
                    Double.NaN, 0, 0, Map.of(), DriftState.NORMAL);
        }
        ForecastModel model = modelOpt.get();
        double historicalMae = model.getMae() != null ? model.getMae().doubleValue() : Double.NaN;

        int maxWindow = DRIFT_PRIMARY_WINDOW_DAYS;
        for (int w : DRIFT_CONTEXT_WINDOW_DAYS) maxWindow = Math.max(maxWindow, w);

        List<ForecastSnapshot> graded;
        try {
            graded = snapshotRepo.findRecentWithActuals(asOf.minusDays(maxWindow));
        } catch (Exception e) {
            log.warn("ForecastService: drift-assessment query failed: {}", e.getMessage());
            graded = List.of();
        }

        // Freshest prediction per target day, restricted to <= asOf (no leakage
        // from snapshots the caller shouldn't be able to see yet).
        Map<LocalDate, ForecastSnapshot> freshest = new HashMap<>();
        for (ForecastSnapshot s : graded) {
            if (s.getActualKwh() == null || s.getPredictedKwh() == null) continue;
            if (s.getTargetDate().isAfter(asOf)) continue;
            freshest.merge(s.getTargetDate(), s,
                    (a, b) -> a.getForecastDate().isAfter(b.getForecastDate()) ? a : b);
        }

        List<LocalDate> datesDesc = new ArrayList<>(freshest.keySet());
        datesDesc.sort(Comparator.reverseOrder());

        List<Double> residualsNewestFirst = new ArrayList<>(datesDesc.size());
        for (LocalDate d : datesDesc) {
            ForecastSnapshot s = freshest.get(d);
            residualsNewestFirst.add(s.getActualKwh().doubleValue() - s.getPredictedKwh().doubleValue());
        }

        List<Double> primary = residualsNewestFirst.stream()
                .limit(DRIFT_PRIMARY_WINDOW_DAYS).collect(Collectors.toList());
        Map<Integer, List<Double>> contextByWindow = new LinkedHashMap<>();
        for (int w : DRIFT_CONTEXT_WINDOW_DAYS) {
            contextByWindow.put(w, residualsNewestFirst.stream().limit(w).collect(Collectors.toList()));
        }

        DriftAssessment assessment = computeDriftAssessment(asOf, historicalMae, primary, contextByWindow);

        if (assessment.state() != DriftState.NORMAL) {
            appEventService.warn("forecast", "ForecastService", String.format(
                    "Drift assessment: %s — historical MAE=%.2f kWh, recent %d-day MAE=%.2f kWh (ratio %.2fx), " +
                    "median residual=%+.2f kWh, streak=%d day(s) %s",
                    assessment.state(), assessment.historicalMae(), DRIFT_PRIMARY_WINDOW_DAYS,
                    assessment.recentMae(), assessment.maeRatio(), assessment.medianSignedResidual(),
                    assessment.streakLength(),
                    assessment.streakSign() > 0 ? "positive" : assessment.streakSign() < 0 ? "negative" : "mixed"));
        }
        return assessment;
    }

    /**
     * Pure drift computation given a historical (in-sample) MAE and the
     * primary-window residuals (newest-first, {@code actual - predicted}) plus
     * a map of window-size -> residuals for supporting context ratios (not
     * used in the state decision itself, carried for a later dashboard).
     * Stateless/testable — no DB access.
     */
    static DriftAssessment computeDriftAssessment(LocalDate asOf, double historicalMae,
                                                   List<Double> primaryResidualsNewestFirst,
                                                   Map<Integer, List<Double>> contextResidualsByWindow) {
        int sampleCount = primaryResidualsNewestFirst.size();
        double recentMae = mae(primaryResidualsNewestFirst);
        double maeRatio = (historicalMae > 0 && Double.isFinite(recentMae)) ? recentMae / historicalMae : Double.NaN;
        double medianSignedResidual = median(primaryResidualsNewestFirst);
        int[] streak = computeStreak(primaryResidualsNewestFirst);

        DriftState state = sampleCount == 0
                ? DriftState.NORMAL
                : classifyDriftState(sampleCount, maeRatio, streak[0], streak[1]);

        Map<Integer, Double> contextRatios = new LinkedHashMap<>();
        for (var e : contextResidualsByWindow.entrySet()) {
            double m = mae(e.getValue());
            contextRatios.put(e.getKey(),
                    (historicalMae > 0 && Double.isFinite(m)) ? m / historicalMae : Double.NaN);
        }

        return new DriftAssessment(asOf, sampleCount, historicalMae, recentMae, maeRatio,
                medianSignedResidual, streak[0], streak[1], contextRatios, state);
    }

    /**
     * State machine over the primary-window metrics. Deliberately conservative
     * per the doc's "avoid hardcoding overly aggressive thresholds initially":
     * <ul>
     *   <li>Fewer than {@link #DRIFT_MIN_SAMPLES} graded days: too little
     *       evidence to claim a persistent pattern either way — at most
     *       ANOMALOUS (magnitude only), never DRIFT/REGIME.</li>
     *   <li>A same-direction streak of {@link #DRIFT_STREAK_THRESHOLD}+ days is
     *       drift-worthy on its own (directional consistency is the signal,
     *       independent of how big the ratio is yet).</li>
     *   <li>Promotion to REGIME_CHANGE_SUSPECTED additionally requires both a
     *       longer streak ({@link #REGIME_STREAK_THRESHOLD}) AND a bigger ratio
     *       ({@link #REGIME_MAE_RATIO_THRESHOLD}) than plain drift — sustained
     *       AND large, not just one or the other.</li>
     *   <li>No qualifying streak but the recent MAE ratio alone clears
     *       {@link #DRIFT_MAE_RATIO_THRESHOLD}: ANOMALOUS (big errors, no
     *       evidence yet they're one-directional).</li>
     * </ul>
     */
    static DriftState classifyDriftState(int sampleCount, double maeRatio, int streakLength, int streakSign) {
        boolean magnitudeAnomalous = Double.isFinite(maeRatio) && maeRatio >= DRIFT_MAE_RATIO_THRESHOLD;

        if (sampleCount < DRIFT_MIN_SAMPLES) {
            return magnitudeAnomalous ? DriftState.ANOMALOUS : DriftState.NORMAL;
        }

        boolean directionalStreak = streakSign != 0 && streakLength >= DRIFT_STREAK_THRESHOLD;
        if (directionalStreak) {
            boolean regime = streakLength >= REGIME_STREAK_THRESHOLD && maeRatio >= REGIME_MAE_RATIO_THRESHOLD;
            return regime ? DriftState.REGIME_CHANGE_SUSPECTED : DriftState.DRIFT_SUSPECTED;
        }

        return magnitudeAnomalous ? DriftState.ANOMALOUS : DriftState.NORMAL;
    }

    /** Mean absolute value of a residual list; NaN for empty. */
    static double mae(List<Double> residuals) {
        if (residuals.isEmpty()) return Double.NaN;
        return residuals.stream().mapToDouble(Math::abs).average().orElse(Double.NaN);
    }

    /**
     * Length and sign of the leading same-direction run in a newest-first
     * residual list. Returns {@code {length, sign}} where sign is +1/-1, or
     * {@code {0, 0}} if the list is empty or the newest residual is exactly 0.
     */
    static int[] computeStreak(List<Double> residualsNewestFirst) {
        if (residualsNewestFirst.isEmpty()) return new int[]{0, 0};
        int sign = (int) Math.signum(residualsNewestFirst.get(0));
        if (sign == 0) return new int[]{0, 0};
        int len = 0;
        for (double r : residualsNewestFirst) {
            if ((int) Math.signum(r) == sign) len++;
            else break;
        }
        return new int[]{len, sign};
    }

    @SuppressWarnings("unchecked")
    public List<HourlyForecast> generateHourlyForecast(ForecastModel model, LocalDate date, double avgTemp) {
        double dailyKwh = predict(model, avgTemp, date.getDayOfWeek(), date.getMonthValue());

        // Look up hourly profile from Phase 2
        Map<String, Object> profiles = model.getHourlyProfiles();
        String profileKey = selectProfileKey(avgTemp, date.getDayOfWeek());
        List<Double> shape = null;
        if (profiles.containsKey(profileKey)) {
            Object val = profiles.get(profileKey);
            if (val instanceof List<?> list && !list.isEmpty()) {
                shape = ((List<Object>) list).stream()
                        .map(o -> ((Number) o).doubleValue())
                        .collect(Collectors.toList());
            }
        }

        // Fallback: flat distribution
        if (shape == null || shape.size() != 24) {
            shape = Collections.nCopies(24, 1.0 / 24);
        }

        // Normalize shape weights
        double shapeSum = shape.stream().mapToDouble(d -> d).sum();
        List<HourlyForecast> hours = new ArrayList<>();
        for (int h = 0; h < 24; h++) {
            double fraction = shapeSum > 0 ? shape.get(h) / shapeSum : 1.0 / 24;
            double kwh = dailyKwh * fraction;
            hours.add(new HourlyForecast(h, round2(kwh), round2(kwh * kwhRate)));
        }
        return hours;
    }

    /**
     * Classify the SHAPE of a daily anomaly from its hourly breakdown (doc §8):
     * why was the daily forecast wrong — a one-off spike, a whole-day baseline
     * shift, a specific daypart, or a persistent overnight lift?
     *
     * <p>Pure and testable: takes the authoritative daily {@code actualTotal} vs.
     * {@code predictedTotal}, the day's {@code actualHourly} kWh (length 24), and
     * the learned normalized {@code expectedShape} (same 24-fraction list
     * {@link #generateHourlyForecast} consumes; flat 1/24 is substituted if it is
     * absent). Never touches the DB, the model, or training — this is dashboard
     * explanation only (doc §9: hourly anomalies must not poison daily training).
     *
     * <p>Method: expected[h] = predictedTotal · shape[h]; residual[h] = actual −
     * expected. The daily residual sets the direction of interest; each hour's
     * same-direction excess is its contribution. Decision chain (first match wins):
     * <ol>
     *   <li>|dailyResidual| below the significance floor -> {@code NORMAL}.</li>
     *   <li>&le;{@link #HOURLY_SPIKE_MAX_HOURS} hours hold
     *       {@link #HOURLY_CONCENTRATION_FRAC} of the excess -> {@code LOCALIZED_SPIKE}.</li>
     *   <li>overnight window holds &ge;{@link #HOURLY_OVERNIGHT_SHARE} of the
     *       excess -> {@code OVERNIGHT_INCREASE}.</li>
     *   <li>it takes &ge;{@link #HOURLY_BASELINE_MIN_HOURS} hours to reach the
     *       concentration fraction -> {@code BASELINE_SHIFT}.</li>
     *   <li>otherwise the excess sits in a mid-sized daypart -> {@code TIME_OF_DAY_SHIFT}.</li>
     * </ol>
     *
     * <p>Single-day limitation (doc §8): "time-of-day shift" and "overnight
     * increase" properly mean a pattern that <i>repeats</i> across days. From one
     * day in isolation we can only detect that the excess is concentrated in that
     * daypart, not that it recurs — multi-day tracking is out of scope here.
     */
    public static HourlyAnomaly classifyHourlyAnomaly(
            double predictedTotal, double actualTotal,
            double[] actualHourly, List<Double> expectedShape) {

        double[] shape = normalizedShapeOrFlat(expectedShape);
        double[] resid = new double[24];
        for (int h = 0; h < 24; h++) {
            double expected = predictedTotal * shape[h];
            double actual = (actualHourly != null && h < actualHourly.length) ? actualHourly[h] : 0.0;
            resid[h] = actual - expected;
        }

        double dailyResidual = actualTotal - predictedTotal;
        double sign = Math.signum(dailyResidual);
        double floor = Math.max(HOURLY_ANOMALY_MIN_RESIDUAL_KWH,
                                HOURLY_ANOMALY_MIN_RESIDUAL_FRAC * Math.abs(predictedTotal));
        if (sign == 0 || Math.abs(dailyResidual) < floor) {
            return new HourlyAnomaly(HourlyAnomalyClass.NORMAL, dailyResidual, 0, 0, 0, new int[0], resid);
        }

        // Per-hour contribution in the anomaly's direction (0 if it pushes back).
        double[] contrib = new double[24];
        double totalExcess = 0;
        for (int h = 0; h < 24; h++) {
            double c = sign * resid[h];
            contrib[h] = c > 0 ? c : 0;
            totalExcess += contrib[h];
        }
        if (totalExcess <= 0) {
            return new HourlyAnomaly(HourlyAnomalyClass.NORMAL, dailyResidual, 0, 0, 0, new int[0], resid);
        }

        Integer[] order = new Integer[24];
        for (int h = 0; h < 24; h++) order[h] = h;
        Arrays.sort(order, (a, b) -> Double.compare(contrib[b], contrib[a]));

        // k = minimal hours (largest-first) to reach the concentration fraction.
        double cum = 0;
        int k = 0;
        for (int i = 0; i < 24; i++) {
            if (contrib[order[i]] <= 0) break;
            cum += contrib[order[i]];
            k++;
            if (cum >= HOURLY_CONCENTRATION_FRAC * totalExcess) break;
        }

        double overnightExcess = 0;
        for (int h : OVERNIGHT_HOURS) overnightExcess += contrib[h];
        double overnightShare = overnightExcess / totalExcess;

        int topN = Math.min(k, 5);
        int[] topHours = new int[topN];
        for (int i = 0; i < topN; i++) topHours[i] = order[i];

        HourlyAnomalyClass cls;
        if (k <= HOURLY_SPIKE_MAX_HOURS) {
            cls = HourlyAnomalyClass.LOCALIZED_SPIKE;
        } else if (overnightShare >= HOURLY_OVERNIGHT_SHARE) {
            cls = HourlyAnomalyClass.OVERNIGHT_INCREASE;
        } else if (k >= HOURLY_BASELINE_MIN_HOURS) {
            cls = HourlyAnomalyClass.BASELINE_SHIFT;
        } else {
            cls = HourlyAnomalyClass.TIME_OF_DAY_SHIFT;
        }

        return new HourlyAnomaly(cls, dailyResidual, round2(totalExcess), k,
                round4(overnightShare), topHours, resid);
    }

    /** Normalize a 24-element shape to fractions summing to 1; flat 1/24 if absent. */
    private static double[] normalizedShapeOrFlat(List<Double> shape) {
        double[] out = new double[24];
        if (shape != null && shape.size() == 24) {
            double sum = 0;
            for (double v : shape) sum += v;
            if (sum > 0) {
                for (int h = 0; h < 24; h++) out[h] = shape.get(h) / sum;
                return out;
            }
        }
        Arrays.fill(out, 1.0 / 24);
        return out;
    }

    // ── Snapshot management ─────────────────────────────────

    public void saveForecasts(ForecastModel model, List<DailyForecast> forecasts) {
        LocalDate today = LocalDate.now();
        for (DailyForecast f : forecasts) {
            LocalDate target = LocalDate.parse(f.date);
            Optional<ForecastSnapshot> existing = snapshotRepo.findByForecastDateAndTargetDate(today, target);
            if (existing.isPresent()) continue;

            ForecastSnapshot snap = ForecastSnapshot.builder()
                    .model(model)
                    .forecastDate(today)
                    .targetDate(target)
                    .predictedKwh(BigDecimal.valueOf(f.predictedKwh))
                    .predictedCost(BigDecimal.valueOf(f.predictedCost))
                    .weatherHigh(f.weatherHigh != null ? BigDecimal.valueOf(f.weatherHigh) : null)
                    .weatherLow(f.weatherLow != null ? BigDecimal.valueOf(f.weatherLow) : null)
                    .weatherAvg(f.weatherAvg != null ? BigDecimal.valueOf(f.weatherAvg) : null)
                    .cdd(f.cdd != null ? BigDecimal.valueOf(f.cdd) : null)
                    .hdd(f.hdd != null ? BigDecimal.valueOf(f.hdd) : null)
                    .build();
            try {
                snapshotRepo.save(snap);
            } catch (org.springframework.dao.DataIntegrityViolationException e) {
                log.debug("Snapshot already exists for {} -> {}", today, target);
            }
        }
    }

    public int backfillActuals() {
        List<ForecastSnapshot> pending = snapshotRepo.findByActualKwhIsNullAndTargetDateBefore(LocalDate.now());
        int filled = 0;
        for (ForecastSnapshot snap : pending) {
            Double actual = queryDailyKwh(snap.getTargetDate().toString());
            if (actual != null) {
                snap.setActualKwh(BigDecimal.valueOf(actual));
                snap.setActualCost(BigDecimal.valueOf(actual * kwhRate));
                snapshotRepo.save(snap);
                filled++;
            }
        }
        if (filled > 0) {
            log.info("ForecastService: backfilled {} actual readings", filled);
        }
        return filled;
    }

    // ── Phase 2: Hourly profiles ────────────────────────────

    private Map<String, Object> buildHourlyProfiles(List<DailyDataPoint> dailyData) {
        if (dailyData.isEmpty()) return Map.of();

        // Query hourly distribution grouped by temp regime + weekday/weekend
        Map<String, List<double[]>> buckets = new HashMap<>();
        try {
            var rows = jdbc.queryForList("""
                SELECT
                    EXTRACT(HOUR FROM h.timestamp) AS hr,
                    h.usage_kwh,
                    w.avg_temp_f,
                    EXTRACT(ISODOW FROM h.timestamp) AS dow
                FROM hourly_electric_usage h
                JOIN weather_observations w ON h.timestamp::date = w.observation_date
                WHERE h.usage_kwh > 0 AND w.avg_temp_f IS NOT NULL
                ORDER BY h.timestamp
                """);

            for (var row : rows) {
                int hr = ((Number) row.get("hr")).intValue();
                double kwh = ((Number) row.get("usage_kwh")).doubleValue();
                double temp = ((Number) row.get("avg_temp_f")).doubleValue();
                int dow = ((Number) row.get("dow")).intValue();
                boolean weekend = dow >= 6;

                String key = profileKey(temp, weekend);
                buckets.computeIfAbsent(key, k -> new ArrayList<>()).add(new double[]{hr, kwh});
            }
        } catch (Exception e) {
            log.warn("ForecastService: hourly profile query failed: {}", e.getMessage());
            return Map.of();
        }

        Map<String, Object> profiles = new HashMap<>();
        for (var entry : buckets.entrySet()) {
            profiles.put(entry.getKey(), robustHourlyShape(entry.getValue()));
        }
        return profiles;
    }

    /**
     * Build a normalized 24-hour consumption shape from {@code [hour, kWh]} pairs
     * using a per-hour <b>median</b> rather than an arithmetic mean.
     *
     * <p>Same reasoning as Phase 1's robust day-of-week multipliers: with only
     * ~49 daily observations a single anomalous hour on one day (e.g. a space
     * heater running one cold night) would permanently skew that hour's learned
     * fraction for its bucket if we averaged. The median of each hour's samples
     * shrugs off that one bizarre reading. Reuses {@link #median(List)}.
     *
     * <p>Drop-in for the old mean logic: same output contract — a 24-element
     * {@code List<Double>} of fractions summing to ~1 (0s if a bucket is empty),
     * so {@link #generateHourlyForecast} and its flat fallback are unchanged.
     */
    static List<Double> robustHourlyShape(List<double[]> hourKwhPairs) {
        List<List<Double>> byHour = new ArrayList<>(24);
        for (int h = 0; h < 24; h++) byHour.add(new ArrayList<>());
        for (double[] pair : hourKwhPairs) {
            int hr = (int) pair[0];
            if (hr >= 0 && hr < 24) byHour.get(hr).add(pair[1]);
        }
        List<Double> shape = new ArrayList<>(24);
        double total = 0;
        for (int h = 0; h < 24; h++) {
            double m = byHour.get(h).isEmpty() ? 0.0 : median(byHour.get(h));
            shape.add(m);
            total += m;
        }
        if (total > 0) {
            for (int h = 0; h < 24; h++) shape.set(h, shape.get(h) / total);
        }
        return shape;
    }

    private static String profileKey(double avgTemp, boolean weekend) {
        String regime = avgTemp >= 85 ? "hot" : avgTemp >= 65 ? "mild" : "cool";
        return regime + (weekend ? "_weekend" : "_weekday");
    }

    private static String selectProfileKey(double avgTemp, DayOfWeek dow) {
        boolean weekend = dow == DayOfWeek.SATURDAY || dow == DayOfWeek.SUNDAY;
        return profileKey(avgTemp, weekend);
    }

    // ── Phase 3: Seasonal factors ───────────────────────────

    private Map<String, Double> buildSeasonalFactors(List<DailyDataPoint> data,
                                                      double intercept, double cddCoeff, double hddCoeff,
                                                      Map<String, Double> dowAdj) {
        Map<Integer, List<Double>> monthRatios = new HashMap<>();
        for (DailyDataPoint dp : data) {
            double predicted = intercept + cddCoeff * dp.cdd + hddCoeff * dp.hdd;
            Double dowFactor = dowAdj.get(dp.dow.name());
            if (dowFactor != null && dowFactor > 0) predicted *= dowFactor;
            if (predicted > 0) {
                monthRatios.computeIfAbsent(dp.date.getMonthValue(), k -> new ArrayList<>())
                        .add(dp.kwh / predicted);
            }
        }

        // Only include months with enough data (5+ days)
        Map<String, Double> factors = new HashMap<>();
        for (var e : monthRatios.entrySet()) {
            if (e.getValue().size() >= 5) {
                double avg = e.getValue().stream().mapToDouble(d -> d).average().orElse(1.0);
                factors.put(String.valueOf(e.getKey()), round4(avg));
            }
        }
        return factors;
    }

    // ── Confidence ──────────────────────────────────────────

    // Legacy confidence heuristic. As of the recency-weighted band redesign this
    // is only the COLD-START fallback (used when there aren't yet enough graded
    // out-of-sample snapshots and the model has no in-sample MAE to lean on).
    // The steady-state band comes from computeIntervalSigma() instead.
    private double computeConfidence(ForecastModel model, LocalDate targetDate) {
        int dataPoints = model.getDataPointsUsed();
        int month = targetDate.getMonthValue();
        boolean hasSeasonal = model.getSeasonalFactors().containsKey(String.valueOf(month));

        // Base confidence from data volume: ramps faster and starts higher than
        // before (was 50% at 7 days / 80% at 60 days, which put a ~43-point model
        // at R²=0.27 down around confidence=0.49 -> a +/-51%-of-prediction band,
        // visibly too wide against the chart's actual scatter). Narrowed per
        // Bryan's explicit "make the band a bit tighter" ask (2026-09-06): now
        // ~70% at 7 days, ~87% at 45 days, caps at 95%.
        double base = Math.min(0.95, 0.55 + 0.40 * (1 - Math.exp(-dataPoints / 45.0)));

        // Penalty if this month hasn't been seen in training data (softened from
        // 0.75 -- still a real penalty, just not as harsh).
        if (!hasSeasonal) base *= 0.85;

        // Bonus from model fit -- softened floor (was 0.7) so a middling R² (this
        // is a simple weather-only OLS regression; real daily usage has a lot of
        // human-behavior variance it can't explain) doesn't single-handedly blow
        // the band back open the way it did before.
        double r2 = model.getRSquared() != null ? model.getRSquared().doubleValue() : 0;
        base *= (0.82 + 0.18 * r2);

        // Floor raised from 0.20 -> 0.35: caps the worst-case band at +/-65% of the
        // prediction instead of +/-80%, even for a brand-new/low-fit model.
        return Math.max(0.35, Math.min(0.95, base));
    }

    // ── Training data loader ────────────────────────────────

    private List<DailyDataPoint> loadTrainingData() {
        try {
            // Try hourly data first (more granular, HAVING >= 18 readings/day)
            List<DailyDataPoint> data = jdbc.query("""
                SELECT
                    h.timestamp::date AS day,
                    SUM(h.usage_kwh) AS total_kwh,
                    w.avg_temp_f,
                    w.high_temp_f,
                    w.low_temp_f,
                    COUNT(h.*) AS readings
                FROM hourly_electric_usage h
                JOIN weather_observations w ON h.timestamp::date = w.observation_date
                WHERE h.usage_kwh > 0 AND w.avg_temp_f IS NOT NULL
                GROUP BY h.timestamp::date, w.avg_temp_f, w.high_temp_f, w.low_temp_f
                HAVING COUNT(h.*) >= 18
                ORDER BY day
                """, (rs, rowNum) -> mapDataPoint(rs));

            if (data.size() >= MIN_DATA_POINTS) {
                return data;
            }

            // Fall back to daily electric_usage table
            log.info("ForecastService: hourly data insufficient ({} pts), falling back to daily electric_usage", data.size());
            return jdbc.query("""
                SELECT
                    e.timestamp::date AS day,
                    SUM(e.usage_kwh) AS total_kwh,
                    w.avg_temp_f,
                    w.high_temp_f,
                    w.low_temp_f,
                    COUNT(e.*) AS readings
                FROM electric_usage e
                JOIN weather_observations w ON e.timestamp::date = w.observation_date
                WHERE e.usage_kwh > 0 AND w.avg_temp_f IS NOT NULL
                GROUP BY e.timestamp::date, w.avg_temp_f, w.high_temp_f, w.low_temp_f
                ORDER BY day
                """, (rs, rowNum) -> mapDataPoint(rs));
        } catch (Exception e) {
            log.error("ForecastService: failed to load training data", e);
            return List.of();
        }
    }

    private DailyDataPoint mapDataPoint(java.sql.ResultSet rs) throws java.sql.SQLException {
        LocalDate date = rs.getDate("day").toLocalDate();
        double kwh = rs.getDouble("total_kwh");
        double avgTemp = rs.getDouble("avg_temp_f");
        double cdd = Math.max(0, avgTemp - COMFORT_BASE);
        double hdd = Math.max(0, COMFORT_BASE - avgTemp);
        return new DailyDataPoint(date, kwh, avgTemp, cdd, hdd, date.getDayOfWeek());
    }

    private Double queryDailyKwh(String date) {
        try {
            // Try hourly table first
            Double result = jdbc.queryForObject("""
                SELECT COALESCE(SUM(usage_kwh), 0)
                FROM hourly_electric_usage
                WHERE timestamp::date = ?::date AND usage_kwh > 0
                HAVING COUNT(*) >= 18
                """, Double.class, date);
            if (result != null) return result;
        } catch (Exception e) {
            // No hourly data for this date — fall through
        }
        try {
            return jdbc.queryForObject("""
                SELECT COALESCE(SUM(usage_kwh), 0)
                FROM electric_usage
                WHERE timestamp::date = ?::date AND usage_kwh > 0
                HAVING COUNT(*) >= 1
                """, Double.class, date);
        } catch (Exception e) {
            return null;
        }
    }

    // ── Robust / OLS multiple regression ────────────────────

    /**
     * Huber-loss robust regression via IRLS (iteratively reweighted least
     * squares). Seeds from plain OLS, then repeats: compute residuals → robust
     * residual scale via MAD → Huber-weight each point (full weight within
     * {@link #HUBER_K} robust-sigmas, tapered as k/|u| beyond) → refit as a
     * weighted OLS. Converges in a few passes; capped at {@link #IRLS_MAX_ITERS}.
     * Falls back to the OLS seed if the residual scale collapses (near-perfect
     * fit) or a weighted refit goes non-finite. Does not mutate {@code y}.
     */
    static double[] robustRegression(double[] y, double[][] x) {
        double[] coeffs = olsRegression(y, x);
        int n = y.length;
        for (int j = 0; j < coeffs.length; j++) {
            if (!Double.isFinite(coeffs[j])) return coeffs; // OLS already degenerate; guard handles it upstream
        }

        for (int iter = 0; iter < IRLS_MAX_ITERS; iter++) {
            double[] resid = new double[n];
            for (int i = 0; i < n; i++) {
                double pred = coeffs[0];
                for (int j = 0; j < x[i].length; j++) pred += coeffs[j + 1] * x[i][j];
                resid[i] = y[i] - pred;
            }

            double scale = madScale(resid);
            if (!(scale > 1e-9)) break; // residuals essentially zero -> nothing to down-weight

            double[] w = new double[n];
            for (int i = 0; i < n; i++) {
                double u = Math.abs(resid[i]) / scale;
                w[i] = u <= HUBER_K ? 1.0 : HUBER_K / u;
            }

            double[] next = weightedOlsRegression(y, x, w);
            boolean finite = true;
            double delta = 0;
            for (int j = 0; j < next.length; j++) {
                if (!Double.isFinite(next[j])) { finite = false; break; }
                delta += Math.abs(next[j] - coeffs[j]);
            }
            if (!finite) break; // keep last good estimate
            coeffs = next;
            if (delta < 1e-6) break; // converged
        }
        return coeffs;
    }

    static double[] olsRegression(double[] y, double[][] x) {
        return weightedOlsRegression(y, x, null); // uniform weights
    }

    /**
     * Weighted OLS: solves (X'WX) b = X'Wy with a diagonal weight matrix W.
     * {@code weights == null} means all-ones (plain OLS). Intercept column is
     * prepended internally.
     */
    private static double[] weightedOlsRegression(double[] y, double[][] x, double[] weights) {
        int n = y.length;
        int p = x[0].length;
        // X with intercept column prepended
        double[][] xm = new double[n][p + 1];
        for (int i = 0; i < n; i++) {
            xm[i][0] = 1.0;
            System.arraycopy(x[i], 0, xm[i], 1, p);
        }

        // X'WX
        double[][] xtx = new double[p + 1][p + 1];
        for (int i = 0; i < p + 1; i++) {
            for (int j = 0; j < p + 1; j++) {
                double sum = 0;
                for (int k = 0; k < n; k++) {
                    double wk = weights == null ? 1.0 : weights[k];
                    sum += wk * xm[k][i] * xm[k][j];
                }
                xtx[i][j] = sum;
            }
        }

        // X'Wy
        double[] xty = new double[p + 1];
        for (int i = 0; i < p + 1; i++) {
            double sum = 0;
            for (int k = 0; k < n; k++) {
                double wk = weights == null ? 1.0 : weights[k];
                sum += wk * xm[k][i] * y[k];
            }
            xty[i] = sum;
        }

        // Solve via Gaussian elimination
        return solveLinearSystem(xtx, xty);
    }

    private static double[] solveLinearSystem(double[][] a, double[] b) {
        int n = b.length;
        double[][] aug = new double[n][n + 1];
        for (int i = 0; i < n; i++) {
            System.arraycopy(a[i], 0, aug[i], 0, n);
            aug[i][n] = b[i];
        }

        for (int col = 0; col < n; col++) {
            int maxRow = col;
            for (int row = col + 1; row < n; row++) {
                if (Math.abs(aug[row][col]) > Math.abs(aug[maxRow][col])) maxRow = row;
            }
            double[] tmp = aug[col]; aug[col] = aug[maxRow]; aug[maxRow] = tmp;

            if (Math.abs(aug[col][col]) < 1e-12) continue;

            for (int row = col + 1; row < n; row++) {
                double factor = aug[row][col] / aug[col][col];
                for (int j = col; j <= n; j++) aug[row][j] -= factor * aug[col][j];
            }
        }

        double[] result = new double[n];
        for (int i = n - 1; i >= 0; i--) {
            if (Math.abs(aug[i][i]) < 1e-12) {
                result[i] = 0;
                continue;
            }
            result[i] = aug[i][n];
            for (int j = i + 1; j < n; j++) result[i] -= aug[i][j] * result[j];
            result[i] /= aug[i][i];
        }
        return result;
    }

    // ── Helpers ─────────────────────────────────────────────

    private static double round2(double v) {
        return BigDecimal.valueOf(v).setScale(2, RoundingMode.HALF_UP).doubleValue();
    }

    private static double round4(double v) {
        return BigDecimal.valueOf(v).setScale(4, RoundingMode.HALF_UP).doubleValue();
    }

    // ── Robust-stat helpers ─────────────────────────────────

    /** Plain median of a list; NaN for an empty list. Does not mutate the input. */
    static double median(List<Double> values) {
        if (values.isEmpty()) return Double.NaN;
        double[] a = values.stream().mapToDouble(Double::doubleValue).toArray();
        return median(a);
    }

    /** Plain median of an array; NaN for empty. Sorts a defensive copy. */
    static double median(double[] values) {
        if (values.length == 0) return Double.NaN;
        double[] a = values.clone();
        Arrays.sort(a);
        int n = a.length;
        return (n % 2 == 1) ? a[n / 2] : (a[n / 2 - 1] + a[n / 2]) / 2.0;
    }

    /**
     * Robust scale of residuals: {@code MAD_TO_STD * median(|r_i - median(r)|)}.
     * Std-equivalent under normal noise but resistant to a handful of outliers.
     */
    static double madScale(double[] residuals) {
        if (residuals.length == 0) return Double.NaN;
        double med = median(residuals);
        double[] absDev = new double[residuals.length];
        for (int i = 0; i < residuals.length; i++) absDev[i] = Math.abs(residuals[i] - med);
        return MAD_TO_STD * median(absDev);
    }

    /**
     * Weighted median of {@code [value, weight]} pairs: the value at which the
     * cumulative weight (over values sorted ascending) first reaches half of the
     * total weight. With uniform weights this reduces to the plain median.
     * Non-positive weights are ignored; NaN if no positive weight remains.
     */
    static double weightedMedian(List<double[]> valueWeight) {
        List<double[]> pts = new ArrayList<>();
        double total = 0;
        for (double[] vw : valueWeight) {
            if (vw[1] > 0) { pts.add(vw); total += vw[1]; }
        }
        if (pts.isEmpty()) return Double.NaN;
        pts.sort(Comparator.comparingDouble(a -> a[0]));
        double half = total / 2.0;
        double cum = 0;
        for (double[] p : pts) {
            cum += p[1];
            if (cum >= half) return p[0];
        }
        return pts.get(pts.size() - 1)[0]; // fallthrough (floating-point guard)
    }

    // ── Value types ─────────────────────────────────────────

    record DailyDataPoint(LocalDate date, double kwh, double avgTemp, double cdd, double hdd, DayOfWeek dow) {}

    public record WeatherForecastDay(LocalDate date, double highTemp, double lowTemp, double avgTemp) {}

    public record DailyForecast(
            String date, double predictedKwh, double predictedCost,
            double lowerBound, double upperBound,
            Double weatherHigh, Double weatherLow, Double weatherAvg,
            Double cdd, Double hdd, double confidencePct) {}

    public record HourlyForecast(int hour, double predictedKwh, double predictedCost) {}

    /** Shape of a daily anomaly explained by its hourly breakdown (doc §8). */
    public enum HourlyAnomalyClass {
        NORMAL, LOCALIZED_SPIKE, BASELINE_SHIFT, TIME_OF_DAY_SHIFT, OVERNIGHT_INCREASE
    }

    /**
     * Result of {@link #classifyHourlyAnomaly}. {@code dailyResidual} is the
     * authoritative actual−predicted daily total; {@code totalExcess} is the sum
     * of same-direction per-hour contributions; {@code concentrationHours} (k) is
     * how many hours it took to reach {@link #HOURLY_CONCENTRATION_FRAC} of that
     * excess; {@code overnightShare} is the overnight window's fraction of it;
     * {@code topHours} are the biggest contributors (largest-first, up to 5); and
     * {@code hourResiduals} is the full 24-length actual−expected vector for the
     * dashboard's per-hour drill-down. Diagnostic only.
     */
    public record HourlyAnomaly(
            HourlyAnomalyClass classification, double dailyResidual, double totalExcess,
            int concentrationHours, double overnightShare, int[] topHours,
            double[] hourResiduals) {}

    public record AccuracyReport(
            int dataPoints, double mae, double rmse, double mape,
            int trailingDays, List<AccuracyPoint> points) {}

    public record AccuracyPoint(String date, double predicted, double actual, double error) {}

    /** Robust anomaly classification bands for a graded observation. */
    public enum AnomalyClass { NORMAL, ANOMALOUS, SEVERE }

    /**
     * Result of robust anomaly scoring for one graded day. {@code z} is
     * {@code (actual - predicted) / robustScale}; classification bands are
     * {@link #ANOMALY_Z_THRESHOLD} / {@link #SEVERE_Z_THRESHOLD}.
     */
    public record AnomalyScore(
            double actual, double predicted, double residual, double absResidual,
            double robustScale, double z, AnomalyClass classification) {}

    /**
     * Persistent-anomaly / regime-change state (Phase 2). NORMAL and ANOMALOUS
     * mirror the doc's "one weird day" case; DRIFT_SUSPECTED and
     * REGIME_CHANGE_SUSPECTED mirror "this keeps happening" / "the model's
     * assumptions may no longer be valid". Diagnostic only — never drives
     * training or the retrain schedule.
     */
    public enum DriftState { NORMAL, ANOMALOUS, DRIFT_SUSPECTED, REGIME_CHANGE_SUSPECTED }

    /**
     * Result of a drift assessment as of {@code asOf}. {@code maeRatio} and
     * {@code medianSignedResidual}/{@code streakLength}/{@code streakSign} are
     * computed over the primary {@link #DRIFT_PRIMARY_WINDOW_DAYS}-day window;
     * {@code contextMaeRatios} carries the doc's other suggested windows
     * ({@link #DRIFT_CONTEXT_WINDOW_DAYS}) for a later dashboard — they do not
     * influence {@code state}. {@code streakSign} is +1/-1 for a same-direction
     * run, 0 if the newest residual is exactly zero or there's no data.
     */
    public record DriftAssessment(
            LocalDate asOf, int sampleCount, double historicalMae, double recentMae, double maeRatio,
            double medianSignedResidual, int streakLength, int streakSign,
            Map<Integer, Double> contextMaeRatios, DriftState state) {}
}
