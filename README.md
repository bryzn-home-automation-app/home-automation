# Home Automation Platform

Self-hosted home intelligence platform running on Docker Compose. Phase 1 integrates with CoServ SmartHub to track energy usage, visualize consumption patterns, and estimate bills. Includes role-based access control (RBAC), WiFi guest portal with QR codes, light/dark theming, admin dashboards, an in-process hourly sync scheduler, and diagnostic event logging.

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
- **Compatibility view** `energy_usage` keeps the current API contract stable while electric, gas, and hourly electric persist into dedicated tables underneath.
- **Deploy scripts** handle git pull, commit hash injection, Docker rebuild, and health checks — via `deploy.sh` (bash) or `deploy-nuc.cmd` (Windows cmd).
- **Hourly sync scheduler** (`HourlySyncScheduler`) runs in-process (Spring `@Scheduled`) every 30 min from 6:15–11:45 PM CT, backfilling yesterday's hourly data until it reaches 24 records.
- **Daily sync scheduler** (`DailySyncScheduler`) runs Green Button daily sync every 30 min from 6:30–11:30 PM CT, writing to `electric_usage` for reconciliation against the hourly table, retrying until the daily reading posts.
- **Alert engine** (`AlertEngine`) scans live usage data after each sync to generate real ELECTRICAL notifications (daily report, usage spike, peak hour, monthly bill estimate) with deduplication.
- **Diagnostic event feed** (`AppEventService`) logs startup, sync, weather, and migration events to the `app_events` table, visible in the Debug Dashboard for operational visibility.
- **Responsive mobile layout** — hamburger sidebar overlay, fixed bottom nav bar, adaptive data tables (3 cols mobile / 5 cols desktop), and responsive text sizing from 375px to 1536px+.

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

## Deployment

Two deploy scripts are provided — one for Linux/Mac/Git Bash, one for Windows cmd.exe. Both automate the full deploy cycle: pull → resolve commit hash → rebuild images → restart stack → health check.

### Linux / Mac / Git Bash (`deploy.sh`)

```bash
./deploy.sh
```

Does the following:
1. `git pull origin master` (skipped if no `.git` directory — falls back to `.git-commit` file)
2. Resolves the current commit hash via `git rev-parse --short HEAD` (or reads `.git-commit`)
3. Exports `GIT_COMMIT` so `docker compose` picks it up as a build arg + runtime env var
4. Runs `docker compose build --no-cache backend nginx`
5. Runs `docker compose up -d`
6. Polls `/api/health` for up to 2 minutes, reports UP/not

### Windows cmd.exe (`deploy-nuc.cmd`)

```cmd
deploy-nuc.cmd
```

Same flow as `deploy.sh`, adapted for cmd.exe:
1. `git pull origin master`
2. `for /f … git rev-parse --short HEAD` → `GIT_COMMIT` env var
3. `docker compose build backend nginx`
4. `docker compose up -d`
5. `docker compose ps`

### Git Commit Tracking

The deployed version is tracked end-to-end:

| Layer | Mechanism |
|-------|-----------|
| Shell | `GIT_COMMIT` env var (set by deploy script) |
| Docker build | `docker-compose.yml` build `args: GIT_COMMIT: ${GIT_COMMIT:-unknown}` |
| Docker runtime | `docker-compose.yml` environment `GIT_COMMIT: ${GIT_COMMIT:-unknown}` |
| Build-time file | Dockerfile writes `$GIT_COMMIT` → `/app/git-commit.txt` |
| Committed file | `.git-commit` file in repo root — fallback when `.git` is absent |
| Java fallback | `GIT_COMMIT` env → `/app/.git-commit` → `/app/git-commit.txt` → `"unknown"` |

The commit hash appears in:
- `GET /api/config` → `"version": "7828631"`
- Debug Dashboard header
- Backend startup log events (`AppEventService`)
- Java log output (`Starting up (commit=7828631)`)

**Deployments without a `.git` directory** (file-copy setups like the NUC): the `.git-commit` file committed to the repo acts as the source of truth. Run `scripts/update-commit.sh` on a dev machine before committing to keep it in sync.

## Important Commands

### Docker Stack

```bash
# One-command deploy (Linux/Mac/Git Bash) — pull + rebuild + restart
./deploy.sh

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

On Windows cmd.exe:
```cmd
deploy-nuc.cmd
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

