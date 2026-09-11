package com.homeplatform.service;

import com.homeplatform.dto.WeatherResponse;
import com.homeplatform.event.UsageIngestedEvent;
import com.homeplatform.model.ForecastModel;
import com.homeplatform.service.ForecastService.DailyForecast;
import com.homeplatform.service.ForecastService.WeatherForecastDay;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.event.EventListener;
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

    // 23:45 CT -- 15 min after DailySyncScheduler's last sync attempt of the day
    // (7:00 AM-11:30 PM CT, on the half hour). This used to run at 00:30 AM, which
    // is BEFORE that day's own sync window even opens: at 00:30 on day D, the most
    // recent day DailySyncScheduler could have finished syncing is D-2 (D-1's sync
    // doesn't happen until 7 AM-11:30 PM *on* day D itself), so backfillActuals()
    // could only ever fill through D-2 -- a 2-day-old "actual" cutoff even though
    // D-1's usage typically lands in Postgres by ~10 AM on day D. Running at 23:45
    // on day D instead means D-1's data (synced earlier that same day) is already
    // there, cutting the visible lag to the unavoidable minimum of 1 day (today
    // isn't over, so it can never show as "actual" yet).
    @Scheduled(cron = "0 45 23 * * *", zone = "America/Chicago")
    public void nightlyRetrain() {
        runRetrainCycle("Nightly", forecastService.backfillActuals());
    }

    public void runManualRetrain() {
        runRetrainCycle("Manual", forecastService.backfillActuals());
    }

    /**
     * Reacts to any ingestion path completing a sync attempt (daily or hourly,
     * scheduled or manually triggered — see {@link UsageIngestedEvent}), so the
     * actual line and projection update within that sync cycle instead of waiting
     * for the 23:45 nightly cron. Every received event is logged (visible on the
     * Debug Dashboard's Forecast Events panel) even when it's a no-op — e.g. a
     * tick where CoServ hasn't posted yet — so "did the forecast system hear
     * about the new reading" is never a silent question.
     */
    @EventListener
    public void onUsageIngested(UsageIngestedEvent event) {
        int filled = forecastService.backfillActuals();
        if (filled == 0) {
            appEventService.info("forecast", "ForecastScheduler",
                    "Received ingestion event from " + event.source() + " — no new actuals to backfill");
            return;
        }
        log.info("ForecastScheduler: {} new actual reading(s) landed (source={}) — retraining immediately",
                filled, event.source());
        appEventService.info("forecast", "ForecastScheduler",
                "Received ingestion event from " + event.source() + " — backfilled " + filled
                        + " actual(s), retraining");
        runRetrainCycle("Immediate", filled);
    }

    private void runRetrainCycle(String trigger, int filled) {
        log.info("ForecastScheduler: starting {} retrain cycle", trigger.toLowerCase());

        try {
            log.info("ForecastScheduler: backfilled {} actuals", filled);

            // Retrain the model
            ForecastModel model = forecastService.trainModel();
            if (model == null) {
                log.warn("ForecastScheduler: not enough data to train — skipping forecast generation");
                appEventService.info("forecast", "ForecastScheduler",
                        trigger + " retrain skipped — not enough data points yet");
                return;
            }

            // Generate 7-day forecast using weather predictions
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
                        trigger + " retrain completed model #" + model.getId()
                                + " but weather forecast unavailable — no predictions saved");
                return;
            }

            List<DailyForecast> forecasts = forecastService.generateForecasts(model, forecastDays);
            forecastService.saveForecasts(model, forecasts);

            log.info("ForecastScheduler: saved {} forecast snapshots, backfilled {} actuals", forecasts.size(), filled);
            appEventService.info("forecast", "ForecastScheduler",
                    String.format("%s cycle complete — model #%d (R²=%.4f, %d pts), %d forecasts saved, %d actuals backfilled",
                            trigger,
                            model.getId(),
                            model.getRSquared() != null ? model.getRSquared().doubleValue() : 0,
                            model.getDataPointsUsed(),
                            forecasts.size(), filled));

        } catch (Exception e) {
            log.error("ForecastScheduler: {} retrain failed", trigger.toLowerCase(), e);
            appEventService.error("forecast", "ForecastScheduler",
                    trigger + " retrain failed", e.getMessage());
        }
    }
}
