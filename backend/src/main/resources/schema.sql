-- ============================================================
-- Home Automation Platform — Initial Schema
-- Provider-agnostic data model for utility integrations
-- Append-only design: never UPDATE or DELETE data rows.
-- Designed for 5+ year historical retention.
-- ============================================================

CREATE TABLE IF NOT EXISTS utility_providers (
    id            SERIAL PRIMARY KEY,
    name          VARCHAR(100) NOT NULL,
    type          VARCHAR(50)  NOT NULL,  -- ELECTRIC, GAS, WATER, SOLAR
    portal_url    VARCHAR(255),
    is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMP    NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS utility_accounts (
    id              SERIAL PRIMARY KEY,
    provider_id     INTEGER      NOT NULL REFERENCES utility_providers(id),
    account_number  VARCHAR(100) NOT NULL,
    service_address VARCHAR(255),
    status          VARCHAR(50)  NOT NULL DEFAULT 'ACTIVE',
    created_at      TIMESTAMP    NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS meters (
    id            SERIAL PRIMARY KEY,
    account_id    INTEGER      NOT NULL REFERENCES utility_accounts(id),
    meter_number  VARCHAR(100) NOT NULL,
    type          VARCHAR(50)  NOT NULL DEFAULT 'ELECTRIC',
    location      VARCHAR(255),
    created_at    TIMESTAMP    NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMP    NOT NULL DEFAULT NOW()
);

-- Electric tab storage. Append-only: rows are never updated or deleted.
CREATE TABLE IF NOT EXISTS electric_usage (
    id                  SERIAL PRIMARY KEY,
    meter_id            INTEGER        NOT NULL REFERENCES meters(id),
    timestamp           TIMESTAMP      NOT NULL,
    usage_kwh           NUMERIC(10,3)  NOT NULL,
    cost                NUMERIC(10,2),
    source              VARCHAR(100)   NOT NULL,  -- e.g. 'CoServ API', 'Manual CSV'
    source_provider     VARCHAR(50)    NOT NULL,  -- e.g. 'coserv', 'oncor'
    ingestion_batch_id  UUID           NOT NULL,  -- ties records from one sync together
    processing_version  VARCHAR(20)    NOT NULL DEFAULT '1.0',  -- parser version
    created_at          TIMESTAMP      NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_electric_usage_meter_time ON electric_usage (meter_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_electric_usage_timestamp   ON electric_usage (timestamp);
CREATE INDEX IF NOT EXISTS idx_electric_usage_batch       ON electric_usage (ingestion_batch_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_electric_usage_unique ON electric_usage (meter_id, timestamp, source_provider);

-- Gas tab storage. Append-only: rows are never updated or deleted.
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
);

CREATE INDEX IF NOT EXISTS idx_gas_usage_meter_time ON gas_usage (meter_id, timestamp);
CREATE INDEX IF NOT EXISTS idx_gas_usage_timestamp   ON gas_usage (timestamp);
CREATE INDEX IF NOT EXISTS idx_gas_usage_batch       ON gas_usage (ingestion_batch_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_gas_usage_unique ON gas_usage (meter_id, timestamp, source_provider);

-- Water tab storage. Kept isolated from the energy datasets.
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
);

CREATE INDEX IF NOT EXISTS idx_water_usage_timestamp ON water_usage (timestamp);
CREATE INDEX IF NOT EXISTS idx_water_usage_batch     ON water_usage (ingestion_batch_id);

-- Shared enrichment for electric and gas dashboards.
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
);

CREATE INDEX IF NOT EXISTS idx_weather_observations_date ON weather_observations (observation_date);

-- Roomba tab storage. Kept fully separate from utility data.
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
);

CREATE INDEX IF NOT EXISTS idx_roomba_runs_started_at ON roomba_runs (started_at);

-- Compatibility view so the current backend and frontend contract can read
-- electric + gas records while the physical storage stays isolated.
CREATE OR REPLACE VIEW energy_usage AS
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
FROM gas_usage;

-- Append-only: bills are never updated — new statement = new row.
CREATE TABLE IF NOT EXISTS utility_bills (
    id                    SERIAL PRIMARY KEY,
    account_id            INTEGER        NOT NULL REFERENCES utility_accounts(id),
    billing_period_start  DATE           NOT NULL,
    billing_period_end    DATE           NOT NULL,
    usage_kwh             NUMERIC(10,3),
    amount                NUMERIC(10,2)  NOT NULL,
    due_date              DATE,
    status                VARCHAR(50)    NOT NULL DEFAULT 'ISSUED',
    source                VARCHAR(100)   NOT NULL DEFAULT 'CoServ API',
    source_provider       VARCHAR(50)    NOT NULL DEFAULT 'coserv',
    ingestion_batch_id    UUID           NOT NULL,
    processing_version    VARCHAR(20)    NOT NULL DEFAULT '1.0',
    created_at            TIMESTAMP      NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_utility_bills_account  ON utility_bills (account_id);
CREATE INDEX idx_utility_bills_period   ON utility_bills (billing_period_start, billing_period_end);
CREATE INDEX idx_utility_bills_batch    ON utility_bills (ingestion_batch_id);

-- ============================================================
-- CoServ seed data — provider record
-- ============================================================
INSERT INTO utility_providers (name, type, portal_url, is_active)
VALUES ('CoServ', 'ELECTRIC', 'https://myaccount.coserv.com', TRUE)
ON CONFLICT DO NOTHING;

-- ============================================================
-- User Management & Access Control
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
    id              SERIAL PRIMARY KEY,
    email           VARCHAR(255) NOT NULL UNIQUE,
    username        VARCHAR(100) NOT NULL UNIQUE,
    display_name    VARCHAR(200),
    password_hash   VARCHAR(255),
    role            VARCHAR(20)  NOT NULL DEFAULT 'USER',      -- ADMIN, USER, GUEST
    status          VARCHAR(20)  NOT NULL DEFAULT 'PENDING_APPROVAL', -- PENDING_APPROVAL, ACTIVE, DISABLED, EXPIRED
    is_active       BOOLEAN      NOT NULL DEFAULT FALSE,
    approved_by     INTEGER      REFERENCES users(id),
    approved_at     TIMESTAMP,
    last_login_at   TIMESTAMP,
    login_count       INTEGER      NOT NULL DEFAULT 0,
    connection_count  INTEGER      NOT NULL DEFAULT 0,
    phone             VARCHAR(30),
    avatar_url        VARCHAR(500),
    accent_color      VARCHAR(7)   NOT NULL DEFAULT '#34d399',
    created_at      TIMESTAMP    NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_username ON users (username);
CREATE INDEX IF NOT EXISTS idx_users_email    ON users (email);
CREATE INDEX IF NOT EXISTS idx_users_status   ON users (status);
CREATE INDEX IF NOT EXISTS idx_users_role     ON users (role);

CREATE TABLE IF NOT EXISTS guest_sessions (
    id              SERIAL PRIMARY KEY,
    user_id         INTEGER      NOT NULL REFERENCES users(id),
    ip_address      VARCHAR(45),
    user_agent      VARCHAR(500),
    connected_at    TIMESTAMP    NOT NULL DEFAULT NOW(),
    last_seen_at    TIMESTAMP    NOT NULL DEFAULT NOW(),
    expires_at      TIMESTAMP    NOT NULL,
    status          VARCHAR(20)  NOT NULL DEFAULT 'ACTIVE',   -- ACTIVE, EXPIRED, REVOKED
    created_at      TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_guest_sessions_user   ON guest_sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_guest_sessions_status ON guest_sessions (status);
CREATE INDEX IF NOT EXISTS idx_guest_sessions_expiry ON guest_sessions (expires_at);

-- ============================================================
-- Notification Center
-- ============================================================

CREATE TABLE IF NOT EXISTS notifications (
    id            SERIAL PRIMARY KEY,
    user_id       INTEGER      NOT NULL REFERENCES users(id),
    category      VARCHAR(30)  NOT NULL,  -- ELECTRICAL, GAS, WATER, ROOMBA, WIFI
    severity      VARCHAR(20)  NOT NULL DEFAULT 'INFO',  -- CRITICAL, WARNING, INFO, SUCCESS
    title         VARCHAR(200) NOT NULL,
    message       VARCHAR(1000),
    is_read       BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at    TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user     ON notifications (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_unread   ON notifications (user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_category ON notifications (user_id, category, created_at DESC);

-- ============================================================
-- Maintenance Log
-- ============================================================

CREATE TABLE IF NOT EXISTS maintenance_records (
    id                  SERIAL PRIMARY KEY,
    user_id             INTEGER         NOT NULL REFERENCES users(id),
    title               VARCHAR(200)    NOT NULL,
    description         TEXT,
    category            VARCHAR(50)     NOT NULL,
    area                VARCHAR(50),
    priority            VARCHAR(20)     NOT NULL DEFAULT 'MEDIUM',
    status              VARCHAR(20)     NOT NULL DEFAULT 'SCHEDULED',
    scheduled_date      DATE,
    started_date        DATE,
    completed_date      DATE,
    requested_by        VARCHAR(200),
    completed_by        VARCHAR(200),
    estimated_cost      NUMERIC(12,2),
    actual_cost         NUMERIC(12,2),
    labor_cost          NUMERIC(12,2),
    material_cost       NUMERIC(12,2),
    contractor_name     VARCHAR(200),
    company             VARCHAR(200),
    receipt_number      VARCHAR(100),
    warranty_expiration DATE,
    photos_before       TEXT,
    photos_during       TEXT,
    photos_after        TEXT,
    documents           TEXT,
    notes               TEXT,
    created_at          TIMESTAMP       NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMP       NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_maintenance_user       ON maintenance_records (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_maintenance_status     ON maintenance_records (user_id, status);
CREATE INDEX IF NOT EXISTS idx_maintenance_category   ON maintenance_records (user_id, category);
CREATE INDEX IF NOT EXISTS idx_maintenance_completed  ON maintenance_records (user_id, completed_date DESC);
