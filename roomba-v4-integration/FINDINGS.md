# FINDINGS — Roomba V4 field test

Running log of what works against our robot. Identifiers redacted; model-identifying
fields (`sku`/`series`/`family`) kept because the maintainer needs them.

## Robot under test

| Field | Value |
|---|---|
| Family | `Roomba Combo` |
| Series | `G2` |
| SKU | `G284020` (Roomba 105 Combo) |
| Name | `Roomba` |
| BLID | `<REDACTED>` (32-hex) |
| Serial | `G284020H…<REDACTED>` |
| Flags | `is_raas=False`, `is_refurbished=False`, `is_smartcare=False` |

Library: `roombapy-prime==0.3.0b7`. Python 3.14.3 (Windows). Deps: `aiohttp 3.14.3`,
`paho-mqtt 2.1.0` — all installed clean with cp314 wheels.

## Probe #1 — feasibility (read-only) ✅

| Step | Result |
|---|---|
| Login (Gigya + iRobot auth chain) | ✅ OK |
| Identify (`get_serial_number_data`) | ✅ OK — returned the model info above |
| Connect (AWS IoT custom authorizer MQTT) | ✅ OK |
| `get_state()` | ✅ Call OK — but returns the **capabilities** shadow (`cap` / `digiCap` / `sku`), not live telemetry |
| `get_mission_history(max_reports=5)` | ✅ Call OK — returned `[]` (empty) |

**Verdict: FEASIBLE.** Every call succeeds; the 105 Combo is reachable via the V4
cloud protocol.

### Notable capability flags from `get_state()` (`state.reported.cap`)
`matter: 0` (no Matter), `timeline: 1` / `tLine: 2` (mission timeline available),
`area: 1`, `maps: 6`, `p2maps: 5`, `autoevac: 2`, `mopLift: 1`, `scrub: 3`,
`suctionLvl: 4`, `binFullDetect: 0`, `dnd: 0`. `sku: G284020`.

### Open questions after probe #1
1. **Where is live battery / phase?** `get_state()` gave capabilities, not `batPct` /
   `cleanMissionStatus`. On V4 these live in a **named shadow** — `roombapy-prime`'s own
   diagnostics polls `ro-currentstate`, `ro-stats`, `ro-services`, `ro-configinfo`.
   → probe #2 dumps these.
2. **Why was mission history empty?** Either no cloud-retained runs yet, or history for
   V4 comes via the **mission timeline** (`request_mission_timeline` /
   `watch_mission_timeline`) rather than the legacy `get_mission_history`.
   → probe #2 retries with a wide window; timeline path is the likely answer.

## Probe #2 — named shadows + live watch ✅ (captured a LIVE mission)

Robot was actively cleaning when probed, so we captured a real in-progress mission.
**The live telemetry lives in the `ro-currentstate` named shadow** (not `get_state()`,
which only returns capabilities).

### `ro-currentstate` → `state.reported` (the money shadow)
```jsonc
{
  "batPct": 97,                          // battery %
  "bin": { "present": true },            // note: no "full" field on this model
  "tankPresent": true,                   // combo mop tank
  "detectedPad": "padPlate",             // mop pad type
  "cleanMissionStatus": {
    "cycle": "clean",                    // clean | none | ...
    "phase": "run",                      // run | charge | stop | hmPostMsn | ...
    "error": 0,                          // 0 = none
    "notReady": 0,
    "initiator": "rmtApp",               // who started it (app/schedule/local)
    "missionId": "<REDACTED>",           // STABLE per-run unique id — use as run key
    "mssnStrtTm": 1787198687,            // mission start (epoch seconds)
    "nMssn": 3,                          // lifetime mission counter
    "operatingMode": 6,
    "sqft": 111                          // area cleaned so far
  },
  "runtimeStats": { "hr": 0, "min": 5 }, // current mission runtime
  "dock": { "state": 301, "error": 0, "cap": { "evac": 1, ... } }, // auto-empty dock
  "p2maps": [ { "p2map_id": "<REDACTED>", "p2mapv_id": "260820T…" } ],
  "regDate": "2026-08-19"
}
```
Shadow envelope also carries a top-level `version` and `timestamp`, and per-field
`metadata.reported.*.timestamp` (last-changed epoch) — handy for change detection.

### `ro-stats` → lifetime counters
```jsonc
{
  "bbmssn": { "nMssn": 3, "nMssnOk": 1, "nMssnC": 0, "nMssnF": 0 }, // total/ok/cancelled/failed
  "bbchg":  { "nChgOk": 2, "nChgErr": 0 },                          // charge cycles
  "bbsys":  { "hr": 15, "min": 0 },                                 // lifetime runtime
  "bbrstinfo": { "nNavRst": 3 }
}
```

### `ro-services` — only `nsmip` / `svcEndpoints` (no telemetry).
### `ro-configinfo` — `hwPartsRev.navSerialNo` (= our serial) + `passwordHash` (local
pw, **do not commit**). No live telemetry.

