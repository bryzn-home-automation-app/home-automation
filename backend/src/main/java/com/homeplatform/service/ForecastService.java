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
import java.util.*;
import java.util.stream.Collectors;

@Service
public class ForecastService {

    private static final Logger log = LoggerFactory.getLogger(ForecastService.class);
    private static final double COMFORT_BASE = 65.0;
    private static final int MIN_DATA_POINTS = 7;

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

        // Phase 1: CDD/HDD multiple regression via OLS
        double[] kwhArr = new double[data.size()];
        double[][] xArr = new double[data.size()][2];
        for (int i = 0; i < data.size(); i++) {
            kwhArr[i] = data.get(i).kwh;
            xArr[i][0] = data.get(i).cdd;
            xArr[i][1] = data.get(i).hdd;
        }

        double[] coeffs = olsRegression(kwhArr, xArr);
        double intercept = coeffs[0], cddCoeff = coeffs[1], hddCoeff = coeffs[2];

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
        Map<String, Double> dowAdj = new HashMap<>();
        for (var e : dowRatios.entrySet()) {
            double avg = e.getValue().stream().mapToDouble(d -> d).average().orElse(1.0);
            dowAdj.put(e.getKey().name(), round4(avg));
        }

        // Phase 2: Hourly load shape profiles
        Map<String, Object> hourlyProfiles = buildHourlyProfiles(data);

        // Phase 3: Seasonal factors
        Map<String, Double> seasonalFactors = buildSeasonalFactors(data, intercept, cddCoeff, hddCoeff);

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
        List<DailyForecast> results = new ArrayList<>();
        for (WeatherForecastDay wx : forecastWeather) {
            double kwh = predict(model, wx.avgTemp, wx.date.getDayOfWeek(), wx.date.getMonthValue());
            double cost = kwh * kwhRate;
            double cdd = Math.max(0, wx.avgTemp - COMFORT_BASE);
            double hdd = Math.max(0, COMFORT_BASE - wx.avgTemp);

            // Confidence interval widens with less data
            double confidencePct = computeConfidence(model, wx.date);
            double margin = kwh * (1.0 - confidencePct);

            results.add(new DailyForecast(
                    wx.date.toString(), round2(kwh), round2(cost),
                    round2(kwh - margin), round2(kwh + margin),
                    round2(wx.highTemp), round2(wx.lowTemp), round2(wx.avgTemp),
                    round2(cdd), round2(hdd), round2(confidencePct * 100)));
        }
        return results;
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
            snapshotRepo.save(snap);
        }
    }

    public int backfillActuals() {
        List<ForecastSnapshot> pending = snapshotRepo.findByActualKwhIsNullAndTargetDateBefore(LocalDate.now());
        int filled = 0;
        for (ForecastSnapshot snap : pending) {
            Double actual = queryDailyKwh(snap.getTargetDate().toString());
            if (actual != null && actual > 0) {
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
                                                      double intercept, double cddCoeff, double hddCoeff) {
        Map<Integer, List<Double>> monthRatios = new HashMap<>();
        for (DailyDataPoint dp : data) {
            double predicted = intercept + cddCoeff * dp.cdd + hddCoeff * dp.hdd;
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

    private double computeConfidence(ForecastModel model, LocalDate targetDate) {
        int dataPoints = model.getDataPointsUsed();
        int month = targetDate.getMonthValue();
        boolean hasSeasonal = model.getSeasonalFactors().containsKey(String.valueOf(month));

        // Base confidence from data volume: 50% at 7 days, 80% at 60 days, 92% at 180 days, caps at 95%
        double base = Math.min(0.95, 0.40 + 0.55 * (1 - Math.exp(-dataPoints / 80.0)));

        // Penalty if this month hasn't been seen in training data
        if (!hasSeasonal) base *= 0.75;

        // Bonus from model fit
        double r2 = model.getRSquared() != null ? model.getRSquared().doubleValue() : 0;
        base *= (0.7 + 0.3 * r2);

        return Math.max(0.20, Math.min(0.95, base));
    }

    // ── Training data loader ────────────────────────────────

    private List<DailyDataPoint> loadTrainingData() {
        try {
            return jdbc.query("""
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
                """, (rs, rowNum) -> {
                LocalDate date = rs.getDate("day").toLocalDate();
                double kwh = rs.getDouble("total_kwh");
                double avgTemp = rs.getDouble("avg_temp_f");
                double cdd = Math.max(0, avgTemp - COMFORT_BASE);
                double hdd = Math.max(0, COMFORT_BASE - avgTemp);
                return new DailyDataPoint(date, kwh, avgTemp, cdd, hdd, date.getDayOfWeek());
            });
        } catch (Exception e) {
            log.error("ForecastService: failed to load training data", e);
            return List.of();
        }
    }

    private Double queryDailyKwh(String date) {
        try {
            return jdbc.queryForObject("""
                SELECT COALESCE(SUM(usage_kwh), 0)
                FROM hourly_electric_usage
                WHERE timestamp::date = ?::date AND usage_kwh > 0
                HAVING COUNT(*) >= 18
                """, Double.class, date);
        } catch (Exception e) {
            return null;
        }
    }

    // ── OLS multiple regression ─────────────────────────────

    private static double[] olsRegression(double[] y, double[][] x) {
        int n = y.length;
        int p = x[0].length;
        // X with intercept column prepended
        double[][] xm = new double[n][p + 1];
        for (int i = 0; i < n; i++) {
            xm[i][0] = 1.0;
            System.arraycopy(x[i], 0, xm[i], 1, p);
        }

        // X'X
        double[][] xtx = new double[p + 1][p + 1];
        for (int i = 0; i < p + 1; i++) {
            for (int j = 0; j < p + 1; j++) {
                double sum = 0;
                for (int k = 0; k < n; k++) sum += xm[k][i] * xm[k][j];
                xtx[i][j] = sum;
            }
        }

        // X'y
        double[] xty = new double[p + 1];
        for (int i = 0; i < p + 1; i++) {
            double sum = 0;
            for (int k = 0; k < n; k++) sum += xm[k][i] * y[k];
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
            result[i] = aug[i][n];
            for (int j = i + 1; j < n; j++) result[i] -= aug[i][j] * result[j];
            if (Math.abs(aug[i][i]) > 1e-12) result[i] /= aug[i][i];
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
}
