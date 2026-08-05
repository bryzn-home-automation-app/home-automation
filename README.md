# Home Automation Platform

Self-hosted home intelligence platform running on Docker Compose. Phase 1 integrates with CoServ SmartHub to track energy usage, visualize consumption patterns, and estimate bills.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Docker Compose                        │
│                                                         │
│  ┌──────────┐  ┌──────────┐  ┌─────────┐  ┌─────────┐  │
│  │ postgres │  │  redis   │  │ backend │  │  nginx  │  │
│  │   :5432  │  │  :6379   │  │  :8080  │  │  :80    │  │
│  └────┬─────┘  └──────────┘  └────┬─────┘  └────┬─────┘  │
│       │                           │             │        │
└───────┼───────────────────────────┼─────────────┼────────┘
        │                           │             │
        │                    ┌──────┘      ┌──────┘
        ▼                    ▼             ▼
   PostgreSQL           REST API      React SPA
   (source of truth)   (Spring Boot)  (Vite + Tailwind)
        ▲
        │ writes
   ┌────┴────┐
   │ sync.js │  ← standalone Node.js CLI
   └────┬────┘     (runs outside Docker)
        │
   ┌────┴────┐
   │ CoServ  │  ← SmartHub Green Button
   │SmartHub │     (Playwright automation)
   └─────────┘
```

**Key design decisions:**

- **Sync and dashboard are fully decoupled.** The sync script writes directly to PostgreSQL. The backend is a thin REST API that reads from the DB. The frontend queries the API.
- **Sync runs as a standalone CLI** (`node scripts/sync.js`), not in Docker. No browser dependencies in the backend image.
- **Database is append-only.** Energy usage rows are never updated or deleted. Every record carries batch UUIDs for traceability.
- **Unique constraint** on `(meter_id, timestamp, source_provider)` prevents duplicate records.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, TypeScript, Vite, Tailwind CSS v4, React Query, Recharts |
| Backend | Java 21, Spring Boot 3.4, Hibernate/JPA, PostgreSQL |
| Cache | Redis 7 |
| Sync | Node.js, Playwright (headless Chromium), adm-zip, pg |
| Infra | Docker Compose, Nginx reverse proxy |
| Portal | CoServ SmartHub by NISC (Angular Material SPA) |
| Data format | Green Button (NAESB ESPI XML standard) |

## Getting Started

### Prerequisites

- Docker 29+ with Docker Compose v5+
- Node.js 22+ (for sync script and smoke tests)
- Java 21+ and Maven 3.9+ (for local backend development)

### Quick Start

```bash
# 1. Clone and set up environment
git clone https://github.com/bryzn-home-automation-app/home-automation.git
cd home-automation
cp .env.example .env

# 2. Fill in .env with your CoServ credentials and PostgreSQL settings
#    COSERV_USERNAME=you@email.com
#    COSERV_PASSWORD=your-password
#    DATA_START_DATE=07/24/2026   # house purchase / move-in date
#    KWH_RATE=0.1171              # your CoServ electric rate

# 3. Install Playwright browser (one-time)
npm install
npx playwright install chromium

# 4. Start the platform
docker compose up -d

# 5. Run the initial backfill (downloads all usage from DATA_START_DATE)
npm run sync -- --date 07/24/2026   # use your DATA_START_DATE