### Live update mechanism
- `watch_state()` saw **0 deltas** in 12s — it watches the classic/default shadow
  (capabilities, static). For live updates, **poll `get_named_shadow("ro-currentstate")`**
  on an interval, or use `watch_named_shadows_updates()`.
- `get_mission_history(blid, max_reports=5)` → `200 []` (empty). With
  `max_age=31536000` it **400s** (`.../missionhistory?maxReports=20&maxAge=31536000`) —
  maxAge has a cap. **Net: the legacy REST mission-history endpoint returns nothing for
  this V4 robot.** Run history must be built by observing `cleanMissionStatus`
  transitions (missionId change / phase → charge|stop) — or via the mission timeline.

## Mapping to `roomba_runs` (CONFIRMED via probe #2)

| `roomba_runs` column | V4 source (`ro-currentstate.state.reported.cleanMissionStatus`) |
|---|---|
| run identity (dedup key) | `missionId` (stable string) — fall back to `nMssn` |
| `started_at` | `mssnStrtTm` (epoch seconds → timestamp) |
| `completed_at` | observed when `phase` leaves `run` (→ `charge`/`stop`/`hmPostMsn`) |
| `duration_minutes` | `runtimeStats.hr*60 + runtimeStats.min` at completion (or completed−start) |
| `square_feet` | `sqft` |
| `status` | `error != 0` → STUCK; `phase` in (`charge`,`hmPostMsn`) & `error 0` → COMPLETED; cancelled → from `nMssnC` delta |
| `dirt_events` | **no V4 source — leave NULL** (drop the fake chart) |

Extra live-status fields for the tab's status card (no schema change needed / future
columns): `batPct`, `bin.present`, `tankPresent`, `dock.state`, lifetime `bbmssn`/`bbsys`.

## Probe #3 — MAP (rooms + geometry) ✅ — the map IS real GeoJSON

Correction to an earlier assumption: the floor map is fully retrievable (not "no usable
vector map"). Path: `get_active_map_versions()` → `p2map_id` + `active_p2mapv_id` →
`get_map_geojson_link(id, version)` returns `{"map_url": <presigned>}` →
`download_map_bundle(url)` → `parse_map_bundle(bytes)`.

- `get_active_map_versions()` / `get_map_metadata()` both work. Return `P2MapData`:
  `p2map_id`, `active_p2mapv_id`, `name` ("Map 1"), `state`, `visible`,
  `user_orientation_rad`, and `rooms_metadata[]` (per-room `room_id`, `region_type`,
  `name`, `category`, per-mode cleaning defaults).
- **Parsed map bundle keys:** `manifest`, `metadata`, `rooms`, `borders`, `floorPlan`,
  `dockPose`. Each of rooms/borders/floorPlan/dockPose is a **GeoJSON FeatureCollection**.
  `rooms.features[]` are `Polygon`s with `id` (= room_id) and real coordinates in METERS
  (e.g. `[-7.2,-0.3],[-7.0,-0.1],…`). `sourceFormat: "picea"`.
- **Live robot position:** `watch_live_map()` yields `PositionUpdateMessage` (x/y in the
  same meter coordinate space) + `MapUpdateMessage` — the moving dot the app shows.

**Caveat (data maturity, not a library limit):** this brand-new robot has mapped only
**1 room so far, unnamed** (`rooms_metadata[0].name == null`). iRobot builds rooms/walls
over the first several training runs; names appear once labeled in the app. The
integration just renders whatever the current map version contains.

→ The tab CAN show a real floor plan (floorPlan + borders + room polygons as SVG/canvas,
dock marker) with a live robot dot — replacing the mock SVG entirely.

## Probe #4 — clean zones / favorites (read-only)

`get_favorites()` and `get_favorites_raw()` both work → return `[]` (0 zones). Fresh
robot, one unmapped room, no user-drawn clean zones yet. Valid data point for the
maintainer: favorites read succeeds/empty on a fresh G284020.

### Contributor: zone naming (upstream issue #75) — DEFERRED
Maintainer's open question is "zone naming via CLI — tool exists, never run against a
robot" (`roombapy-prime-name-clean-zone`, **destructive**: rewrites the whole zone list).
Blocked for us on two counts: (1) that CLI is newer than `v0.3.0b7` (on master/b9 — the
b7 tools ship only `verify-region-commands` / `verify-map-edit`); (2) we have 0 zones to
name. **Revisit once** the robot has mapped more rooms and Bryan has drawn ≥1 clean zone
in the app — then upgrade tools to latest and field-test the (destructive) rename.

## Verdict: ✅ FULLY FEASIBLE
Live status + per-run data are both obtainable from `ro-currentstate` on our G284020.
Build shape (mirrors CoServ): a Python poller using `roombapy-prime` reads
`ro-currentstate` on an interval, persists a `roomba_runs` row per completed mission →
`RoombaController`/service/entity/repo → real `Roomba.tsx` (live card + run history;
drop the fake floor-map + dirt-events).
