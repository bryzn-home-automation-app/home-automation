package com.homeplatform.controller;

import com.homeplatform.dto.WeatherResponse;
import com.homeplatform.model.ForecastModel;
import com.homeplatform.model.ForecastSnapshot;
import com.homeplatform.service.ForecastService;
import com.homeplatform.service.ForecastService.*;
import com.homeplatform.service.WeatherService;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/forecast")
public class ForecastController {

    @Value("${app.property-latitude:0}")
    private double lat;

    @Value("${app.property-longitude:0}")
    private double lon;

    private final ForecastService forecastService;
    private final WeatherService weatherService;

    public ForecastController(ForecastService forecastService, WeatherService weatherService) {
        this.forecastService = forecastService;
        this.weatherService = weatherService;
    }

    // Request-size caps: an unbounded `days` allocates one forecast object per
    // requested day (heap exhaustion), and an unbounded history window can push
    // the query start outside Postgres's date range (HTTP 500).
    private static final int MAX_FORECAST_DAYS = 90;
    private static final int MAX_HISTORY_DAYS = 90;

    @GetMapping("/electric")
    public ResponseEntity<?> getElectricForecast(@RequestParam(defaultValue = "7") int days) {
        days = Math.max(1, Math.min(days, MAX_FORECAST_DAYS));
        var modelOpt = forecastService.getActiveModel();
        if (modelOpt.isEmpty()) {
            return ResponseEntity.ok(Map.of(
                    "status", "no_model",
                    "message", "Not enough data to build a forecast model yet. Need at least 7 days of usage + weather data."));
        }

        ForecastModel model = modelOpt.get();

        // Fetch forecast weather from Open-Meteo. Range starts at yesterday (not
        // today) so a day that has just rolled from "today" into "yesterday" at
        // midnight still gets a regenerated projection/band — otherwise it falls
        // out of this range immediately and shows neither an actual (not backfilled
        // yet) nor a band, an empty gap on the chart until the daily sync catches up.
        LocalDate today = LocalDate.now();
        LocalDate rangeStart = today.minusDays(1);
        LocalDate end = today.plusDays(days);
        WeatherResponse wx = weatherService.getWeatherForDateRange(lat, lon, rangeStart, end);

        List<WeatherForecastDay> forecastDays = new ArrayList<>();
        if (wx.daily() != null) {
            for (var d : wx.daily()) {
                LocalDate date = LocalDate.parse(d.date());
                if (!date.isBefore(rangeStart) && !date.isAfter(end)) {
                    double avg = (d.maxTemperature() + d.minTemperature()) / 2;
                    forecastDays.add(new WeatherForecastDay(date, d.maxTemperature(), d.minTemperature(), avg));
                }
            }
        }

        if (forecastDays.isEmpty()) {
            return ResponseEntity.ok(Map.of(
                    "status", "no_weather",
                    "message", "Weather forecast unavailable. Cannot generate predictions without forecast temperatures."));
        }

        // Pad beyond the point-forecast horizon (Open-Meteo caps out ~16 days)
        // with recent climatology so a 30-day outlook stays defined end to end.
        // The lead-aware band widening keeps those far days honestly uncertain.
        LocalDate lastCovered = forecastDays.get(forecastDays.size() - 1).date();
        if (lastCovered.isBefore(end)) {
            double[] typical = forecastService.typicalRecentWeather(14);
            if (typical != null) {
                for (LocalDate d = lastCovered.plusDays(1); !d.isAfter(end); d = d.plusDays(1)) {
                    forecastDays.add(new WeatherForecastDay(d, typical[0], typical[1], typical[2]));
                }
            }
        }

        List<DailyForecast> forecasts = forecastService.generateForecasts(model, forecastDays);

        // Also fetch recent actuals for the chart overlay
        LocalDate histStart = today.minusDays(14);
        var snapshots = forecastService.getForecastRange(histStart, end);

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("status", "ok");
        result.put("modelId", model.getId());
        result.put("dataPointsUsed", model.getDataPointsUsed());
        result.put("rSquared", model.getRSquared());
        result.put("dowAdjustments", model.getDowAdjustments());
        result.put("forecasts", forecasts);
        result.put("snapshots", toSnapshotDtos(snapshots));

        return ResponseEntity.ok(result);
    }

