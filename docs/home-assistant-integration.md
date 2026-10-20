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
- `camera_status` — per camera: its sibling HA entities (battery, charging, motion, person),
  the go2rtc stream name (the eufy serial), and latest battery/motion state. Discovery fills
  the links via HA's `/api/template` (the only REST route into the device registry).
- `camera_battery_readings` — append-only battery history for battery cameras: a row when
  the level or charging state changes, plus the 15-minute snapshot.
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
| `GET /api/home/cameras`, `/{id}/snapshot`, `/{id}/battery?from&to`; `POST /{id}/live` | ✗ | ✓ | ✓ |
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
- **Eufy**: decided 2026-10-20 — see "Eufy (Phase 5)" below. Still to verify on the real
  hardware (3 cameras + HomeBase): live video over the NUC's Docker/Wi-Fi network.

## Eufy (Phase 5)

**Why this stack.** The long-standing setup (fuatakgun `eufy_security` + bropat
`eufy-security-ws`) stopped returning devices when Eufy moved accounts to its "Eufy Mega"
platform; eufy-security-ws was archived 2026-09-12 and points to `mega-yfue/eufy-sdk`.
HomeKit isn't viable (HomeBase 3 pairing fails), and HomeBase RTSP is model-dependent and
gives video only — kept as a fallback if live view through the bridge doesn't work here.

**Pieces.**
- `eufy-bridge` service in `docker-compose.yml` — `ghcr.io/mega-yfue/ha-eufy-sdk-bridge`,
  pinned. Logs into Eufy once; WebSocket on 3000, bundled go2rtc (RTSP 8554, API 1984).
  Internal network only. **Off unless `.env` has `COMPOSE_PROFILES=eufy`** plus `EUFY_*`.
  Login token persists in the `eufy_data` volume.
- `eufy_sdk` integration in HA's `/config/custom_components`, installed by
  `scripts/ha-install-eufy-sdk.sh <version>` (no HACS; same files, pinned). Keep the bridge
  image and the integration on the same release.

**Hardware (this home).** HomeBase S380 (HomeBase 3) + 2× SoloCam S340 (T8170, solar/battery)
+ Indoor Cam E30 (T8417, mains). Eufy lists both camera models as HomeBase 3 compatible.
- **Attach the E30 to the HomeBase**, not standalone: standalone cameras can ignore commands
  and never start live view through eufy-sdk (eufy-sdk#325, open); the same accounts'
  HomeBase 3 cameras stream fine.
- **S340s are battery cameras**: the bridge caps a live stream at ~55 s
  (`STREAM_BATTERY_BUDGET_MS`), and HA's "Preload camera stream" must stay **off** for them
  (it keeps waking the camera). Prefer snapshots/events over live tiles for these.
- **RTSP fallback**: only the E30 has it (app → Storage → RTSP; drops to 1080p, community
  reports of drops). The S340s and HomeBase 3 have none — bridge only.

**Account.** Use a dedicated Eufy account with the HomeBase shared to it (admin). Eufy allows
one active login per account — the bridge on the main account would sign the phone app out.
Run exactly one bridge per account.

**Setup.**
1. Shared account exists → on the NUC, add to `.env`: `COMPOSE_PROFILES=eufy`,
   `EUFY_EMAIL`, `EUFY_PASSWORD`, `EUFY_COUNTRY`; deploy (`~/deploy-nuc.sh home`).
2. HA → Settings → Devices & services → Add Integration → **eufy-sdk** → host `eufy-bridge`,
   port `3000`. Enter the emailed 2FA code / captcha there (codes expire fast).
3. Backend discovery picks up the `camera.*` entities (Admin → discover, or the 15-min
   snapshot); `/api/home/cameras` and `/snapshot` then serve them (members only).

**Known risks.** The project is young (0.x, Sep–Oct 2026); recurring Eufy auth breakage has
been reported (eufy-sdk #182) — fix is re-login via the integration. Host networking is only
needed for the bridge's own WebRTC; HA streams via RTSP. Whether streaming needs LAN P2P to
the HomeBase (which Docker Desktop's NAT + the NUC's Wi-Fi may block) is unverified — if live
view fails but snapshots/events work, try HomeBase RTSP or move HA to wired dedicated hardware.

## Cameras tab

Members only (route guard + `requireMember`). Built and tested against mocked cameras;
not verified against the real bridge yet.

**Live view only while someone is watching.** Each tile shows the latest snapshot. Live
video runs only while the tab is visible, the tile is on screen and the page isn't idle
(3 min without input) — `shouldStream()` in `frontend/src/utils/cameras.ts` is the single
rule. Wired cameras (E30) start by themselves; battery cameras (S340) need a tap and stop
after 45 s with "Still watching?". Leaving, hiding the tab or going idle closes the socket,
and go2rtc stops the camera when its last viewer leaves.

**Path.** `POST /api/home/cameras/{id}/live` returns `/camera-stream/<ticket>/ws` (HMAC,
60 s, random key per process). nginx `auth_request`s
`/internal/camera-stream/auth`, which answers 204 + `X-Stream-Src: <serial>`, then proxies
to `eufy-bridge:1984/api/ws?src=<serial>` — go2rtc's MSE WebSocket (fMP4 over TCP, so no
WebRTC/UDP through Docker's NAT). nginx sends the browser's `Host` because go2rtc only
accepts a WebSocket whose Origin matches Host. The client's query string is never forwarded.
iPhone needs iOS 17.1+ (ManagedMediaSource).

**Battery.** Badge on each battery tile, plus a chart per camera (24 h / 7 d / 30 d): level
line green while charging, grey on battery, night shaded from sunrise/sunset computed for
`PROPERTY_LATITUDE/LONGITUDE`, and a daily "+X% sun · −Y% used" summary. When the camera
doesn't report charging, the UI infers it from the trend and says "Likely charging".

**To verify on the real bridge.** That go2rtc listens on `0.0.0.0:1984` inside the bridge;
the S340/E30 entity names (battery `sensor`, charging sensor, motion/person); and that a
battery camera's stream starts over the NUC's network.

## Camera alerts

`CameraAlertService` writes `CAMERA` notifications for active members (never guests).
Dedupe is by title against `notifications`, so restarts don't re-alert.

| Alert | Severity | When | Repeats |
|---|---|---|---|
| `<Camera> camera battery low` | WARNING | ≤ 30% and not charging | once a day |
| `<Camera> camera battery critical` | CRITICAL | ≤ 15% and not charging | once a day |
| `<Camera> camera isn't charging` | WARNING | below 90%, no charge gained in 48 h, and both previous days sunny (Open-Meteo WMO code ≤ 2); needs 2 days of history | once a day |
| `<Camera> camera offline` | WARNING | unavailable for 30 min | once a day |
| `Eufy cameras disconnected` | WARNING | every camera offline 30 min — usually the bridge was signed out | once a day |
| `Person detected — <Camera>` | INFO | live person event, outdoor (battery) cameras only | at most every 15 min per camera |

Battery, charging and offline checks run after each 15-minute HA snapshot; person alerts
fire from live ingestion. The indoor E30 is excluded from person alerts (it sees the
household all day).

**Bridge sign-outs.** Eufy allows one session per account. Signing into the bridge's
account in the eufy app bumps the bridge; it re-logs in on its own (which signs the app
out again) and may need a new 2FA code entered in Home Assistant. Keep the phone on the
main account.
