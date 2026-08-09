# Home Automation Platform

Self-hosted home intelligence platform running on Docker Compose. Phase 1 integrates with CoServ SmartHub to track energy usage, visualize consumption patterns, and estimate bills. Includes role-based access control (RBAC), WiFi guest portal with QR codes, light/dark theming, and admin dashboards.

Built and maintained under the bryzncode mark.

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
- **Database is append-only.** Usage rows are never updated or deleted. Every record carries batch UUIDs for traceability.
- **Tab storage is isolated.** Electric, gas, water, and Roomba data live in separate tables. Weather is the only shared enrichment dataset.
- **Compatibility view** `energy_usage` keeps the current API contract stable while electric and gas persist into dedicated tables underneath.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, TypeScript, Vite, Tailwind CSS v4, React Query, Recharts, qrcode |
| Backend | Java 21, Spring Boot 3.4, Hibernate/JPA, PostgreSQL, jjwt |
| Cache | Redis 7 |
| Sync | Node.js, Playwright (headless Chromium), adm-zip, pg |
| Infra | Docker Compose, Nginx reverse proxy |
| Portal | CoServ SmartHub by NISC (Angular Material SPA) |
| Data format | Green Button (NAESB ESPI XML standard) |
| Testing | Vitest + Testing Library (frontend), JUnit 5 + H2 (backend) |

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

## Important Commands

### Docker Stack

```bash
# Start stack in background
docker compose up -d

# Stop and remove containers/network
docker compose down

# Rebuild all services after code changes
docker compose up -d --build

# Force fresh frontend/backend images (fixes stale UI bundles)
docker compose down
docker compose build --no-cache nginx backend
docker compose up -d

# Check running services
docker compose ps

# Follow service logs
docker compose logs -f nginx backend postgres redis
```

### Frontend Commands

```bash
cd frontend

# Local dev server with HMR
npm run dev

# Production build validation
npm run build

# Frontend tests
npm run test
```

### Backend Commands

```bash
cd backend

# Run backend locally
mvn spring-boot:run

# Build backend jar (skip tests)
mvn package -DskipTests -B
```

### Data Sync Commands

```bash
# Install browser once for sync automation
npx playwright install chromium

# ── Daily sync (Green Button, once per day) ──
npm run sync -- --date 08/07/2026       # single date
npm run sync -- --start 07/24/2026 --end 08/07/2026  # date range
npm run sync -- --dry-run               # preview without DB writes

# ── Hourly sync (Average Usage API, 24 readings/day) ──
node scripts/sync-hourly.js --date 08/07/2026
node scripts/sync-hourly.js --start 07/24/2026 --end 08/07/2026
node scripts/sync-hourly.js --dry-run    # preview without DB writes

# Local tests for sync logic
npm test
```

### Access URLs

| Service | URL |
|---------|-----|
| Dashboard | http://localhost |
| Vite Dev Server | http://localhost:5173 |
| Backend health | http://localhost/api/health |
| Swagger UI | http://localhost:8080/swagger-ui |
| PostgreSQL | localhost:5432 |

## Dashboard

The frontend is a single-page React app served by Nginx.

### Tabs

| Tab | Icon | Description |
|-----|------|-------------|
| Home | 🏠 | System snapshot, last daily reading, current weather, activity feed |
| Electric | ⚡ | Trend chart, monthly comparison, correlation chart (usage vs temperature), summary grid, usage log (daily/hourly) |
| Gas | 🔥 | Gas usage trend, monthly comparison, period summaries, weather context |
| Water | 💧 | Mock water usage prototype (Phase 2 integration) |
| Roomba | 🤖 | Mock device telemetry + floor map (Phase 3 integration) |
| WiFi | 📶 | QR code guest portal, network details, connected guests |

### Features

- **Light/Dark theme** — CSS custom properties with `ThemeContext`, persisted to localStorage, follows OS preference. Toggle in the header nav bar.
- **Stat tiles** — Last daily reading (kWh + date), 60-day total, 7-day/30-day daily averages (kWh/day)
- **Usage vs Temperature correlation chart** — Dual-axis combo chart with time-range filters (24h, 3 Days, 7 Days, Monthly, All Time). kWh line + temperature line with auto-scaled integer Y-axes. Hourly data granularity for 24h/3d/7d. Completeness filter: only shows data points where both electric AND temperature are available.
- **Daily Usage trend** — Recharts line chart aggregated from hourly records, dynamic Y-axis
- **Monthly Comparison** — Recharts bar chart grouped by month
- **Usage log with filters** — Daily/Hourly toggle. Daily: one row per date with low/avg/high temps. Hourly: color-coded kWh badges (green <2, yellow 2-4, red 5+ kWh) with matching hourly temp.
- **Weather integration** — Open-Meteo weather data proxied through backend, cached in `weather_observations` table. Home page shows current conditions with day/night-aware emoji (☀️ daytime, 🌙 nighttime). Weather context cards on Gas/Water tabs.
- **Hourly electric sync** — `npm run sync-hourly` pulls 24 readings/day from CoServ's Average Usage API (`/services/secured/averageUsage`). Stored in dedicated `hourly_electric_usage` table.
- **Separate storage** — `electric_usage` (daily Green Button) and `hourly_electric_usage` (hourly Average Usage) are separate tables, unioned in the `energy_usage` view. Prevents double-counting in charts.
- **Loading/empty/error states** on all components
- Responsive layout (1-col mobile, 2-col/3-col desktop)
- **Performance** — `content-visibility: auto`, IntersectionObserver deferred rendering, virtualized lists

