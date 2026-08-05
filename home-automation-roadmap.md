# Home Automation Platform Roadmap

## Overview

A self-hosted home intelligence platform running on an Intel NUC via Docker Compose.

**Phase 1 goal:** Integrate with CoServ utility services for energy usage monitoring, cost tracking, and analytics.

**Core principle:** CoServ is the first integration, not the core domain. The platform must be designed as an extensible integration system where additional providers and smart home services plug in later.

---

## Architecture: Integration-First Design

The application domain understands *energy usage, billing data, meter readings, and utility rates* — not CoServ-specific API responses.

```
┌─────────────────────────────────┐
│       UtilityIntegration        │
├─────────────────────────────────┤
│  CoServAdapter                  │
│  FutureProviderAdapter          │
│  ManualImportAdapter            │
└─────────────────────────────────┘
```

---

## Deployment

Docker Compose on Intel NUC — simple updates, backups, and low operational complexity.

```
home-platform/
├── frontend/
├── backend/
├── integrations/
├── database/
├── docker-compose.yml
└── docs/
```

**Services:** frontend, backend-api, postgres, redis, nginx

---

## Technology Stack

| Layer    | Recommendation                                                    |
|----------|-------------------------------------------------------------------|
| Frontend | React, TypeScript, Vite, Tailwind, React Query, chart library     |
| Backend  | Java Spring Boot, REST API, PostgreSQL, scheduled background jobs |
| Infra    | Docker Compose, Nginx reverse proxy, Redis cache                  |

Backend responsibilities: API aggregation, data normalization, analytics, user management, integration management.

---

## Phase 1 MVP — CoServ Energy Dashboard

## CoServ Integration (Initial Data Source)

The first integration will connect to the CoServ customer portal to retrieve homeowner energy usage and billing data. Since CoServ does not provide a traditional public API, the system will use Playwright browser automation to authenticate, navigate the portal, and download available data exports such as XML, Excel, or CSV files.

The CoServ integration should be isolated as an adapter layer so the core application is not dependent on CoServ-specific behavior. The workflow should include automated login/session handling, scheduled data extraction, file processing, parsing, validation, and normalization into generic application models such as Utility Provider, Utility Account, Meter, Energy Usage, and Utility Bill.

Downloaded files are temporary ingestion artifacts only — processed, validated, and immediately deleted after successful import. The PostgreSQL database is the sole permanent record.

The integration should handle portal changes, authentication failures, and extraction errors gracefully through logging, screenshots/traces from Playwright failures, and user notifications when synchronization requires attention.

The long-term goal is to create a reusable integration framework where CoServ is the first provider adapter, allowing future integrations with other utilities, smart home platforms, solar providers, and home automation systems without major architectural changes.

### CoServ Integration Layer

**Portal:** SmartHub by NISC (`coserv.smarthub.coop`) — Angular Material SPA. No public API; data accessed via Green Button Download (NAESB ESPI XML standard).

**Authentication:** Playwright browser automation logs into SmartHub using `input[aria-label="Email"]` + `input[aria-label="Password"]`. Credentials stored via environment variables — never plaintext.

**Data download (scheduled, e.g. hourly):**

1. Launch Playwright browser session, authenticate with SmartHub
2. Navigate to Green Button page (`#/usageManagement/greenButton`)
3. Open "Green Button Download" modal dialog
4. For each service (Electric + Natural Gas):
   - Select service via `#mat-input-2` dropdown
   - Set interval to DAILY, format to Green Button XML
   - Set date range via direct text input (MM/DD/YYYY)
   - Click Download → Green Button ZIP (XML inside)
5. Parse NAESB ESPI XML: `IntervalBlock/IntervalReading/value` × `10^powerOfTenMultiplier`
6. Normalize into provider-agnostic `EnergyUsage` records
7. Insert into PostgreSQL (append-only)
8. Delete temp ZIP after successful processing
9. If no data available for a service, store 0 kWh records for that date

---

## Data Storage Strategy

### Temporary Integration Files

CoServ exports (XML, Excel, CSV) are **temporary ingestion artifacts only**. The Playwright automation downloads them to a temp directory, processes and validates the data, extracts the required information, normalizes it, and stores it in PostgreSQL. Once processing succeeds, the downloaded files are **immediately deleted**. They are never archived, never served, and never considered a source of truth. The database is the sole permanent record.