# Debug Dashboard (ADMIN only)
GET   /api/admin/events?hours=&category=&level=&limit=  # Diagnostic event feed
GET   /api/admin/events/summary                          # 24h event counts
GET   /api/admin/health                                  # DB/JVM/thread health
GET   /api/admin/db/tables                               # Table list with sizes
GET   /api/admin/db/stats                                # Row counts + DB size
POST  /api/admin/db/query  { "query": "SELECT ..." }     # Read-only SQL console
```

### Admin Pages

| Page | Route | Description |
|------|-------|-------------|
| User Management | `/users` | Approve/deny registrations, assign roles, disable/reactivate |
| Guest Management | `/admin/guests` | Live guest session table, manual expiry |
| Debug | `/admin/debug` | System health (DB/uptime/heap/threads), event feed with category/level filters, DB Explorer with table presets and SQL console, sync history |
| Audit Logs | `/admin/logs` | Activity feed: logins, registrations, approvals, guest joins |

Admin tabs appear in the nav bar only for ADMIN users, with amber accent styling to visually distinguish them.

### App Events System

A diagnostic event log (`app_events` table) records system operations for operational visibility:

| Category | Sources | Examples |
|----------|---------|----------|
| `system` | `DataSeeder`, `UsageStorageMigration` | Backend startup, commit version, table migrations |
| `sync` | `HourlySyncScheduler` | Sync started/completed/failed, output summary |
| `weather` | `WeatherService` | API fetches, cache hits, temperature data stored |

Each event has a level (INFO/WARN/ERROR), timestamp, message, and optional details. The Debug Dashboard event feed queries `GET /api/admin/events` with filters for category, level, and time range. A 24-hour summary (`GET /api/admin/events/summary`) shows counts by level.

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
| `PROPERTY_LATITUDE` | — | Latitude for weather (Open-Meteo location) |
| `PROPERTY_LONGITUDE` | — | Longitude for weather (Open-Meteo location) |
| `GIT_COMMIT` | `unknown` | Git commit hash — set automatically by deploy scripts, injected at build + runtime |

## API Endpoints

### Health

```
GET /api/health
→ { "status": "UP", "database": "connected", "timestamp": "..." }
```

### Config

```
GET /api/config
→ { "kwhRate": 0.1171, "dataStartDate": "07/24/2026", "version": "7828631", "propertyLatitude": 33.0566, "propertyLongitude": -96.9033, "lastElectricReading": "2026-08-09T23:00:00-05:00", "lastSyncCheck": "2026-08-10T21:15:00-05:00" }
```

The `version` field is the deployed git commit hash (short SHA). `lastElectricReading` and `lastSyncCheck` are the most recent timestamps from the database, useful for verifying data freshness.

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

Two in-process schedulers run automatically — no external cron needed.

| Scheduler | Cron | Purpose | Retry |
|-----------|------|---------|-------|
| `DailySyncScheduler` | Every 30 min on `:00`/`:30`, 6:30 AM–11:30 PM CT | Green Button daily totals → `electric_usage` | Skips once yesterday has a non-zero daily reading |
| `HourlySyncScheduler` | Every 30 min on `:15`/`:45`, 6:15 AM–11:45 PM CT | Average Usage API hourly → `hourly_electric_usage` | Skips once yesterday has 24 records |

Both run via Spring `@Scheduled` (see `DailySyncScheduler.java` and `HourlySyncScheduler.java`).

**Idempotency & retry:**
- The **daily** sync checks `electric_usage` for yesterday. If a non-zero reading already exists, it skips. CoServ posts daily data slower than hourly, so it retries every 30 min from 6:30 AM until the reading arrives.
- The **hourly** sync counts records in `hourly_electric_usage` for yesterday. It only skips when there are **24 records**. Partial days (e.g. 5 records at 6:15 AM) log a WARNING and retry 30 min later until all 24 hours are posted.

**Note:** Utility data typically lags. A "partial" sync result is not a failure — it means CoServ hasn't finished posting the day's data yet; the 30-min retry loop picks up the rest.

### Manual Sync (Debug Dashboard)

The Debug Dashboard (`/admin/debug`) has a **Manual Triggers** section with three buttons:

- **⚡ Daily Sync** — triggers `DailySyncScheduler` immediately
- **🕐 Hourly Sync** — triggers `HourlySyncScheduler` immediately
- **🔔 Generate Alerts** — runs `AlertEngine` against current data

These POST to `/api/admin/sync/daily`, `/api/admin/sync/hourly`, and `/api/admin/sync/alerts` respectively.

### Green Button Form Automation (important for maintainers)

The CoServ Green Button download dialog uses **Angular Material** components that are non-obvious to automate:

- **Service / Interval / File Format** dropdowns are **native `<select>` elements** (not mat-select divs). They are targeted by `select[aria-label="..."]` with `{ label: ... }`.
- **Start/End Date** fields are `mat-datepicker-input` elements. Their `id` (`mat-input-N`) is **dynamically generated** and shifts between sessions — target by the **stable `aria-labelledby`** (`start-date-label` / `end-date-label`) instead.
- After typing a date, press **Enter** (not Escape) to accept the value — Escape can close the dialog.

The `adm-zip` Node module (for parsing the downloaded ZIP) is baked into the backend Docker image via the Dockerfile.

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

**83 tests** across 7 test files:
- `AlertEngineTest` — 8 tests: daily report generation, usage spike detection (30% threshold), peak hour detection (≥5 kWh), dedup logic, error handling, empty data skipping
- `AppEventServiceTest` — 11 tests: logging at all levels (INFO/WARN/ERROR), getRecent with category/level filters, cleanup
- `EnergyUsageServiceTest` — 5 tests: getSummary aggregation with high/low points, empty data fallbacks, date ranges
- `NotificationServiceTest` — 11 tests: CRUD, filtering by category/severity/unread, mark read/all, limit capping
- `JwtUtilTest` — 9 tests: token generation, validation, expiry, claims extraction, tamper detection
- `UserServiceTest` — 24 tests: registration, login, guest login, approval, disable/reactivate, role management, guest sessions
- `WeatherServiceTest` — 15 tests: forecast fetch, archive, error handling, aggregation, current weather

Backend tests use JUnit 5 + Mockito (unit) or `@SpringBootTest` with H2 in-memory database (integration). PostgreSQL-specific migrations and schedulers are excluded via `@Profile("!test")`.

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
├── .git-commit                      # Deployed git commit hash (fallback when .git absent)
├── docker-compose.yml               # 4 services: postgres, redis, backend, nginx
├── deploy.sh                        # Linux/Mac/Git Bash deploy script
├── deploy-nuc.cmd                   # Windows cmd.exe deploy script
├── package.json                     # Node deps + scripts (sync, test:live)
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
│   ├── sync.js                      # Standalone daily sync CLI (all modes)
│   ├── sync-hourly.js               # Hourly electric sync (Average Usage API)
│   ├── update-commit.sh             # Refresh .git-commit from git rev-parse
│   └── extract-guest-animals.js     # Guest analytics utility
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
