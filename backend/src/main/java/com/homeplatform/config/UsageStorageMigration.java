package com.homeplatform.config;

import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

@Component
@org.springframework.context.annotation.Profile("!test")
public class UsageStorageMigration implements ApplicationRunner {

    private final JdbcTemplate jdbcTemplate;

    public UsageStorageMigration(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    @Override
    public void run(ApplicationArguments args) {
        ensureDedicatedUsageStorage();
    }

    private void ensureDedicatedUsageStorage() {
        createDedicatedTables();
        createFutureModuleTables();

        String relationType = relationType("energy_usage");
        if ("table".equals(relationType)) {
            migrateLegacyRows("energy_usage");
            jdbcTemplate.execute("ALTER TABLE energy_usage RENAME TO energy_usage_legacy");
            migrateLegacyRows("energy_usage_legacy");
            jdbcTemplate.execute("DROP TABLE IF EXISTS energy_usage_legacy");
        }

        resetSequence("electric_usage");
        resetSequence("gas_usage");
        resetSequence("hourly_electric_usage");

        jdbcTemplate.execute("DROP VIEW IF EXISTS energy_usage");
        jdbcTemplate.execute("""
            CREATE VIEW energy_usage AS
            SELECT
                id,
                meter_id,
                timestamp,
                usage_kwh,
                cost,
                source,
                source_provider,
                ingestion_batch_id,
                processing_version,
                created_at
            FROM hourly_electric_usage
            UNION ALL
            SELECT
                -(id + 100000000) AS id,
                meter_id,
                timestamp,
                usage_kwh,
                cost,
                source,
                source_provider,
                ingestion_batch_id,
                processing_version,
                created_at
            FROM gas_usage
            """);
        // NOTE: electric_usage (daily Green Button) is kept as a standalone table
        // for reconciliation. It is NOT in the energy_usage view — only the hourly
        // table feeds consumption charts to avoid double-counting.
    }

    private void createDedicatedTables() {
        jdbcTemplate.execute("""
            CREATE TABLE IF NOT EXISTS electric_usage (
                id                  SERIAL PRIMARY KEY,
                meter_id            INTEGER        NOT NULL REFERENCES meters(id),
                timestamp           TIMESTAMP      NOT NULL,
                usage_kwh           NUMERIC(10,3)  NOT NULL,
                cost                NUMERIC(10,2),
                source              VARCHAR(100)   NOT NULL,
                source_provider     VARCHAR(50)    NOT NULL,
                ingestion_batch_id  UUID           NOT NULL,
                processing_version  VARCHAR(20)    NOT NULL DEFAULT '1.0',
                created_at          TIMESTAMP      NOT NULL DEFAULT NOW()
            )
            """);
        jdbcTemplate.execute("CREATE INDEX IF NOT EXISTS idx_electric_usage_meter_time ON electric_usage (meter_id, timestamp)");
        jdbcTemplate.execute("CREATE INDEX IF NOT EXISTS idx_electric_usage_timestamp ON electric_usage (timestamp)");
        jdbcTemplate.execute("CREATE INDEX IF NOT EXISTS idx_electric_usage_batch ON electric_usage (ingestion_batch_id)");
        jdbcTemplate.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_electric_usage_unique ON electric_usage (meter_id, timestamp, source_provider)");

        jdbcTemplate.execute("""
            CREATE TABLE IF NOT EXISTS gas_usage (
                id                  SERIAL PRIMARY KEY,
                meter_id            INTEGER        NOT NULL REFERENCES meters(id),
                timestamp           TIMESTAMP      NOT NULL,
                usage_kwh           NUMERIC(10,3)  NOT NULL,
                cost                NUMERIC(10,2),
                source              VARCHAR(100)   NOT NULL,
                source_provider     VARCHAR(50)    NOT NULL,
                ingestion_batch_id  UUID           NOT NULL,
                processing_version  VARCHAR(20)    NOT NULL DEFAULT '1.0',
                created_at          TIMESTAMP      NOT NULL DEFAULT NOW()
            )
            """);
        jdbcTemplate.execute("CREATE INDEX IF NOT EXISTS idx_gas_usage_meter_time ON gas_usage (meter_id, timestamp)");
        jdbcTemplate.execute("CREATE INDEX IF NOT EXISTS idx_gas_usage_timestamp ON gas_usage (timestamp)");
        jdbcTemplate.execute("CREATE INDEX IF NOT EXISTS idx_gas_usage_batch ON gas_usage (ingestion_batch_id)");
        jdbcTemplate.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_gas_usage_unique ON gas_usage (meter_id, timestamp, source_provider)");

        jdbcTemplate.execute("""
            CREATE TABLE IF NOT EXISTS hourly_electric_usage (
                id                  SERIAL PRIMARY KEY,
                meter_id            INTEGER        NOT NULL REFERENCES meters(id),
                timestamp           TIMESTAMP      NOT NULL,
                usage_kwh           NUMERIC(10,3)  NOT NULL,
                cost                NUMERIC(10,2),
                source              VARCHAR(100)   NOT NULL,
                source_provider     VARCHAR(50)    NOT NULL,
                ingestion_batch_id  UUID           NOT NULL,
                processing_version  VARCHAR(20)    NOT NULL DEFAULT '1.0',
                created_at          TIMESTAMP      NOT NULL DEFAULT NOW()
            )
            """);
        jdbcTemplate.execute("CREATE INDEX IF NOT EXISTS idx_hourly_usage_meter_time ON hourly_electric_usage (meter_id, timestamp)");
        jdbcTemplate.execute("CREATE INDEX IF NOT EXISTS idx_hourly_usage_timestamp ON hourly_electric_usage (timestamp)");
        jdbcTemplate.execute("CREATE INDEX IF NOT EXISTS idx_hourly_usage_batch ON hourly_electric_usage (ingestion_batch_id)");
        jdbcTemplate.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_hourly_usage_unique ON hourly_electric_usage (meter_id, timestamp, source_provider)");

        // Admin debug dashboard — diagnostic event log
        jdbcTemplate.execute("""
            CREATE TABLE IF NOT EXISTS app_events (
                id              SERIAL PRIMARY KEY,
                timestamp       TIMESTAMP      NOT NULL DEFAULT NOW(),
                category        VARCHAR(50)    NOT NULL,
                level           VARCHAR(10)    NOT NULL,
                source          VARCHAR(100)   NOT NULL,
                message         TEXT           NOT NULL,
                details         TEXT
            )
            """);
        jdbcTemplate.execute("CREATE INDEX IF NOT EXISTS idx_app_events_timestamp ON app_events (timestamp DESC)");
        jdbcTemplate.execute("CREATE INDEX IF NOT EXISTS idx_app_events_category  ON app_events (category)");
        jdbcTemplate.execute("CREATE INDEX IF NOT EXISTS idx_app_events_level     ON app_events (level)");
    }

    private void createFutureModuleTables() {
        jdbcTemplate.execute("""
            CREATE TABLE IF NOT EXISTS water_usage (
                id                  SERIAL PRIMARY KEY,
                timestamp           TIMESTAMP      NOT NULL,
                usage_gallons       NUMERIC(12,3)  NOT NULL,
                cost                NUMERIC(10,2),
                source              VARCHAR(100)   NOT NULL,
                source_provider     VARCHAR(50)    NOT NULL,
                ingestion_batch_id  UUID           NOT NULL,
                processing_version  VARCHAR(20)    NOT NULL DEFAULT '1.0',
                created_at          TIMESTAMP      NOT NULL DEFAULT NOW()
            )
            """);
        jdbcTemplate.execute("CREATE INDEX IF NOT EXISTS idx_water_usage_timestamp ON water_usage (timestamp)");
        jdbcTemplate.execute("CREATE INDEX IF NOT EXISTS idx_water_usage_batch ON water_usage (ingestion_batch_id)");

        jdbcTemplate.execute("""
            CREATE TABLE IF NOT EXISTS weather_observations (
                id                    SERIAL PRIMARY KEY,
                observation_date      DATE           NOT NULL,
                station_code          VARCHAR(100)   NOT NULL,
                high_temp_f           NUMERIC(5,2),
                low_temp_f            NUMERIC(5,2),
                avg_temp_f            NUMERIC(5,2),
                humidity_pct          NUMERIC(5,2),
                precipitation_inches  NUMERIC(8,3),
                source                VARCHAR(100)   NOT NULL,
                source_provider       VARCHAR(50)    NOT NULL,
                ingestion_batch_id    UUID,
                processing_version    VARCHAR(20)    NOT NULL DEFAULT '1.0',
                created_at            TIMESTAMP      NOT NULL DEFAULT NOW(),
                UNIQUE (observation_date, station_code, source_provider)
            )
            """);
        jdbcTemplate.execute("CREATE INDEX IF NOT EXISTS idx_weather_observations_date ON weather_observations (observation_date)");

        jdbcTemplate.execute("""
            CREATE TABLE IF NOT EXISTS roomba_runs (
                id                  SERIAL PRIMARY KEY,
                started_at          TIMESTAMP      NOT NULL,
                completed_at        TIMESTAMP,
                duration_minutes    INTEGER,
                dirt_events         INTEGER,
                square_feet         INTEGER,
                status              VARCHAR(50)    NOT NULL DEFAULT 'COMPLETED',
                mission_id          VARCHAR(64),
                mission_number      INTEGER,
                error               INTEGER,
                error_text          VARCHAR(255),
                initiator           VARCHAR(40),
                cycle               VARCHAR(40),
                source              VARCHAR(100)   NOT NULL,
                source_provider     VARCHAR(50)    NOT NULL,
                ingestion_batch_id  UUID,
                processing_version  VARCHAR(20)    NOT NULL DEFAULT '1.0',
                created_at          TIMESTAMP      NOT NULL DEFAULT NOW()
            )
            """);
        jdbcTemplate.execute("CREATE INDEX IF NOT EXISTS idx_roomba_runs_started_at ON roomba_runs (started_at)");
        // Per-run detail columns (added for the run-detail popup). Idempotent —
        // ADD COLUMN IF NOT EXISTS backfills existing roomba_runs tables.
        for (String col : new String[]{
                "mission_id VARCHAR(64)", "mission_number INTEGER", "error INTEGER",
                "error_text VARCHAR(255)", "initiator VARCHAR(40)", "cycle VARCHAR(40)"}) {
            jdbcTemplate.execute("ALTER TABLE roomba_runs ADD COLUMN IF NOT EXISTS " + col);
        }

        // Latest live-status snapshot per robot (poller UPSERTs, UNIQUE robot_id).
        jdbcTemplate.execute("""
            CREATE TABLE IF NOT EXISTS roomba_status (
                id                  SERIAL PRIMARY KEY,
                robot_id            VARCHAR(64)    NOT NULL UNIQUE,
                name                VARCHAR(120),
                battery_pct         INTEGER,
                phase               VARCHAR(40),
                cycle               VARCHAR(40),
                error               INTEGER        DEFAULT 0,
                bin_present         BOOLEAN,
                tank_present        BOOLEAN,
                current_mission_id  VARCHAR(64),
                mission_start       TIMESTAMP,
                sqft                INTEGER,
                runtime_minutes     INTEGER,
                dock_state          INTEGER,
                lifetime_missions   INTEGER,
                lifetime_run_minutes INTEGER,
                map_version         VARCHAR(64),
                raw                 JSONB,
                updated_at          TIMESTAMP      NOT NULL DEFAULT NOW()
            )
            """);

        // Current floor-plan map bundle per robot (poller UPSERTs on map_version change).
        jdbcTemplate.execute("""
            CREATE TABLE IF NOT EXISTS roomba_map (
                id            SERIAL PRIMARY KEY,
                robot_id      VARCHAR(64)  NOT NULL UNIQUE,
                map_id        VARCHAR(80),
                map_version   VARCHAR(64),
                name          VARCHAR(120),
                geojson       JSONB        NOT NULL,
                updated_at    TIMESTAMP    NOT NULL DEFAULT NOW()
            )
            """);

        // Control command queue (backend enqueues ADMIN-only; poller executes).
        jdbcTemplate.execute("""
            CREATE TABLE IF NOT EXISTS roomba_commands (
                id            SERIAL PRIMARY KEY,
                robot_id      VARCHAR(64),
                command       VARCHAR(40)  NOT NULL,
                arg           VARCHAR(255),
                status        VARCHAR(20)  NOT NULL DEFAULT 'PENDING',
                detail        VARCHAR(500),
                requested_by  VARCHAR(120),
                created_at    TIMESTAMP    NOT NULL DEFAULT NOW(),
                processed_at  TIMESTAMP
            )
            """);
        jdbcTemplate.execute(
            "CREATE INDEX IF NOT EXISTS idx_roomba_commands_status ON roomba_commands (status, id)");
        // Widen arg on already-created tables (rename_room / split_room store JSON,
        // not a bare id; a multi-corner divide can be long). Metadata-only length
        // increase — cheap + idempotent.
        jdbcTemplate.execute("ALTER TABLE roomba_commands ALTER COLUMN arg TYPE VARCHAR(1024)");

        // Static device identity + firmware (poller UPSERTs once per connect).
        jdbcTemplate.execute("""
            CREATE TABLE IF NOT EXISTS roomba_device (
                id            SERIAL PRIMARY KEY,
                robot_id      VARCHAR(64)  NOT NULL UNIQUE,
                sku           VARCHAR(40),
                series        VARCHAR(20),
                family        VARCHAR(60),
                serial_number VARCHAR(60),
                firmware      VARCHAR(60),
                updated_at    TIMESTAMP    NOT NULL DEFAULT NOW()
            )
            """);

        // Live robot position (poller UPSERTs from watch_live_map() mid-mission,
        // UNIQUE robot_id). x/y meters in the map bundle's coordinate space;
        // theta = raw wire heading (radians). Read-only + staleness-gated by the API.
        jdbcTemplate.execute("""
            CREATE TABLE IF NOT EXISTS roomba_position (
                id            SERIAL PRIMARY KEY,
                robot_id      VARCHAR(64)       NOT NULL UNIQUE,
                x             DOUBLE PRECISION,
                y             DOUBLE PRECISION,
                theta         DOUBLE PRECISION,
                updated_at    TIMESTAMP         NOT NULL DEFAULT NOW()
            )
            """);
    }

    private void migrateLegacyRows(String tableName) {
        jdbcTemplate.execute("""
            INSERT INTO electric_usage (id, meter_id, timestamp, usage_kwh, cost, source, source_provider, ingestion_batch_id, processing_version, created_at)
            SELECT legacy.id, legacy.meter_id, legacy.timestamp, legacy.usage_kwh, legacy.cost, legacy.source, legacy.source_provider, legacy.ingestion_batch_id, legacy.processing_version, legacy.created_at
            FROM %s legacy
            JOIN meters m ON m.id = legacy.meter_id
            WHERE UPPER(m.type) = 'ELECTRIC'
            ON CONFLICT (meter_id, timestamp, source_provider) DO NOTHING
            """.formatted(tableName));

        jdbcTemplate.execute("""
            INSERT INTO gas_usage (id, meter_id, timestamp, usage_kwh, cost, source, source_provider, ingestion_batch_id, processing_version, created_at)
            SELECT legacy.id, legacy.meter_id, legacy.timestamp, legacy.usage_kwh, legacy.cost, legacy.source, legacy.source_provider, legacy.ingestion_batch_id, legacy.processing_version, legacy.created_at
            FROM %s legacy
            JOIN meters m ON m.id = legacy.meter_id
            WHERE UPPER(m.type) = 'GAS'
            ON CONFLICT (meter_id, timestamp, source_provider) DO NOTHING
            """.formatted(tableName));
    }

    private void resetSequence(String tableName) {
        jdbcTemplate.execute("""
            SELECT setval(
                pg_get_serial_sequence('%s', 'id'),
                COALESCE((SELECT MAX(id) FROM %s), 1),
                true
            )
            """.formatted(tableName, tableName));
    }

    private boolean tableExists(String tableName) {
        Integer count = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ?",
                Integer.class,
                tableName
        );
        return count != null && count > 0;
    }

    private String relationType(String relationName) {
        return jdbcTemplate.query(
                "SELECT CASE relkind WHEN 'r' THEN 'table' WHEN 'v' THEN 'view' ELSE relkind::text END FROM pg_class WHERE relname = ? LIMIT 1",
                rs -> rs.next() ? rs.getString(1) : null,
                relationName
        );
    }
}