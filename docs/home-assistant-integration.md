# Home Assistant Integration

Home Assistant (HA) is the smart-home device layer (ecobee thermostat, Eufy cameras,
future devices). The Spring Boot backend is the security/API layer in front of it;
Postgres holds normalized history. The frontend never talks to HA and never sees the
HA token or HA entity IDs.

```
React SPA ──JWT──▶ nginx ──▶ backend (Spring Boot) ──HA token──▶ Home Assistant ──▶ ecobee / Eufy
                                   │
                                   └──▶ postgres (smart_devices, thermostat_status, thermostat_readings)
```

Adapted from the original plan (`home_assistant_integration_plan.md`, written against a
generic Express/React Native stack) to this repo's conventions.

## Mapping the plan onto this repo

| Plan                                   | This repo                                                                 |
|----------------------------------------|---------------------------------------------------------------------------|
| Express API, `integrations/home-assistant/*.ts` | Spring Boot, package `com.homeplatform.homeassistant`            |
| `HomeAssistantClient`                  | `HomeAssistantClient` — JDK `HttpClient` + Jackson, bearer auth, timeouts |
| `HomeAssistantWebSocket`               | `HomeAssistantWebSocket` (JDK `java.net.http.WebSocket`, reconnect with backoff) + `HaWebSocketProtocol` (pure message handling, unit-tested) |
| `HomeAssistantService` / `entity-mapper` | `HomeAssistantService` (HA calls), `HomeDeviceService` (validation + DTOs), `ThermostatIngestionService`, `DeviceDiscoveryService`, `EntityMapper`; 15-min `HomeAssistantSnapshotScheduler` |
| JWT/RBAC middleware                    | `JwtAuthFilter` sets `role`; `HomeController` / `HomeAdminController` check it; errors mapped by `HomeExceptionHandler` |
| Migrations                             | `schema.sql` is the source of truth; JPA `ddl-auto: update` creates new tables/columns |
| Separate poller service                | Not used — the WebSocket runs **in the backend** so events can reach `AppEventService` / `AlertEngine` in-process |
| React Native screens                   | React + Vite + Tailwind tab (Phase 4)                                     |
| `HA_URL` / `HA_TOKEN`                  | `.env` → `docker-compose.yml` backend `environment:` → `app.home-assistant.*` |

## Configuration

| Env var        | Default | Meaning |
|----------------|---------|---------|
| `HA_ENABLED`   | `false` | Master switch. Off = no HA calls, no WebSocket, endpoints return 503. |
| `HA_URL`       | `http://homeassistant:8123` (compose) | The bundled `homeassistant` service. Override only if HA moves elsewhere. |
| `HA_TOKEN`     | blank   | HA long-lived access token (Profile → Security). Never commit it. |

The integration is active only when `HA_ENABLED=true` **and** both `HA_URL` and `HA_TOKEN`
are set. Otherwise it disables itself with one log line — the stack boots normally before
HA exists. The backend only needs `HA_URL` to be reachable from the backend container;
it makes no assumption about where HA runs.

## Data model

- `smart_devices` — one row per discovered HA entity. `public_id` (UUID) is the stable ID
  the API exposes; `provider_entity_id` (e.g. `climate.<something>`) stays internal.
  Discovery upserts `climate.*` (THERMOSTAT) and `camera.*` (CAMERA). New devices start
  **enabled**; an admin can disable one. Entity renames in HA create a new row.
- `thermostat_status` — latest snapshot per device (upserted, like `roomba_status`).
- `thermostat_readings` — append-only history. A row is written when a meaningful field
  changes (temperature, humidity, setpoints, mode, action) and by a 15-minute snapshot
  fallback. Every row carries `source`, `source_provider`, `ingestion_batch_id`.

## API

All under `/api/*`, authenticated by `JwtAuthFilter`. Responses never contain HA entity
IDs or the token. 503 when HA is disabled/unreachable, 404 for unknown/disabled devices.

| Endpoint | GUEST | USER | ADMIN |
|---|---|---|---|
| `GET /api/home/thermostats`, `/{id}`, `/{id}/history?from&to` | ✓ | ✓ | ✓ |
| `POST /api/home/thermostats/{id}/mode` `{ "mode": "heat" }` | ✗ | ✓ | ✓ |
| `POST /api/home/thermostats/{id}/temperature` `{ "temperature" }` or `{ "low", "high" }` | ✗ | ✓ | ✓ |
| `POST /api/home/thermostats/{id}/hold` `{ "preset": "away" }` (optional) | ✗ | ✓ | ✓ |
| `POST /api/home/thermostats/{id}/resume` | ✗ | ✓ | ✓ |
| `GET /api/home/cameras`, `/{id}/snapshot` | ✗ | ✓ | ✓ |
| `GET /api/admin/home/devices`, `POST /api/admin/home/discover`, `PUT /api/admin/home/devices/{id}` `{ "enabled" }` | ✗ | ✗ | ✓ |

## Phases

1. **Infrastructure** — `homeassistant` compose service (see open items for why), long-lived token.
2. **ecobee** — add the official HA ecobee integration; record real entity IDs/attributes.
3. **Backend** — this branch: client, WebSocket, schema, ingestion, endpoints, tests (mocked HA).
4. **Frontend** — Thermostat tab: current state, controls, history chart, unavailable states.
5. **Eufy** — identify the currently maintained integration, verify hardware support, snapshots/events.
6. **Real-time events** — normalize HA events into `AlertEngine` (motion, person, HVAC start/stop, device unavailable).

## Constraints

- No new ecobee developer API key; no abandoned ecobee wrappers; HomeKit not required.
- HA token stays in the backend; no HA entity IDs in the frontend.
- Don't depend on Docker Desktop (Windows) host networking for discovery.
- Reuse existing auth/RBAC, `AppEventService`, `AlertEngine`, and the append-only ingestion conventions.

## Open items (unverified — web search was unavailable when this was written)

- **HA hosting (decided 2026-10-19)**: HA runs as the `homeassistant` service in
  `docker-compose.yml` (Container install, UI on host port 8123, config in the `ha_config`
  volume). Why not the plan's HAOS VM: the NUC is Windows 11 Home (no Hyper-V), and a
  VirtualBox HAOS VM — forced onto the WSL2 hypervisor via Windows Hypervisor Platform —
  pinned one core at 99% and downloaded at ~125 KB/s (bridged over Wi-Fi *and* NAT) vs
  ~30 MB/s on the host; it also hung once in EFI `CpuMpPei`. The NUC is Wi-Fi only, so LAN
  bridging was unreliable regardless. Trade-offs: no add-on store, no LAN discovery —
  fine for the cloud-based ecobee integration. **Revisit before Eufy (Phase 5)**: likely
  dedicated hardware (HA Green / Pi) or a wired NUC; migrate via HA backup/restore.
- **ecobee auth**: confirm the official HA ecobee integration really works with account
  credentials and no developer API key.
- **ecobee hold/resume**: the backend uses `climate.set_preset_mode` for hold and
  `ecobee.resume_program` for resume when HA reports those capabilities; verify against the real entity.
- **Entity attributes**: verify `current_temperature`, `current_humidity`, `temperature`,
  `target_temp_low/high`, `hvac_action`, `hvac_modes`, `preset_modes`, `min_temp/max_temp`
  on the real climate entity.
- **Eufy**: verify which HA integration is currently maintained and supports the installed
  hardware before Phase 5. Don't assume live video works just because camera entities exist.
