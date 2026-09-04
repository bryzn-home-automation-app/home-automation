package com.homeplatform.service;

import com.homeplatform.dto.WeatherResponse;
import com.homeplatform.model.ForecastModel;
import com.homeplatform.service.ForecastService.DailyForecast;
import com.homeplatform.service.ForecastService.WeatherForecastDay;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;

@Service
public class ForecastScheduler {

    private static final Logger log = LoggerFactory.getLogger(ForecastScheduler.class);

    @Value("${app.property-latitude:0}")
    private double lat;

    @Value("${app.property-longitude:0}")
    private double lon;

    private final ForecastService forecastService;
    private final WeatherService weatherService;
    private final AppEventService appEventService;

    public ForecastScheduler(ForecastService forecastService,
                             WeatherService weatherService,
                             AppEventService appEventService) {
        this.forecastService = forecastService;
        this.weatherService = weatherService;
        this.appEventService = appEventService;
    }

    @Scheduled(cron = "0 30 0 * * *", zone = "America/Chicago")
    public void nightlyRetrain() {
        log.info("ForecastScheduler: starting nightly retrain cycle");

        try {
            // 1. Backfill yesterday's actuals into any pending snapshots
            int filled = forecastService.backfillActuals();
            log.info("ForecastScheduler: backfilled {} actuals", filled);

            // 2. Retrain the model
            ForecastModel model = forecastService.trainModel();
            if (model == null) {
                log.warn("ForecastScheduler: not enough data to train — skipping forecast generation");
                appEventService.info("forecast", "ForecastScheduler",
                        "Nightly retrain skipped — not enough data points yet");
                return;
            }

            // 3. Generate 7-day forecast using weather predictions
            LocalDate today = LocalDate.now();
            LocalDate forecastEnd = today.plusDays(7);
            WeatherResponse wx = weatherService.getWeatherForDateRange(lat, lon, today, forecastEnd);

            List<WeatherForecastDay> forecastDays = new ArrayList<>();
            if (wx.daily() != null) {
                for (var d : wx.daily()) {
                    LocalDate date = LocalDate.parse(d.date());
                    if (!date.isBefore(today) && !date.isAfter(forecastEnd)) {
                        double avg = (d.maxTemperature() + d.minTemperature()) / 2;
                        forecastDays.add(new WeatherForecastDay(date, d.maxTemperature(), d.minTemperature(), avg));
                    }
                }
            }

            if (forecastDays.isEmpty()) {
                log.warn("ForecastScheduler: no forecast weather available");
                appEventService.warn("forecast", "ForecastScheduler",
                        "Nightly retrain completed model #" + model.getId()
                                + " but weather forecast unavailable — no predictions saved");
                return;
            }

            List<DailyForecast> forecasts = forecastService.generateForecasts(model, forecastDays);
            forecastService.saveForecasts(model, forecasts);

            log.info("ForecastScheduler: saved {} forecast snapshots, backfilled {} actuals", forecasts.size(), filled);
            appEventService.info("forecast", "ForecastScheduler",
                    String.format("Nightly cycle complete — model #%d (R²=%.4f, %d pts), %d forecasts saved, %d actuals backfilled",
                            model.getId(),
                            model.getRSquared() != null ? model.getRSquared().doubleValue() : 0,
                            model.getDataPointsUsed(),
                            forecasts.size(), filled));

        } catch (Exception e) {
            log.error("ForecastScheduler: nightly retrain failed", e);
            appEventService.error("forecast", "ForecastScheduler",
                    "Nightly retrain failed", e.getMessage());
        }
    }

    public void runManualRetrain() {
        nightlyRetrain();
    }
}
