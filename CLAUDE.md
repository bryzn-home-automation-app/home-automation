# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Persistent memory

Deeper project memory — architecture decisions and why they were made, debugging history for
recurring issues, current-vs-planned implementation state, and session history — lives
outside this repo at `C:\Cluade Memory\projects\home-automation\` (see `MEMORY_GUIDE.md` in
that folder's parent for how the system works). Check it at the start of substantial tasks,
especially before re-investigating something that feels like it's been hit before (see
`ISSUES.md` there) or before assuming this `CLAUDE.md`/README are current (see
`CURRENT_STATE.md` there for known doc drift). Update it — not this file — when you learn
something project-durable; keep this `CLAUDE.md` itself limited to commands and the
highest-value architecture facts, since it's loaded into every session automatically.

## Overview

Self-hosted home intelligence platform on Docker Compose. Phase 1 (current) integrates
with CoServ SmartHub to track electric usage, visualize consumption vs. weather, and
estimate bills. Includes JWT auth with RBAC (ADMIN/USER/GUEST), a WiFi guest portal
with QR codes, and an admin Debug Dashboard with diagnostic event logging.

**`README.md` is comprehensive but drifts out of date** (e.g. it still describes the
superseded Green Button/Average-Usage sync scripts). Where README and this file
disagree on sync mechanics, trust this file and the code in `scripts/sync.js`.

## Architecture

```
postgres (5432) ← backend (Spring Boot, 8080) ← nginx (80) → React SPA (frontend/)
     ▲
     │ writes directly (no HTTP)
scripts/sync.js  ← standalone Node CLI, runs outside Docker, driven by Playwright
     │
CoServ SmartHub (NISC Angular Material portal)
```

- **Sync and dashboard are fully decoupled.** `scripts/sync.js` writes straight to
  Postgres; the backend is a read-only-ish REST API over that data; the frontend
  queries the API. The backend never talks to CoServ directly — it shells out to the
  sync script (see Scheduling below).
- **Database is append-only.** Usage rows are never updated/deleted; every ingested
  record carries `source`, `source_provider`, `ingestion_batch_id` (UUID) for
  traceability. Electric, gas, water, and Roomba data live in separate tables
  (`electric_usage`, `gas_usage`, `water_usage`, `roomba_runs`); `energy_usage` is a
  read-only compatibility view unioning electric + gas. Weather (`weather_observations`)
  is the one shared enrichment table.
  Full DDL: `backend/src/main/resources/schema.sql` (JPA is `ddl-auto: validate` —
  entities must match the schema exactly, no auto-migration).
- **Two in-process Spring schedulers** retry until CoServ finishes posting the day's
  data: `DailySyncScheduler` (every 30 min, 6:30 AM–11:30 PM CT, skips once yesterday
  has a non-zero `electric_usage` reading) and `HourlySyncScheduler` (every 30 min,
  6:15 AM–11:45 PM CT, skips once yesterday has 24 rows in `hourly_electric_usage`).
  A partial result (e.g. 5/24 hourly rows) is expected mid-day, not a failure.
- **`AlertEngine`** scans usage after each sync for daily report / usage spike (30%
  threshold) / peak hour (≥5 kWh) / monthly bill estimate notifications, with dedup.
- **`AppEventService`** logs startup/sync/weather/migration events to `app_events`,
  surfaced in the Debug Dashboard (`/admin/debug`) for operational visibility.
- **Git commit tracking end-to-end**: `deploy.sh`/`deploy-nuc.cmd` resolve the commit
  hash and pass it as `GIT_COMMIT` through the Docker build args + runtime env; the
  `.git-commit` file is the fallback when `.git` isn't present (e.g. file-copy deploys).
  Shows up in `GET /api/config` (`version`) and the Debug Dashboard header. Run
  `scripts/update-commit.sh` before committing if `.git-commit` drifts.

## Commands

### Docker stack
```bash
docker compose up -d                                      # start
docker compose down                                       # stop
docker compose logs -f nginx backend postgres redis        # tail logs
docker compose down && docker compose build --no-cache nginx backend && docker compose up -d
                                                            # force-fresh rebuild (stale UI bundle fix)
```

### Frontend (`cd frontend`)
```bash
npm run dev             # Vite dev server, HMR, :5173
npm run build           # tsc -b && vite build
npm run lint            # eslint .
npm run test            # vitest run
npm run test:watch      # vitest (watch mode)
npx vitest run src/test/AuthContext.test.tsx   # single file
npx vitest run -t "logs in and persists to localStorage"  # single test by name
```

### Backend (`cd backend`)
```bash
mvn spring-boot:run                 # local run, :8080 (needs postgres/redis — see below)
mvn package -DskipTests -B          # build jar
mvn test                            # full suite (JUnit 5 + H2, Postgres-specific
                                     #   migrations/schedulers excluded via @Profile("!test"))
