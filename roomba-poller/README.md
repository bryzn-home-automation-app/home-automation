# roomba-poller

Standalone Python service that reads a Roomba's iRobot **cloud** telemetry via
[`roombapy-prime`](https://github.com/johnnyh1975/roombapy-prime) and writes it
directly to Postgres. It mirrors the CoServ sync pattern: the poller is the only
component that holds iRobot credentials, and the Spring backend is a read-only
REST API over the tables this service writes.

The cloud connection does **not** conflict with the iRobot Home app (unlike the
old local MQTT protocol).

## What it does

Every `POLL_INTERVAL_SECONDS` (default 60) it:

1. Reads the `ro-currentstate` named shadow (live status) and `ro-stats`
   (lifetime counters).
2. **UPSERTs `roomba_status`** (one row, `UNIQUE(robot_id)`) — battery, phase,
   cycle, error, bin/tank presence, current mission, sqft, runtime, dock state,
   lifetime totals, map version, and the full `ro-currentstate` reported object
   in `raw` (JSONB).
3. **Detects mission completion** and **INSERTs one `roomba_runs` row** per
   mission (see dedup below).
4. **Refreshes `roomba_map`** (`UNIQUE(robot_id)`) whenever the active map
   version changes — downloads and parses the GeoJSON map bundle.

### Mission completion + dedup

A mission is "running" while its `cleanMissionStatus.phase` is anything other
than `charge` / `stop` / `hmPostMsn` and a `missionId` is present. A run is
recorded when the phase transitions from running to one of those terminal
phases, or when the `missionId` changes (previous mission finished unseen).

`status` is derived: `error != 0` → `STUCK`; terminal phase `stop` → `CANCELLED`;
otherwise `COMPLETED`.

Dedup is two-layered so re-polls and process restarts never double-insert:

- **In-process:** a set of already-recorded `missionId`s.
- **Cross-restart:** `roomba_runs` has no `missionId` column, so `started_at`
  (= the mission's `mssnStrtTm`) is the stable per-mission marker. Before
  inserting, the poller checks `SELECT 1 FROM roomba_runs WHERE
  source = 'roombapy-prime' AND started_at = <mission start>`.

## Robustness

Fail-open. Any cloud or DB error in a cycle is logged and swallowed; the loop
never crash-loops. Connection loss disconnects and reconnects on the next cycle.
Logs go to stdout (`docker compose logs -f roomba-poller`).

## Environment variables

| Var | Required | Default | Notes |
|---|---|---|---|
| `IROBOT_EMAIL` | yes | — | iRobot Home app account email |
| `IROBOT_PASSWORD` | yes | — | iRobot Home app account password |
| `IROBOT_COUNTRY` | no | `US` | ISO country code for the login |
| `IROBOT_ROBOT_BLID` | no | — | Pin a specific robot; omit to auto-select |
| `POLL_INTERVAL_SECONDS` | no | `60` | Poll cadence (min 5) |
| `POSTGRES_HOST` | no | `postgres` | Compose service name |
| `POSTGRES_PORT` | no | `5432` | |
| `POSTGRES_DB` | no | `homeplatform` | |
| `POSTGRES_USER` | no | `homeplatform` | |
| `POSTGRES_PASSWORD` | yes | — | Same value the backend receives |

Credentials come from the environment only — never commit them to a file.

## Run

### Via Docker Compose (normal path)

The `roomba-poller` service is defined in the repo-root `docker-compose.yml`
and starts with the stack:

```bash
docker compose up -d roomba-poller
docker compose logs -f roomba-poller
```

It depends on `postgres` being healthy and receives the same `POSTGRES_*` values
as the backend. Set the `IROBOT_*` vars in the repo-root `.env` (see
`.env.example`).

### Locally (for development)

Requires Python 3.11+ and a reachable Postgres:

```bash
cd roomba-poller
python -m venv .venv && . .venv/Scripts/activate   # or bin/activate on POSIX
pip install -r requirements.txt
# export the env vars above (POSTGRES_HOST=localhost, etc.), then:
python poller.py
```

## Scope / ownership

This folder plus the `roomba-poller` service block in `docker-compose.yml` and
the appended `IROBOT_*` / `POLL_INTERVAL_SECONDS` vars in `.env.example`. It does
**not** own the schema (`schema.sql`), backend Java, or the frontend — see
`roomba-v4-integration/BUILD_CONTRACT.md`.