### Estimated Bill

The estimated bill multiplies your monthly kWh total by `KWH_RATE` from `.env`. Green Button does not include pricing data, so this is a configuration-driven estimate.

To match your actual CoServ bill, adjust `KWH_RATE` in `.env`:
```
KWH_RATE=0.1171   # $0.1171/kWh
```
Then run `docker compose restart backend` to pick up the change.

## WiFi & Guest Access

The WiFi tab (`/wifi`) provides a guest portal with QR code scanning.

### Guest Flow

1. **QR Code** — displayed on the WiFi tab, encodes the guest portal URL (`{origin}/guest`)
2. **Guest scans** — opens `/guest` in their browser
3. **Enter name** — submits to `POST /api/auth/guest-login`, creates a GUEST account with 30-day expiry
4. **Connected** — guest session is tracked in real time

### Admin View

Admins see a "Connected Guests" panel on the WiFi tab showing:
- Guest name, online indicator
- Visits count (lifetime connections — find-or-reuse)
- Live kick-off countdown timer
- Connection time, device info

The guest login backend finds existing guests by display name and increments their connection count, so returning visitors (house sitters, contractors) are tracked across visits.

## Authentication & RBAC

Role-based access control with three tiers.

### Roles

| Role | Access |
|------|--------|
| **ADMIN** | Full access: all dashboards + User Management, Guest Management, Audit Logs |
| **USER** | All dashboards (same as admin). No admin panels. |
| **GUEST** | Temporary. Auto-expires after 30 days. Limited dashboard access. |

### Account Lifecycle

```
User Signs Up  →  PENDING_APPROVAL  →  Admin approves + assigns role  →  ACTIVE
                                        Admin denies  →  deleted

ACTIVE  →  Admin disables  →  DISABLED  →  Admin reactivates  →  ACTIVE
GUEST   →  30 days pass    →  EXPIRED
```

- **Self-registration** at `/register` — email + username + password. Enters `PENDING_APPROVAL`.
- **Guest accounts** are not self-registerable — created via `/guest` name-based login or by admin.
- **Admin seed** — a default admin is created on first backend startup (configurable via `ADMIN_USERNAME`/`ADMIN_PASSWORD` env vars).

### Auth Endpoints

```
POST /api/auth/register      # Self-registration (→ PENDING_APPROVAL)
POST /api/auth/login         # Sign in (ACTIVE only)
POST /api/auth/guest-login   # Guest sign-in (auto-ACTIVE, 30-day expiry)
GET  /api/auth/me            # Current user from JWT
POST /api/auth/heartbeat     # Session keep-alive
```

### Admin Endpoints

```
GET   /api/admin/users                 # All users
GET   /api/admin/users/pending         # Pending approval queue
POST  /api/admin/users/{id}/approve    # Approve + assign role
POST  /api/admin/users/{id}/deny       # Deny + delete
PUT   /api/admin/users/{id}/role       # Change role
POST  /api/admin/users/{id}/disable    # Disable account
POST  /api/admin/users/{id}/reactivate # Reactivate account
GET   /api/admin/guest-sessions        # Active guest sessions
POST  /api/admin/guest-sessions/expire # Manually expire all
GET   /api/admin/stats                 # Active guests + pending count
```

### Admin Pages

| Page | Route | Description |
|------|-------|-------------|
| User Management | `/admin/users` | Approve/deny registrations, assign roles, disable/reactivate |
| Guest Management | `/admin/guests` | Live guest session table, manual expiry |
| Audit Logs | `/admin/logs` | Activity feed: logins, registrations, approvals, guest joins |

Admin tabs appear in the nav bar only for ADMIN users, with amber accent styling to visually distinguish them.

### Security

