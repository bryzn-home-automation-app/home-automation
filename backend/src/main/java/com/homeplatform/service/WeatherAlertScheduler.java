package com.homeplatform.service;

import com.homeplatform.repository.WeatherAlertLogRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Profile;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.time.LocalDateTime;

/** Runs the weather alert checks ({@link WeatherAlertService}). Off in tests, which would otherwise call the weather APIs. */
@Component
@Profile("!test")
public class WeatherAlertScheduler {

    private static final Logger log = LoggerFactory.getLogger(WeatherAlertScheduler.class);
    /** Check records only need to outlive the check; kept a while for the Debug page. */
    static final Duration KEEP = Duration.ofDays(90);

    private final WeatherAlertService alerts;
    private final WeatherAlertLogRepository checks;

    public WeatherAlertScheduler(WeatherAlertService alerts, WeatherAlertLogRepository checks) {
        this.alerts = alerts;
        this.checks = checks;
    }

    /** Daily forecast checks: every five minutes, whichever members' check times have come. */
    @Scheduled(cron = "0 */5 * * * *", zone = "America/Chicago")
    public void forecastChecks() {
        try {
            alerts.runScheduled(LocalDateTime.now(WeatherAlertService.CHICAGO));
        } catch (Exception e) {
            log.warn("Weather alert checks failed: {}", e.getMessage());
        }
    }

    /** Official warnings: every two minutes, so a tornado warning arrives while it still matters. */
    @Scheduled(initialDelay = 60_000, fixedDelay = 120_000)
    public void warnings() {
        try {
            alerts.runWarnings();
        } catch (Exception e) {
            log.warn("Weather warnings check failed: {}", e.getMessage());
        }
    }

    @Scheduled(cron = "0 50 3 * * *", zone = "America/Chicago")
    public void prune() {
        try {
            int removed = checks.deleteByCreatedAtBefore(LocalDateTime.now().minus(KEEP));
            if (removed > 0) log.info("Weather alert log: removed {} checks older than {} days", removed, KEEP.toDays());
        } catch (Exception e) {
            log.warn("Weather alert log retention failed: {}", e.getMessage());
        }
    }
}