# 6. Open http://localhost
```

### Access URLs

| Service | URL |
|---------|-----|
| Dashboard | http://localhost |
| Backend health | http://localhost/api/health |
| Swagger UI | http://localhost:8080/swagger-ui |
| PostgreSQL | localhost:5432 |

## Data Sync

Sync pulls energy usage data from CoServ SmartHub via the Green Button Download feature. The sync script is a standalone Node.js CLI — it does not run inside Docker.

### How It Works

1. Playwright opens headless Chromium, logs into SmartHub
2. Navigates to Usage Management → Green Button
3. Opens the "Green Button Download" modal dialog
4. For each service (Electric + Natural Gas):
   - Selects service, sets interval to **Daily**, format to **Green Button (XML)**
   - Sets the date range, clicks Download
   - Receives a ZIP file containing NAESB ESPI XML
5. Parses `IntervalBlock/IntervalReading` entries into kWh values
6. Inserts records into PostgreSQL with `ON CONFLICT DO NOTHING` (idempotent)
7. Deletes temp files immediately after processing
8. If no data is available for a service, stores 0 kWh records for that date

### Sync Modes

The sync script automatically chooses the right mode based on the day of week and database state:

| Mode | Range | Trigger |
|------|-------|---------|
| **daily** | yesterday only | Monday–Saturday (default) |
| **weekly** | last 7 days | Sunday, or `--weekly` flag |
| **zero-guard** | last 3 days | Automatically: 3+ consecutive Electric days show 0 kWh |
| **single** | specified date | `--date MM/DD/YYYY` flag |

If zero-guard retries the last 3 days and still gets all zeros, a warning banner is printed suggesting you run `npm run test:live` to check if SmartHub changed their UI.

### Commands

```bash
npm run sync                      # auto mode (daily or weekly based on day)
npm run sync -- --weekly          # force weekly sync (last 7 days)
npm run sync -- --date 08/03/2026 # sync a specific single date
npm run sync -- --dry-run         # preview without writing to DB
npm run test:live                 # verify SmartHub selectors still work
```

### Scheduling

Set up a daily cron/task scheduler job:

```bash
# Example crontab — runs every day at 2:07 AM
7 2 * * * cd /path/to/home-automation && npm run sync >> logs/sync.log 2>&1
```

The script handles Sunday/weekday logic automatically. Zero-guard escalation happens inline. No special scheduling needed.

## API Endpoints

### Health

```
GET /api/health
→ { "status": "UP", "database": "connected", "timestamp": "..." }
```

### Config

```
GET /api/config
→ { "kwhRate": 0.1171, "dataStartDate": "07/24/2026" }
```

### Energy Usage

```
GET /api/energy-usage
→ [ { id, timestamp, usageKwh, cost, source, sourceProvider, ... } ]

GET /api/energy-usage/meter/{id}/recent?days=30
GET /api/energy-usage/meter/{id}/range?start=...&end=...
GET /api/energy-usage/meter/{id}/total?days=30
```

### Utility Providers

```
GET /api/utility-providers
GET /api/utility-providers/active
GET /api/utility-providers/type/ELECTRIC
```

### Integrations

```
GET /api/integrations
→ [ { "key": "coserv", "name": "CoServ", "type": "ELECTRIC", "healthy": "true" } ]

GET /api/integrations/coserv
→ { "dbConnected": true, "syncCommand": "npm run sync", ... }
```

## Dashboard

The frontend is a single-page React app served by Nginx.

### Features

- **Stat tiles** — Today's usage (kWh), month total, estimated bill (kWh × rate)
- **Daily Usage chart** — Recharts line chart with tooltips, dark theme
- **Monthly Comparison chart** — Recharts bar chart grouped by month
- **Integration Panel** — Sync status, CLI instructions, credential setup guide
- **Recent Activity** — scrollable list of the last 10 usage records
- **Loading/empty/error states** on all components
- Responsive layout (1-col mobile, 2-col/3-col desktop)

### Estimated Bill

The estimated bill multiplies your monthly kWh total by `KWH_RATE` from `.env`. Green Button does not include pricing data, so this is a configuration-driven estimate.

To match your actual CoServ bill, adjust `KWH_RATE` in `.env`:

```
KWH_RATE=0.1171   # $0.1171/kWh
```

Then run `docker compose restart backend` to pick up the change.

## Configuration

All configuration lives in `.env` (gitignored). Copy `.env.example` as a starting point.

| Variable | Default | Description |
|----------|---------|-------------|
| `POSTGRES_DB` | `homeplatform` | Database name |
| `POSTGRES_USER` | `homeplatform` | Database user |
| `POSTGRES_PASSWORD` | `changeme` | Database password |
| `COSERV_USERNAME` | — | SmartHub login email |
| `COSERV_PASSWORD` | — | SmartHub login password |
| `COSERV_PORTAL_URL` | `coserv.smarthub.coop/ui/#/login` | SmartHub login URL |
| `DATA_START_DATE` | `07/24/2026` | Earliest date to query (house purchase / move-in) |
| `KWH_RATE` | `0.12` | Electric rate in $/kWh for bill estimation |
| `JWT_SECRET` | — | JWT signing key (future auth) |