    /**
     * Stored predictions (freshest per target day) for the trailing
     * {@code days} up through today. Deliberately independent of the live
     * forecast: it needs no model and no weather call, so a weather outage
     * or failed forecast request never erases the prediction history.
     */
    @GetMapping("/electric/snapshots")
    public ResponseEntity<?> getElectricSnapshots(@RequestParam(defaultValue = "30") int days) {
        int window = Math.max(1, Math.min(days, MAX_HISTORY_DAYS));
        LocalDate today = LocalDate.now();
        var snapshots = forecastService.getForecastRange(today.minusDays(window), today);

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("status", "ok");
        result.put("snapshots", toSnapshotDtos(snapshots));
        return ResponseEntity.ok(result);
    }

    private static List<Map<String, Object>> toSnapshotDtos(List<ForecastSnapshot> snapshots) {
        return snapshots.stream().map(s -> {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("targetDate", s.getTargetDate().toString());
            m.put("predictedKwh", s.getPredictedKwh());
            m.put("actualKwh", s.getActualKwh());
            m.put("predictedCost", s.getPredictedCost());
            m.put("actualCost", s.getActualCost());
            return m;
        }).toList();
    }

    @GetMapping("/electric/hourly")
    public ResponseEntity<?> getHourlyForecast(
            @RequestParam(required = false) String date) {
        var modelOpt = forecastService.getActiveModel();
        if (modelOpt.isEmpty()) {
            return ResponseEntity.ok(Map.of("status", "no_model"));
        }

        LocalDate target = date != null ? LocalDate.parse(date) : LocalDate.now();
        WeatherResponse wx = weatherService.getWeatherForDateRange(lat, lon, target, target);

        double avgTemp = 80; // fallback
        if (wx.daily() != null && !wx.daily().isEmpty()) {
            var d = wx.daily().get(0);
            avgTemp = (d.maxTemperature() + d.minTemperature()) / 2;
        }

        List<HourlyForecast> hours = forecastService.generateHourlyForecast(modelOpt.get(), target, avgTemp);

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("status", "ok");
        result.put("date", target.toString());
        result.put("avgTemp", avgTemp);
        result.put("hours", hours);
        return ResponseEntity.ok(result);
    }

    @GetMapping("/accuracy")
    public ResponseEntity<?> getAccuracy(@RequestParam(defaultValue = "30") int days) {
        AccuracyReport report = forecastService.getAccuracy(days);
        return ResponseEntity.ok(report);
    }

    @GetMapping("/accuracy/hourly")
    public ResponseEntity<?> getHourlyAccuracy(@RequestParam(defaultValue = "7") int days) {
        HourlyAccuracyReport report = forecastService.getHourlyAccuracy(days);
        return ResponseEntity.ok(report);
    }

    @GetMapping("/model")
    public ResponseEntity<?> getModel() {
        var modelOpt = forecastService.getActiveModel();
        if (modelOpt.isEmpty()) {
            return ResponseEntity.ok(Map.of("status", "no_model"));
        }
        ForecastModel m = modelOpt.get();
        Map<String, Object> result = new LinkedHashMap<>();
        result.put("status", "ok");
        result.put("id", m.getId());
        result.put("createdAt", m.getCreatedAt().toString());
        result.put("dataPointsUsed", m.getDataPointsUsed());
        result.put("rSquared", m.getRSquared());
        result.put("mae", m.getMae());
        result.put("mape", m.getMape());
        result.put("intercept", m.getIntercept());
        result.put("cddCoeff", m.getCddCoeff());
        result.put("hddCoeff", m.getHddCoeff());
        result.put("trainingStart", m.getTrainingStart());
        result.put("trainingEnd", m.getTrainingEnd());
        result.put("dowAdjustments", m.getDowAdjustments());
        result.put("seasonalFactors", m.getSeasonalFactors());
        result.put("hourlyProfileKeys", m.getHourlyProfiles().keySet());
        return ResponseEntity.ok(result);
    }
}
