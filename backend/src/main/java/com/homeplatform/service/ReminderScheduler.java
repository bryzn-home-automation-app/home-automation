package com.homeplatform.service;

import com.homeplatform.repository.ReminderAlertSentRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Profile;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.Instant;

/**
 * Sends reminder heads-ups ({@link ReminderService}) every minute. Each (occurrence,
 * heads-up) is recorded in reminder_alerts_sent in the same transaction as its alerts, so it
 * goes out once even across restarts. After downtime, a heads-up that was missed is still sent
 * while its occurrence isn't over or done (only the latest one, if several were missed); one
 * whose occurrence is over is never sent. Off in tests.
 */
@Component
@Profile("!test")
public class ReminderScheduler {

    private static final Logger log = LoggerFactory.getLogger(ReminderScheduler.class);
    /** Records only guard sends for occurrences that aren't over; kept a while for the Debug page. */
    static final int KEEP_DAYS = 60;

    private final ReminderService reminders;
    private final ReminderAlertSentRepository sent;
    private final Clock clock;

    @Autowired
    public ReminderScheduler(ReminderService reminders, ReminderAlertSentRepository sent) {
        this(reminders, sent, Clock.system(ReminderSchedule.HOME));
    }

    ReminderScheduler(ReminderService reminders, ReminderAlertSentRepository sent, Clock clock) {
        this.reminders = reminders;
        this.sent = sent;
        this.clock = clock;
    }

    /** Every minute, a few seconds in, so a 2:00 PM heads-up goes out at 2:00. */
    @Scheduled(cron = "5 * * * * *", zone = "America/Chicago")
    public void tick() {
        try {
            runAlerts(clock.instant());
        } catch (Exception e) {
            log.warn("Reminder heads-ups failed: {}", e.getMessage());
        }
    }

    /** Sends whatever is due at {@code now}; returns how many heads-ups went out. One failure doesn't stop the rest. */
    int runAlerts(Instant now) {
        int n = 0;
        for (ReminderService.PendingAlert p : reminders.pendingAlerts(now)) {
            try {
                if (reminders.send(p, now)) n++;
            } catch (DataIntegrityViolationException e) {
                log.debug("Reminder heads-up {} {} {} was already handled", p.reminderId(), p.date(), p.sendKey());
            } catch (RuntimeException e) {
                // Rolled back, so the next minute tries again.
                log.warn("Reminder heads-up {} for {} failed: {}", p.reminderId(), p.date(), e.getMessage());
            }
        }
        return n;
    }

    @Scheduled(cron = "0 55 3 * * *", zone = "America/Chicago")
    public void prune() {
        try {
            int removed = sent.deleteByOccurrenceDateBefore(ReminderSchedule.homeDate(clock.instant()).minusDays(KEEP_DAYS));
            if (removed > 0) log.info("Reminder alert records: removed {} older than {} days", removed, KEEP_DAYS);
        } catch (Exception e) {
            log.warn("Reminder alert record retention failed: {}", e.getMessage());
        }
    }
}