mvn test -Dtest=UserServiceTest                       # single test class
mvn test -Dtest=UserServiceTest#approveGuestUser       # single test method
```
Local backend dev without full Docker stack: `docker compose up postgres redis -d`,
then `mvn spring-boot:run` connects to the Docker-hosted DB.

### Root-level sync tests
```bash
npm test              # test/sync.test.js + test/legacy/*.test.js — pure logic, no network/DB
npm run test:live     # test/coserv-live-test.js — hits real SmartHub, verifies selectors
```

## Deploy
- Deploy via the **`deploy-nuc`** alias (a bash script at `~/deploy-nuc` on the dev
  machine). It: (1) checks for uncommitted changes, (2) pushes `origin master`,
  (3) SSHs to the `nuc` host and runs `git pull origin master`, (4) triggers the
  `HomeAutomationDeploy` Windows scheduled task (`schtasks /run`) which runs the
  Docker build in the desktop session.
- **The working tree must be clean before running `deploy-nuc`** — it prompts to
  stage/commit dirty files, and a non-interactive run aborts on that prompt.
  Commit + push first, then deploy.
- Docker runs on the **NUC**, not the dev machine.

## CoServ sync
- Single entry point: `scripts/sync.js`. It drives the Usage Explorer endpoint:
  `POST https://coserv.smarthub.coop/services/secured/utility-usage/poll`
- Granularities (`--granularity daily|hourly|both`, default `both`):
  - `daily`  → `timeFrame: "DAILY"`  → 1 record/day  → `electric_usage`
  - `hourly` → `timeFrame: "HOURLY"` → 96 fifteen-min points/day, aggregated
    4×15-min → 1 hour → `hourly_electric_usage` (24 records/day)
- Legacy scripts (Green Button daily + averageUsage hourly) are in
  `scripts/legacy/`. Superseded — do not extend.
- Backend schedulers shell out to `node /scripts/sync.js --granularity daily|hourly
  --date <MM/dd/yyyy>` (scripts are bind-mounted read-only at `/scripts` in the
  backend container; the backend image installs node + playwright + pg globally so
  it can run the CLI without a separate service).
- Manual triggers: Debug Dashboard (`/admin/debug`) → POST `/api/admin/sync/daily`,
  `/api/admin/sync/hourly`, `/api/admin/sync/alerts` (runs `AlertEngine`).

### Auth (SmartHub)
- Log in once (headless Playwright) and capture the Bearer token plus the
  `x-nisc-smarthub-username` / `x-nisc-smarthub-customernumber` headers from any
  `/services/secured/` request. `x-nisc-smarthub-username` ≠ the login email —
  capture it, don't hardcode.
- The poll endpoint is async: the first POST returns `{"status":"PENDING"}`;
  re-POST the same payload after ~5s for `{"status":"COMPLETE","data":{...}}`.

### Timezone gotcha (easy to get wrong)
- Request `startDateTime` / `endDateTime` are **true-UTC** epoch ms. Use
  `ctDayBounds()` (America/Chicago) — exported from `scripts/sync.js`.
- Response `data.ELECTRIC[0].series[0].data[].x` is the **local wall-clock time
  naively encoded as UTC**. Recover the local timestamp by formatting `x` AS UTC
  (`new Date(x).toISOString()`). Never run `x` through an America/Chicago
  formatter and never hardcode a 5h/6h offset.

### Green Button form automation (legacy scripts only, `scripts/legacy/`)
- Service/Interval/File Format dropdowns are native `<select>` elements (not
  mat-select divs) — target via `select[aria-label="..."]`.
- Date fields are `mat-datepicker-input`; their `id` (`mat-input-N`) is dynamically
  generated and shifts between sessions — target by the stable `aria-labelledby`
  (`start-date-label` / `end-date-label`) instead. Press **Enter**, not Escape, to
  accept a typed date (Escape closes the dialog).

## Auth & RBAC (backend)
- JWT (HMAC-SHA256, 24h expiry), stored client-side in localStorage. `JwtAuthFilter`
  guards all `/api/*` except login/register/guest-login/health. Passwords are
  SHA-256 + random 16-byte salt (`UserService`).
- Roles: `ADMIN` (full + admin panels), `USER` (all dashboards, no admin), `GUEST`
  (30-day auto-expiry, created via `/guest` name-based login, not self-registerable).
  Self-registration (`/register`) lands in `PENDING_APPROVAL` until an admin approves
  and assigns a role.
- `LoginRateLimiter` throttles login attempts (see `backend/src/main/java/com/homeplatform/service/LoginRateLimiter.java`).

## Tests
- Backend: `cd backend && mvn test` — JUnit 5 + Mockito/`@SpringBootTest`+H2, one
  file per service under `backend/src/test/java/com/homeplatform/`.
- Frontend: `cd frontend && npm run test` — Vitest + Testing Library, files under
  `frontend/src/test/`.
- Root: `npm test` runs `test/sync.test.js` + `test/legacy/*.test.js` (pure logic, no
  network/DB). `npm run test:live` runs the live SmartHub smoke test — only run this
  deliberately, it hits the real portal.