- **JWT-based** — HMAC-SHA256, 24-hour expiry. Token stored in localStorage.
- **Filter** — `JwtAuthFilter` authenticates all `/api/*` routes except login/register/guest-login/health.
- **Route guards** — `ProtectedRoute` redirects to `/login`; `AdminRoute` redirects to `/`.
- **Passwords** — SHA-256 hashed with random 16-byte salt.

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
| `JWT_SECRET` | — | JWT signing key (256-bit minimum) |
| `ADMIN_USERNAME` | `bryzncode` | Seed admin username |
| `ADMIN_PASSWORD` | `bryzncode` | Seed admin password |
| `ADMIN_EMAIL` | `bryznnguyen@gmail.com` | Seed admin email |
| `ADMIN_DISPLAY_NAME` | `Bryan` | Seed admin display name |

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
GET /api/energy-usage/meter/{id}/summary?start=...&end=...
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

### Weather

```
GET /api/weather/current
→ { latitude, longitude, current: { temperature, humidity, weatherCode, ... }, ... }

GET /api/weather/range?start=2026-08-01&end=2026-08-07
→ { latitude, longitude, daily: [...], hourly: [...], aggregation: { avgTemp, minTemp, maxTemp, hdd, precip } }
```

Weather data is fetched from Open-Meteo (no API key), cached in `weather_observations` (PostgreSQL), and enriched with Fahrenheit/inches units and America/Chicago timezone.

## Data Sync

Sync pulls energy usage data from CoServ SmartHub. Two sync scripts are available:

### Daily Sync (`sync.js` — Green Button)
Downloads daily usage totals via the Green Button Download feature (XML format). One record per day per service.

### Hourly Sync (`sync-hourly.js` — Average Usage API)
Calls `POST /services/secured/averageUsage` with a captured JWT Bearer token, extracting 24 hourly kWh readings per day. Stores in `hourly_electric_usage` table. Requires a single browser login to capture the auth token, then calls the API directly for each date.

Both scripts are standalone Node.js CLIs — they do not run inside Docker.

### How It Works

1. Playwright opens headless Chromium, logs into SmartHub
2. Navigates to Usage Management → Green Button
3. Opens the "Green Button Download" modal dialog
4. For each service (Electric + Natural Gas):
   - Selects service, sets interval to **Daily**, format to **Green Button (XML)**
   - Sets the date range, clicks Download
   - Receives a ZIP file containing NAESB ESPI XML
5. Parses `IntervalBlock/IntervalReading` entries into kWh values
6. Inserts records into the dedicated utility table with `ON CONFLICT DO NOTHING` (idempotent)
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

**Note:** Utility data typically lags 1–2 days. A sync for "yesterday" may return `0 kWh` if CoServ hasn't posted the data yet. Re-running `--date` for that day later will populate the actual values.

## Database Schema

Module-oriented data model designed for long-term retention without mixing tab data.

| Table | Purpose | Key columns |
|-------|---------|-------------|
| `users` | Auth & RBAC | email, username, password_hash, role (ADMIN/USER/GUEST), status (PENDING_APPROVAL/ACTIVE/DISABLED/EXPIRED), connection_count |
| `guest_sessions` | Guest session tracking | user_id, ip_address, user_agent, connected_at, expires_at, status |
| `utility_providers` | Utility companies | name, type, portal_url |
| `utility_accounts` | Accounts per provider | account_number, service_address, status |
| `meters` | Physical meters | meter_number, type, location |
| `electric_usage` | Electric tab records | meter_id, timestamp, usage_kwh, ingestion_batch_id |
| `gas_usage` | Gas tab records | meter_id, timestamp, usage_kwh, ingestion_batch_id |
| `water_usage` | Water tab records | timestamp, usage_gallons, ingestion_batch_id |
| `roomba_runs` | Roomba tab records | started_at, duration_minutes, status |
| `weather_observations` | Shared electric/gas enrichment | observation_date, station_code, avg_temp_f |
| `energy_usage` | Read-only compatibility view over electric + gas | id, meter_id, timestamp, usage_kwh |
| `utility_bills` | Append-only bill records | billing_period, amount, status, ingestion_batch_id |

Every ingested record carries audit metadata: `source`, `source_provider`, `ingestion_batch_id` (UUID), `processing_version`.

See `backend/src/main/resources/schema.sql` for the full DDL.

## Testing

### Backend Tests

```bash
cd backend && mvn test
```

**36 tests** across 2 test files:
- `JwtUtilTest` — 12 tests: token generation, validation, expiry, claims extraction, tamper detection
- `UserServiceTest` — 24 tests: registration, login (success/failure/pending/disabled), guest login (find-or-reuse, connection count, session creation, expiry, reactivation), approval workflow (approve/deny/list), disable/reactivate, role management, guest session management

Runs against H2 in-memory database. PostgreSQL-specific migrations are excluded via `@Profile("!test")`.

### Frontend Tests

