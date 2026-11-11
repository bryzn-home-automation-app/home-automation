package com.homeplatform.config;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.context.annotation.Profile;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

import java.util.List;

/**
 * Drops the CHECK constraints Hibernate wrote on {@code alert_type} columns. When it creates a
 * table it lists the enum's values at that moment ({@code alert_type IN ('PERSON_DETECTED', ...)}),
 * and {@code ddl-auto: update} never revises the list, so every alert type added later was
 * refused: turning on a weather alert, or the indoor-camera alerts, failed with a constraint
 * violation. The column is only ever written from {@code AlertType}, so the list guards nothing.
 * The same goes for {@code notifications.category} ({@code Notification.Category}), which gained
 * REMINDER after the table was made: if Hibernate (not schema.sql) created that table, its check
 * would refuse every reminder alert.
 * Runs on every start; dropping a constraint that's already gone is a no-op.
 */
@Component
@Profile("!test")
public class AlertTypeConstraintMigration implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(AlertTypeConstraintMigration.class);

    static final List<String> TABLES = List.of("notification_preferences", "weather_alert_settings", "weather_alert_log");
    /** Other enum columns written only from code: table and column. */
    static final List<String[]> OTHER = List.<String[]>of(new String[] {"notifications", "category"});

    private final JdbcTemplate jdbc;

    public AlertTypeConstraintMigration(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public void run(ApplicationArguments args) {
        for (String table : TABLES) drop(table, "alert_type");
        for (String[] t : OTHER) drop(t[0], t[1]);
    }

    private void drop(String table, String column) {
        try {
            jdbc.execute("ALTER TABLE IF EXISTS " + table + " DROP CONSTRAINT IF EXISTS " + table + "_" + column + "_check");
        } catch (Exception e) {
            log.warn("Couldn't drop the {} check on {}: {}", column, table, e.getMessage());
        }
    }
}
