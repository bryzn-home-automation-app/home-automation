package com.homeplatform.homeassistant;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.sql.Timestamp;
import java.time.Clock;
import java.time.Duration;
import java.time.LocalDateTime;

/**
 * Keeps the device-reading tables from growing without bound. Thermostats report every
 * few minutes (~850 rows a day for two) and cameras every ~20 (~210 a day), but no chart
 * shows that detail past a month: thermostat history goes back 7 days, camera battery
 * 30. Readings older than {@link #KEEP_FULL} are thinned to one per device per hour.
 *
 * The kept row is the last real reading of each hour, not an average, so a setpoint,
 * mode or charging flag is always one the device actually reported.
 */
@Component
public class ReadingRetention {

    static final Duration KEEP_FULL = Duration.ofDays(31);
    static final String[] TABLES = {"thermostat_readings", "camera_battery_readings"};

    private static final Logger log = LoggerFactory.getLogger(ReadingRetention.class);

    private final JdbcTemplate jdbc;
    private final Clock clock;

    @Autowired
    public ReadingRetention(JdbcTemplate jdbc) {
        this(jdbc, Clock.systemUTC());
    }

    ReadingRetention(JdbcTemplate jdbc, Clock clock) {
        this.jdbc = jdbc;
        this.clock = clock;
    }

    /** Nightly at 3:45 AM CT, after app_events retention. Cron-gated, so short test runs never fire it. */
    @Scheduled(cron = "0 45 3 * * *", zone = "America/Chicago")
    public void scheduledThin() {
        for (String table : TABLES) {
            try {
                int removed = thin(table);
                if (removed > 0) log.info("{} retention: thinned {} readings older than {} days to hourly", table, removed, KEEP_FULL.toDays());
            } catch (Exception e) {
                log.warn("{} retention failed: {}", table, e.getMessage());
            }
        }
    }

    /**
     * Delete every reading older than the cutoff that has a later reading for the same
     * device in the same hour. What's left is each hour's last reading. Table names come
     * from {@link #TABLES} only.
     */
    int thin(String table) {
        if (!java.util.List.of(TABLES).contains(table)) throw new IllegalArgumentException(table);
        Timestamp cutoff = Timestamp.valueOf(LocalDateTime.now(clock).minus(KEEP_FULL));
        return jdbc.update("""
                DELETE FROM %1$s r
                WHERE r.recorded_at < ?
                  AND EXISTS (
                    SELECT 1 FROM %1$s n
                    WHERE n.device_id = r.device_id
                      AND n.recorded_at < ?
                      AND DATE_TRUNC('hour', n.recorded_at) = DATE_TRUNC('hour', r.recorded_at)
                      AND (n.recorded_at > r.recorded_at OR (n.recorded_at = r.recorded_at AND n.id > r.id)))
                """.formatted(table), cutoff, cutoff);
    }
}
