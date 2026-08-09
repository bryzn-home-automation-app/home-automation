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

Sync pulls energy usage data from CoServ via Green Button Download and stores it in PostgreSQL. The sync is a standalone Node.js script — it runs outside Docker.

```bash
# Install Playwright browser (one-time)
npx playwright install chromium

# Sync yesterday's usage
npm run sync

# Sync a specific date
npm run sync -- --date 08/03/2026

# Preview without writing to the database
npm run sync -- --dry-run

# Verify SmartHub selectors still work (smoke test)
npm run test:live
```

Credentials are loaded from the `.env` file at the project root (same file used by Docker Compose, gitignored).
