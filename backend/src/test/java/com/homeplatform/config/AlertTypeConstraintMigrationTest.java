package com.homeplatform.config;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

import static org.mockito.Mockito.*;

/** The stale alert_type lists come off every table that stores an alert type, and one failure doesn't stop the rest. */
class AlertTypeConstraintMigrationTest {

    @Test
    @DisplayName("drops each table's alert_type check, carrying on past a failure")
    void dropsEach() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        doThrow(new RuntimeException("locked")).when(jdbc).execute(contains("notification_preferences"));

        new AlertTypeConstraintMigration(jdbc).run(null);

        verify(jdbc).execute("ALTER TABLE IF EXISTS notification_preferences DROP CONSTRAINT IF EXISTS notification_preferences_alert_type_check");
        verify(jdbc).execute("ALTER TABLE IF EXISTS weather_alert_settings DROP CONSTRAINT IF EXISTS weather_alert_settings_alert_type_check");
        verify(jdbc).execute("ALTER TABLE IF EXISTS weather_alert_log DROP CONSTRAINT IF EXISTS weather_alert_log_alert_type_check");
        // Notification.Category gained REMINDER.
        verify(jdbc).execute("ALTER TABLE IF EXISTS notifications DROP CONSTRAINT IF EXISTS notifications_category_check");
    }
}
