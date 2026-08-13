# Development Guide

## Prerequisites

- Docker 29+ and Docker Compose v5+
- Java 21+ (for local backend development outside Docker)
- Node 26+ and npm 11+ (for local frontend development outside Docker)
- Maven 3.9+ (for local builds)

## Quick Start

```bash
# Copy environment file and fill in values
cp .env.example .env

# Start all services
docker compose up

# Stop all services
docker compose down

# Rebuild after code changes
docker compose up --build
```

## Important Commands

### Stack Lifecycle

```bash
# Start all services in background
docker compose up -d

# Stop and remove stack
docker compose down

# Rebuild all services
docker compose up -d --build

# Force no-cache rebuild for web + API (use when UI looks stale)
docker compose down
docker compose build --no-cache nginx backend
docker compose up -d

# Service status
docker compose ps

# Tail logs
docker compose logs -f nginx backend postgres redis
```

### Frontend Workflow

```bash
cd frontend
npm install
npm run dev
npm run build
npm run test
```

### Backend Workflow

```bash
cd backend
mvn spring-boot:run
mvn package -DskipTests -B
```

### Sync Workflow

```bash
npx playwright install chromium
npm run sync
npm run sync -- --date 08/03/2026
npm run sync -- --dry-run
npm test
```

## Access URLs

| Service     | URL                              |
|-------------|----------------------------------|
| App (Nginx) | http://localhost                  |
| Backend API | http://localhost:8080/api/health  |
| Swagger UI  | http://localhost:8080/swagger-ui  |
| Frontend    | http://localhost:5173             |
| PostgreSQL  | localhost:5432                    |
| Redis       | localhost:6379                    |

## Local Development (without Docker)

### Backend

```bash
cd backend
mvn spring-boot:run
```

The backend starts on port 8080 with hot reload via Spring DevTools (when added).

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Vite dev server starts on port 5173 with HMR.

### Database

Start PostgreSQL and Redis via Docker:

```bash
docker compose up postgres redis -d
```

Then run the backend locally — it connects to the Docker-hosted database.

## Database Schema

The initial schema is in `backend/src/main/resources/schema.sql`. It is mounted as an init script for PostgreSQL and runs automatically on first container start. JPA is configured with `ddl-auto: validate` — entities must match the schema exactly.

## Data Sync (CoServ SmartHub)

Sync pulls energy usage data from CoServ and stores it in PostgreSQL. There are two data sources:

| Script | Source | Granularity | Table |
|--------|--------|-------------|-------|
| `scripts/sync.js` | Green Button Download (XML ZIP) | 1 record/day | `electric_usage` |
| `scripts/sync-hourly.js` | Average Usage API (Bearer token) | 24 records/day | `hourly_electric_usage` |

Both are standalone Node.js CLIs. In production they're driven by in-process schedulers (`DailySyncScheduler` / `HourlySyncScheduler`) that retry every 30 min until CoServ posts the data.

```bash
# Install Playwright browser (one-time)
npx playwright install chromium

# Daily sync (Green Button)
npm run sync                          # yesterday
npm run sync -- --date 08/03/2026     # specific date
npm run sync -- --start 07/24/2026 --end 08/10/2026

# Hourly sync (Average Usage API)
node scripts/sync-hourly.js --date 08/03/2026
node scripts/sync-hourly.js --start 07/24/2026 --end 08/10/2026

# Dry run (no DB writes)
npm run sync -- --dry-run

# Verify SmartHub selectors still work (smoke test)
npm run test:live
```

Credentials are loaded from the `.env` file at the project root (same file used by Docker Compose, gitignored).

### Green Button Form Automation

The CoServ Green Button download dialog uses Angular Material components with specific automation quirks (see README for full details):

- Service / Interval / File Format are **native `<select>`** targeted by `select[aria-label="..."]`.
- Date fields are `mat-datepicker-input` targeted by stable `aria-labelledby` (`start-date-label` / `end-date-label`), NOT by their dynamically-generated `mat-input-N` id.
- Press **Enter** (not Escape) after typing a date to accept it.

### Manual Sync (Debug Dashboard)

The Debug Dashboard has manual trigger buttons that POST to `/api/admin/sync/daily`, `/api/admin/sync/hourly`, and `/api/admin/sync/alerts` — useful for backfilling or testing without waiting for the scheduler.
