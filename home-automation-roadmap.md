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

Downloaded files should be stored temporarily or archived as raw imports for debugging and future reprocessing. Parsed data should be stored in PostgreSQL while maintaining historical records instead of overwriting previous values.

The integration should handle portal changes, authentication failures, and extraction errors gracefully through logging, screenshots/traces from Playwright failures, and user notifications when synchronization requires attention.

The long-term goal is to create a reusable integration framework where CoServ is the first provider adapter, allowing future integrations with other utilities, smart home platforms, solar providers, and home automation systems without major architectural changes.

### CoServ Integration Layer

**Authentication:** Playwright browser automation to log into the CoServ customer portal. Credentials stored via environment variables or encrypted DB — never plaintext. Session cookies/tokens managed and refreshed automatically.

**Data sync (scheduled, e.g. hourly):**

1. Launch Playwright browser session
2. Authenticate with CoServ portal
3. Navigate to usage/billing pages
4. Download available data exports (XML, Excel, CSV)
5. Archive raw files for debugging/reprocessing
6. Parse and validate downloaded data
7. Normalize into provider-agnostic models
8. Store in PostgreSQL (append-only, never overwrite)
9. Capture screenshots on failure, log errors, notify user if sync requires attention

---

## Data Model (Provider-Agnostic)

### UtilityProvider
`id | name | type | createdDate`
*Example: CoServ (Electric Provider). Future: Oncor, Atmos Energy, Water Provider.*

### UtilityAccount
`id | providerId | accountNumber | serviceAddress | status`

### Meter
`id | accountId | meterNumber | type | location`

### EnergyUsage
`id | meterId | timestamp | usageKwh | cost | source`
*Example: 2026-08-01 | 45.3 kWh | $5.12 | CoServ API*

### UtilityBill
`id | accountId | billingPeriodStart | billingPeriodEnd | usage | amount | dueDate | status`

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
