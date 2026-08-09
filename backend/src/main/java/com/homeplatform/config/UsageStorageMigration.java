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
        }

        if (tableExists("energy_usage_legacy")) {
            migrateLegacyRows("energy_usage_legacy");
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
            FROM electric_usage
            UNION ALL
            SELECT
                -id AS id,
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
            FROM hourly_electric_usage
            """);
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
                source              VARCHAR(100)   NOT NULL,
                source_provider     VARCHAR(50)    NOT NULL,
                ingestion_batch_id  UUID,
                processing_version  VARCHAR(20)    NOT NULL DEFAULT '1.0',
                created_at          TIMESTAMP      NOT NULL DEFAULT NOW()
            )
            """);
        jdbcTemplate.execute("CREATE INDEX IF NOT EXISTS idx_roomba_runs_started_at ON roomba_runs (started_at)");
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