## Database Schema

Provider-agnostic data model designed for 5+ years of historical retention.

| Table | Purpose | Key columns |
|-------|---------|-------------|
| `utility_providers` | Utility companies | name, type, portal_url |
| `utility_accounts` | Accounts per provider | account_number, service_address, status |
| `meters` | Physical meters | meter_number, type, location |
| `energy_usage` | Append-only usage records | timestamp, usage_kwh, cost, ingestion_batch_id |
| `utility_bills` | Append-only bill records | billing_period, amount, status, ingestion_batch_id |

Every ingested record carries audit metadata: `source`, `source_provider`, `ingestion_batch_id` (UUID), `processing_version`.

See `backend/src/main/resources/schema.sql` for the full DDL.

## Testing

### Unit Tests

```bash
node --test test/sync.test.js        # 37 tests: args, modes, XML parser, zero-gap
```

Covers all sync logic branches without hitting SmartHub or the database.

### Live Smoke Test

```bash
npm run test:live                    # hits real SmartHub, verifies all selectors
```

Verifies login flow, Green Button page, modal dialog, form fields, and download. Run this when you suspect SmartHub changed their UI.

### Java Backend Tests

```bash
cd backend && mvn test               # unit tests (live tests excluded by default)
```

## Project Structure

```
home-automation/
├── README.md
├── .env.example                     # Template — copy to .env and fill in
├── .env                             # Your secrets (gitignored)
├── docker-compose.yml               # 4 services: postgres, redis, backend, nginx
├── package.json                     # Node deps + scripts (sync, test:live)
│
├── backend/                         # Spring Boot REST API
│   ├── Dockerfile                   # Lightweight JRE image (~300MB)
│   ├── pom.xml                      # spring-boot-web, jpa, postgresql, redis
│   └── src/main/
│       ├── java/com/homeplatform/
│       │   ├── HomePlatformApplication.java
│       │   ├── config/              # CORS, Jackson
│       │   ├── model/               # JPA entities (5 tables)
│       │   ├── repository/          # Spring Data repos
│       │   ├── service/             # Business logic
│       │   └── controller/          # REST endpoints
│       └── resources/
│           ├── application.yml      # Spring config
│           └── schema.sql           # PostgreSQL DDL + seed data
│
├── nginx/                           # Reverse proxy
│   ├── Dockerfile                   # Multi-stage: React build + Nginx
│   └── default.conf                 # /api → backend, other → React SPA
│
├── frontend/                        # React dashboard
│   ├── Dockerfile                   # Dev server (not used in production)
│   └── src/
│       ├── App.tsx                  # Dashboard layout
│       ├── api/                     # Typed API client (axios)
│       ├── components/              # StatTile, UsageChart, etc.
│       └── types/                   # TypeScript interfaces
│
├── scripts/
│   └── sync.js                      # Standalone sync CLI (all modes)
│
├── test/
│   ├── coserv-live-test.js          # Live SmartHub smoke test
│   └── sync.test.js                 # Unit tests (37 assertions)
│
└── docs/
    └── development.md               # Detailed dev guide
```

## Future Phases

| Phase | Scope |
|-------|-------|
| 2 — Utility Integrations | Gas, water, solar providers; manual CSV import |
| 3 — Smart Home | Home Assistant, MQTT, Zigbee, sensors |
| 4 — Home Intelligence | Mortgage tracking, maintenance history, documents |
| AI Layer | "Why was my bill higher?", solar savings analysis |
