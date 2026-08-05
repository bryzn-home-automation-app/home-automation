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

## CoServ Integration

The CoServ adapter uses Playwright for browser automation. When running locally (not in Docker), install Playwright browsers:

```bash
npx playwright install chromium
```

In Docker, the backend container includes Playwright and a headless Chromium.
