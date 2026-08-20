# BUILD_CONTRACT — Roomba tab integration

Shared contract for the parallel build. Field mapping / data sources: see `FINDINGS.md`
in this folder. Robot is a Roomba 105 Combo (SKU `G284020`), V4/"Prime" **cloud** protocol,
integrated via `roombapy-prime` (beta). Pattern mirrors CoServ: a standalone poller writes
directly to Postgres (append-only); backend is read-only REST; frontend queries the API.

## Data flow
```
iRobot cloud ──roombapy-prime──> roomba-poller (Python) ──writes──> Postgres
                                                                      │
                                   backend (Spring, read-only REST) ──┘
                                                                      │
                                        frontend Roomba.tsx ──GET /api/roomba/*
```
Backend NEVER talks to iRobot. Only the poller holds iRobot creds. Cloud connection does
NOT conflict with the user's iRobot app (unlike local MQTT).

## DB schema (Agent A owns schema.sql; Agent B must match column names exactly)

Existing `roomba_runs` (poller INSERTs one row per completed mission):
`id, started_at, completed_at, duration_minutes, dirt_events, square_feet, status,
source, source_provider, ingestion_batch_id, processing_version, created_at`.
Poller sets `source='roombapy-prime'`, `source_provider='irobot'`, `ingestion_batch_id`=uuid,
`dirt_events`=NULL (no V4 source). `status` ∈ {COMPLETED, STUCK, CANCELLED}.

New `roomba_status` (poller UPSERTs latest snapshot, UNIQUE(robot_id)):
```
id SERIAL PK, robot_id VARCHAR(64) NOT NULL UNIQUE, name VARCHAR(120),
battery_pct INT, phase VARCHAR(40), cycle VARCHAR(40), error INT DEFAULT 0,
bin_present BOOLEAN, tank_present BOOLEAN, current_mission_id VARCHAR(64),
mission_start TIMESTAMP, sqft INT, runtime_minutes INT, dock_state INT,
lifetime_missions INT, lifetime_run_minutes INT, map_version VARCHAR(64),
raw JSONB, updated_at TIMESTAMP NOT NULL DEFAULT NOW()
```

New `roomba_map` (poller UPSERTs when map_version changes, UNIQUE(robot_id)):
```
id SERIAL PK, robot_id VARCHAR(64) NOT NULL UNIQUE, map_id VARCHAR(80),
map_version VARCHAR(64), name VARCHAR(120), geojson JSONB NOT NULL,
updated_at TIMESTAMP NOT NULL DEFAULT NOW()
```
`geojson` = the parsed bundle object `{manifest?, metadata?, rooms, borders, floorPlan, dockPose}`
(each of rooms/borders/floorPlan/dockPose is a GeoJSON FeatureCollection; coords in meters).

Agent A: add all three to `schema.sql`, add JPA entities matching EXACTLY (check
`application.yml` `ddl-auto` and existing `UsageStorageMigration.java` — ensure the tables
also get created on the already-running NUC DB, not just fresh init).

## REST API (Agent A owns; Agent C consumes). All under JwtAuthFilter (authenticated).

`GET /api/roomba/status` → 200 `RoombaStatusResponse`, or 204 if no row yet:
```json
{ "robotId","name","batteryPct","phase","cycle","error","running",
  "binPresent","tankPresent","currentMissionId","missionStart","sqft",
  "runtimeMinutes","dockState","lifetimeMissions","lifetimeRunMinutes",
  "mapVersion","online","updatedAt" }
```
`running` = phase in {run, evac, ...} (not charge/stop/idle). `online` = `updated_at` within
last 10 min. Timestamps ISO-8601 strings.

`GET /api/roomba/runs?limit=50` → 200 `RoombaRunResponse[]` (newest first):
```json
{ "id","startedAt","completedAt","durationMinutes","squareFeet","status","missionId" }
```

`GET /api/roomba/map` → 200 `RoombaMapResponse`, or 204 if none:
```json
{ "robotId","mapId","mapVersion","name","geojson","updatedAt" }
```
`geojson` passthrough of the stored JSON object (do not reshape).

Follow existing controller/service/DTO conventions (`EnergyUsageController`,
`AdminDebugController`, DTOs under `com.homeplatform.dto`).

## Poller env (Agent B): `IROBOT_EMAIL`, `IROBOT_PASSWORD`, `IROBOT_COUNTRY` (default US),
`IROBOT_ROBOT_BLID` (optional), `POLL_INTERVAL_SECONDS` (default 60), plus `POSTGRES_*`
(reuse the same names docker-compose already passes to backend). Fail-open, retry, no crash-loop.

## File ownership (NO cross-editing)
- **Agent A (backend):** `backend/src/main/resources/schema.sql`, `backend/src/main/java/com/homeplatform/**` (entities/repos/service/controller/dtos), backend tests. Nothing else.
- **Agent B (poller):** new `roomba-poller/**` (poller.py, Dockerfile, requirements.txt, README), `docker-compose.yml` (add `roomba-poller` service only), `.env.example` (append new vars). Do NOT touch schema.sql or Java.
- **Agent C (frontend):** `frontend/src/pages/Roomba.tsx` (rewrite, drop the mock), new `frontend/src/api/roomba.ts`, `frontend/src/types/**` additions, new map component under `frontend/src/components/**`. Do NOT touch backend or compose.

## v1 scope
Live status card + real run-history table + real floor-plan map (render rooms/borders/
floorPlan polygons + dock from GeoJSON). Live moving-dot (watch_live_map streaming) is a
FUTURE follow-up — not in v1. Handle empty states gracefully (no runs yet; 1 unnamed room;
no map). Remove the "Mock data" banner and the fake dirt-events chart.
```