```bash
cd frontend && npm run test
```

**16 tests** across 3 test files (Vitest + Testing Library):
- `AuthContext.test.tsx` — 7 tests: initial state, login, localStorage persistence, logout, role detection (ADMIN/USER/GUEST), axios interceptor
- `Guards.test.tsx` — 4 tests: ProtectedRoute loading/redirect, AdminRoute redirect
- `Login.test.tsx` — 5 tests: form rendering, register/guest links, API call on submit, error display

### Root Tests

```bash
node --test test/sync.test.js        # 37 tests: args, modes, XML parser, zero-gap
npm run test:live                    # hits real SmartHub, verifies all selectors
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
│   ├── pom.xml                      # spring-boot-web, jpa, postgresql, redis, jjwt, h2
│   └── src/
│       ├── main/java/com/homeplatform/
│       │   ├── HomePlatformApplication.java
│       │   ├── config/              # CORS, Jackson, DataSeeder, UsageStorageMigration
│       │   ├── controller/          # Health, Config, Meter, EnergyUsage, Auth, Admin
│       │   ├── dto/                 # Request/response records
│       │   ├── model/               # JPA entities (User, GuestSession, EnergyUsage, etc.)
│       │   ├── repository/          # Spring Data repos
│       │   ├── security/            # JwtUtil, JwtAuthFilter, SecurityConfig
│       │   └── service/             # UserService, EnergyUsageService, etc.
│       ├── main/resources/
│       │   ├── application.yml      # Spring config
│       │   └── schema.sql           # PostgreSQL DDL + seed data
│       └── test/                    # JUnit 5 + H2 tests
│
├── nginx/                           # Reverse proxy
│   ├── Dockerfile                   # Multi-stage: React build + Nginx
│   └── default.conf                 # /api → backend, other → React SPA
│
├── frontend/                        # React dashboard
│   ├── vite.config.ts               # Vite + Tailwind + Vitest config
│   └── src/
│       ├── main.tsx                 # Root: providers, router, lazy routes
│       ├── App.tsx                  # Dashboard shell: header, nav, theme toggle, auth
│       ├── context/
│       │   ├── ThemeContext.tsx      # Light/dark theme provider
│       │   └── AuthContext.tsx       # JWT auth provider
│       ├── components/
│       │   ├── Guard.tsx            # ProtectedRoute, AdminRoute
│       │   ├── StatTile.tsx         # KPI card
│       │   ├── UsageChart.tsx       # Recharts line chart
│       │   ├── MonthlyComparison.tsx # Recharts bar chart
│       │   ├── UsageSummaryGrid.tsx  # Period summary grid
│       │   ├── VirtualizedList.tsx   # Windowing list
│       │   ├── DeferredRender.tsx    # IntersectionObserver lazy render
│       │   └── IntegrationPanel.tsx  # CoServ sync panel
│       ├── pages/
│       │   ├── HomeSummary.tsx       # Home dashboard
│       │   ├── ElectricalUsage.tsx   # Electric tab
│       │   ├── GasUsage.tsx          # Gas tab
│       │   ├── WaterUsage.tsx        # Water tab
│       │   ├── Roomba.tsx            # Roomba tab
│       │   ├── WiFiPage.tsx          # WiFi + QR + guest list
│       │   ├── Login.tsx             # Sign in
│       │   ├── Register.tsx          # Self-registration
│       │   ├── GuestLogin.tsx        # Guest name-based entry
│       │   └── admin/
│       │       ├── UserManagement.tsx # Approve/deny/role/disable
│       │       ├── GuestManagement.tsx# Session table + expiry
│       │       └── AuditLogs.tsx      # Activity feed
│       ├── api/                     # Typed API client (axios, auth.ts, energy.ts, meters.ts)
│       ├── hooks/                   # useUsageData, useDeferredMount
│       ├── utils/                   # usageColor, usageSummary
│       ├── types/                   # TypeScript interfaces
│       └── test/                    # Vitest + Testing Library tests
│
├── scripts/
│   └── sync.js                      # Standalone sync CLI (all modes)
│
├── test/
│   ├── coserv-live-test.js          # Live SmartHub smoke test
│   └── sync.test.js                 # Unit tests (37 assertions)
│
├── docs/
│   └── development.md               # Detailed dev guide
│
└── green-button-downloads/          # Downloaded ZIP/XML (gitignored)
```

## Future Phases

| Phase | Scope |
|-------|-------|
| 2 — Utility Integrations | Gas, water, solar providers; manual CSV import |
| 3 — Smart Home | Home Assistant, MQTT, Zigbee, sensors |
| 4 — Home Intelligence | Mortgage tracking, maintenance history, documents |
| AI Layer | "Why was my bill higher?", solar savings analysis |
