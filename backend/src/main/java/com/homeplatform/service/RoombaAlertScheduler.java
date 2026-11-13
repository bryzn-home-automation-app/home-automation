package com.homeplatform.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Profile;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Checks the Roomba's dock and its scheduled cleans every five minutes, so "the dock's
 * clean-water tank is empty" or "the 9:00 AM clean didn't start" arrives while it can still
 * be fixed. The other Roomba alerts ride on the hourly sync and on logins, which can be hours
 * apart once the day's electricity data is in. Daytime only: a complaint that starts
 * overnight is sent at 7:00. Off in tests.
 */
@Component
@Profile("!test")
public class RoombaAlertScheduler {

    private static final Logger log = LoggerFactory.getLogger(RoombaAlertScheduler.class);

    private final AlertEngine alertEngine;

    public RoombaAlertScheduler(AlertEngine alertEngine) {
        this.alertEngine = alertEngine;
    }

    @Scheduled(cron = "0 */5 7-21 * * *", zone = "America/Chicago")
    public void check() {
        try {
            alertEngine.generateRoombaWatchAlerts();
        } catch (Exception e) {
            log.warn("Roomba dock/schedule alert check failed: {}", e.getMessage());
        }
    }
}