### Append-Only Database Design

All utility data follows an **append-only (immutable) pattern**:
- **Never update** existing usage, billing, or meter records
- **Never delete** historical data
- New data is always inserted as new rows
- Every record includes audit metadata for traceability

### Long-Term Retention

The system is designed to retain **5+ years** of historical data for trends, analytics, and future insights. Future optimizations (indexing, partitioning by year, cold storage archival) can be added as data grows, but the default is to retain everything.

### Record Metadata

Every ingested record carries:

| Column              | Purpose                                                       |
|---------------------|---------------------------------------------------------------|
| `source`            | Where data came from (e.g. "CoServ API")                      |
| `source_provider`   | Provider key (e.g. "coserv")                                  |
| `ingestion_batch_id`| UUID tying all records from one sync run together             |
| `processing_version`| Version of the parser/normalizer that produced this record    |
| `created_at`        | When this record was inserted into the database               |

This metadata enables auditing, debugging, and full reprocessing if CoServ changes their export formats or parsing logic — historical records can be traced back to their ingestion batch.

---

## Data Model (Provider-Agnostic)

### UtilityProvider
`id | name | type | portal_url | is_active | created_at | updated_at`
*Example: CoServ (Electric Provider). Future: Oncor, Atmos Energy, Water Provider.*

### UtilityAccount
`id | provider_id | account_number | service_address | status | created_at | updated_at`

### Meter
`id | account_id | meter_number | type | location | created_at | updated_at`

### EnergyUsage
`id | meter_id | timestamp | usage_kwh | cost | source | source_provider | ingestion_batch_id | processing_version | raw_file | created_at`
*Example: 2026-08-01 | 45.3 kWh | $5.12 | CoServ API | coserv | batch-uuid | v1*

### UtilityBill
`id | account_id | billing_period_start | billing_period_end | usage_kwh | amount | due_date | status | source | source_provider | ingestion_batch_id | processing_version | raw_file | created_at | updated_at`

---

## Dashboard Features

### Current Usage
- Today's usage, current month usage, current estimated bill

### Usage Charts
- **Daily Usage** — line chart (date vs kWh)
- **Monthly Comparison** — bar chart (month-over-month)
- **Cost Trend** — line chart (monthly cost over time)

### Energy Analytics
- **Average Daily Usage** — monthly kWh ÷ days
- **Estimated Monthly Bill** — based on current usage, historical patterns, and rates
- **Usage Comparison** — "Your usage is 18% higher than last month"; "Highest usage day: July 15"

---

## Future Phases

### Phase 2 — Expand Utility Integrations
Gas, water, solar, EV charging. Generic provider interface + manual CSV import.

### Phase 3 — Smart Home Integration
Home Assistant, MQTT, Zigbee, smart meters, sensors.
*Example: "HVAC ran 40% longer this month", "Garage door opened while away."*

### Phase 4 — Home Intelligence
- **Mortgage** — balance, interest paid, equity tracking
- **Maintenance** — repairs, warranty, service history
- **Documents** — utility bills, contracts, receipts

### AI Layer (Future)
*"Why was my bill higher?", "Which appliances are driving usage?", "How much could solar save?"*

---

## Development Milestones

| # | Milestone                      | Scope                                                              |
|---|--------------------------------|--------------------------------------------------------------------|
| 1 | **Infrastructure**             | Docker Compose, PostgreSQL, backend + frontend scaffolding         |
| 2 | **CoServ Integration**         | Authentication, API client, data sync jobs, DB storage             |
| 3 | **Dashboard**                  | Usage charts, billing history, analytics                           |
| 4 | **Integration Framework**      | Generic provider interface, additional utility support             |
| 5 | **Home Automation Expansion**  | Smart devices, mortgage, maintenance, documents                    |

---

## End-State Vision

```
Home Automation Platform
├── Utilities
├── Energy Analytics
├── Mortgage Intelligence
├── Maintenance
├── Documents
├── Smart Devices
└── AI Assistant
```

The first implementation solves a real problem (CoServ energy monitoring) while creating the foundation for all future home integrations.
