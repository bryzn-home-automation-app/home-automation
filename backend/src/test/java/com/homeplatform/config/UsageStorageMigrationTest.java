package com.homeplatform.config;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.mockito.ArgumentMatchers.contains;
import static org.mockito.Mockito.*;

/** The roomba_commands NOTIFY trigger that wakes the poller (Postgres-only, so the SQL is checked here). */
class UsageStorageMigrationTest {

    @Test
    @DisplayName("creates the notify function, then the insert trigger, on the poller's channel")
    void createsTrigger() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);

        new UsageStorageMigration(jdbc).createCommandNotifyTrigger();

        var order = inOrder(jdbc);
        order.verify(jdbc).execute(contains("CREATE OR REPLACE FUNCTION roomba_commands_notify()"));
        order.verify(jdbc).execute(contains("CREATE OR REPLACE TRIGGER trg_roomba_commands_notify"));
        assertThat(UsageStorageMigration.COMMAND_NOTIFY_FUNCTION)
                .contains("pg_notify('roomba_commands', NEW.id::text)")
                .contains("$$ LANGUAGE plpgsql");
        assertThat(UsageStorageMigration.COMMAND_NOTIFY_TRIGGER)
                .contains("AFTER INSERT ON roomba_commands")
                .contains("FOR EACH ROW EXECUTE FUNCTION roomba_commands_notify()");
    }

    @Test
    @DisplayName("the migration's skips table matches schema.sql column for column, states as VARCHAR")
    void skipsTableMatchesSchema() throws Exception {
        String schema = new String(getClass().getResourceAsStream("/schema.sql").readAllBytes(), java.nio.charset.StandardCharsets.UTF_8);
        String source = java.nio.file.Files.readString(java.nio.file.Path.of(
                "src/main/java/com/homeplatform/config/UsageStorageMigration.java"));
        assertThat(columns(source)).isEqualTo(columns(schema)).contains("state VARCHAR(20) NOT NULL DEFAULT 'PENDING'");
    }

    /** The column lines of the roomba_schedule_skips CREATE TABLE in {@code text}, whitespace squeezed. */
    private static java.util.List<String> columns(String raw) {
        String text = raw.replace("\r", "");
        int start = text.indexOf("CREATE TABLE IF NOT EXISTS roomba_schedule_skips (");
        assertThat(start).isNotNegative();
        String body = text.substring(text.indexOf('(', start) + 1, text.indexOf(")\n", start) + 1);
        return java.util.Arrays.stream(body.split(",\\s*\\n"))
                .map(line -> line.trim().replaceAll("\\s+", " ").replaceAll(",$", ""))
                .filter(line -> !line.isEmpty())
                .toList();
    }

    @Test
    @DisplayName("a failure is logged, not thrown: the backend still starts and the poller keeps its tick")
    void failureDoesNotStopStartup() {
        JdbcTemplate jdbc = mock(JdbcTemplate.class);
        doThrow(new RuntimeException("permission denied")).when(jdbc).execute(contains("CREATE OR REPLACE FUNCTION"));

        assertThatCode(() -> new UsageStorageMigration(jdbc).createCommandNotifyTrigger()).doesNotThrowAnyException();
        verify(jdbc, never()).execute(contains("CREATE OR REPLACE TRIGGER"));
    }
}
