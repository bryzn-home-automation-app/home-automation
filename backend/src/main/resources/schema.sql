-- ============================================================
-- Home Automation Platform — Initial Schema
-- Provider-agnostic data model for utility integrations
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

CREATE TABLE IF NOT EXISTS energy_usage (
    id          SERIAL PRIMARY KEY,
    meter_id    INTEGER        NOT NULL REFERENCES meters(id),
    timestamp   TIMESTAMP      NOT NULL,
    usage_kwh   NUMERIC(10,3)  NOT NULL,
    cost        NUMERIC(10,2),
    source      VARCHAR(100)   NOT NULL,  -- e.g. 'CoServ API', 'Manual CSV'
    raw_file    VARCHAR(500),             -- reference to archived import file
    created_at  TIMESTAMP      NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_energy_usage_meter_time ON energy_usage (meter_id, timestamp);
CREATE INDEX idx_energy_usage_timestamp   ON energy_usage (timestamp);

CREATE TABLE IF NOT EXISTS utility_bills (
    id                    SERIAL PRIMARY KEY,
    account_id            INTEGER        NOT NULL REFERENCES utility_accounts(id),
    billing_period_start  DATE           NOT NULL,
    billing_period_end    DATE           NOT NULL,
    usage_kwh             NUMERIC(10,3),
    amount                NUMERIC(10,2)  NOT NULL,
    due_date              DATE,
    status                VARCHAR(50)    NOT NULL DEFAULT 'ISSUED',
    raw_file              VARCHAR(500),  -- reference to archived import file
    created_at            TIMESTAMP      NOT NULL DEFAULT NOW(),
    updated_at            TIMESTAMP      NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_utility_bills_account  ON utility_bills (account_id);
CREATE INDEX idx_utility_bills_period   ON utility_bills (billing_period_start, billing_period_end);

-- ============================================================
-- CoServ seed data — provider record
-- ============================================================
INSERT INTO utility_providers (name, type, portal_url, is_active)
VALUES ('CoServ', 'ELECTRIC', 'https://myaccount.coserv.com', TRUE)
ON CONFLICT DO NOTHING;
