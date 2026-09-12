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
            double[] hourTotals = new double[24];
            int[] hourCounts = new int[24];
            for (double[] pair : entry.getValue()) {
                int hr = (int) pair[0];
                hourTotals[hr] += pair[1];
                hourCounts[hr]++;
            }
            List<Double> shape = new ArrayList<>();
            double total = 0;
            for (int h = 0; h < 24; h++) {
                double avg = hourCounts[h] > 0 ? hourTotals[h] / hourCounts[h] : 0;
                shape.add(avg);
                total += avg;
            }
            // Normalize to fractions
            if (total > 0) {
                for (int h = 0; h < 24; h++) shape.set(h, shape.get(h) / total);
            }
            profiles.put(entry.getKey(), shape);
        }
        return profiles;
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
}
