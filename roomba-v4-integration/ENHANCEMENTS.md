# ENHANCEMENTS — things to add to the Roomba integration

Prioritized roadmap of additions to the v1 Roomba tab, from a 4-agent investigation of the
installed `roombapy-prime` (v0.3.0b7) source + the `johnnyh1975/roombapy-prime` repo (README,
issue #75). Per-domain raw reports live in `enhancements/` (telemetry.md, history.md, maps.md,
control.md). Robot under test: Roomba 105 Combo, SKU `G284020`, V4/"Prime" cloud protocol.

**v1 today:** live status card (battery/phase/dock/area/bin/tank), run-history table, static
GeoJSON floor plan. Read-only; no control.

## Cross-cutting realities (read before scoping anything)

1. **Many reads are FREE.** The poller already fetches `ro-currentstate` + `ro-stats` every
   cycle and surfaces only ~12 fields. A large share of Tier 1 is "persist a field we already
   have" — no new API call.
2. **Every WRITE needs a new command path** that doesn't exist yet: browser → new **ADMIN-gated**
   `POST /api/admin/roomba/*` (mirror `/api/admin/sync/*`) → the **poller** (which owns the single
   cloud connection) via a `roomba_commands` queue table or a small local endpoint → `PrimeRobot.<method>()`.
   That shared plumbing is a one-time **M**; per-command effort is on top of it.
3. **Single cloud connection.** The poller holds the one MQTT/REST connection; two simultaneous
   connections cause a reconnect storm. Commands must funnel through the poller, and a user driving
   the robot from the iRobot app at the same time can disrupt both.
4. **"Accepted ≠ done."** A broker ack ≠ the robot obeyed (a bad region-clean → whole-house clean).
   UI must show commands as *accepted*, confirmed by subsequent status polling — never assume success.
5. **`done_code` enum is wrong in b7** (issue #75) — ship a corrected camelCase map or bump to ≥b9.
6. **Drop WiFi signal strength** — there is no RSSI field anywhere in V4. Offer online/offline instead.

---

## 🟢 Tier 1 — Quick wins (S-effort, confirmed, little/no new fetching). Do these first.

| Add | What it gives | Source | New call? | Conf |
|---|---|---|---|---|
| **Decoded error text** | "error 26" → "Vacuum motor stalled — clean the filter" (8 langs) | `vendor_errors.vendor_error(rep.cleanMissionStatus.error)` | none (local lookup) | confirmed |
| **Full dock-status decode** | "Dock: emptying bin / bag full / pad washing / tank removed" not a number | `rep["dock"]` → `DockState` 86-enum + `DockStatus.error_text` | none | confirmed |
| **notReady / condNotReady reasons** | "Can't start: bin full / on a cliff" pre-flight | `rep.cleanMissionStatus.notReady/condNotReady` | none | confirmed (build small code map) |
| **Unprocessed fault string** | Catches faults `error` reports as 0 | `stats["unprocessedError"]` | none | confirmed |
| **Charge cycles + charge errors** | Battery-aging trend; `nChgErr>0`/`nLithF` = fault | `stats["bbchg"]` (nChgOk/nChgErr/nLithF) | none | confirmed |
| **Wear/stuck counters** | "Stuck 4×", brush/wheel stalls, cliffs, pickups | `stats["bbrun"]` (16 counters) | none | beta (present if firmware sends) |
| **Nav-reset / OOM counters** | "Rebooted mid-clean" reliability signal | `stats["bbrstinfo"]` (nNavRst/nOomRst) | none | confirmed |
| **Powered-on hours** | Lifetime operating hours | `stats["bbsys"]` | none | confirmed (label "powered-on", not age) |
| **Detected pad / detergent / tank** | Which mop pad; detergent level | `rep.detectedPad / detergent / tankPresent` | none | confirmed (tank), uncertain (detergent) |
| **Run initiator** | "Started by: app / schedule / Alexa / dock" | `rep.cleanMissionStatus.initiator` (saw `rmtApp`) | none | beta |
| **Composite "needs attention" flag** | One glanceable tile: error≠0 OR dock.error OR notReady OR bin/tank missing OR part depleted | backend derivation of the above | none | confirmed |
| **Keep-out / no-mop / virtual-wall overlay** | Draw restricted zones on the map | map bundle `policyZones` → `PolicyZoneFeature.category` (LineString=virtual wall) | **likely already in stored `roomba_map.geojson`** → frontend-only | confirmed |
| **Room names/types + map orientation** | Label rooms on the plan; rotate to match app | `rooms_metadata` + apply `user_orientation_rad` | none (already stored) | confirmed |

**Tier 1 headline:** decoded error + dock text + charge/wear counters are the biggest usefulness
jump per line of code — the data is already in payloads the poller fetches and discards.

---

## 🟡 Tier 2 — High value, medium effort.

| Add | What it gives | Source | Effort | Conf |
|---|---|---|---|---|
| **Consumable parts life** (marquee maintenance) | Filter/brush/pad/evac "X% / N missions left" tiles | `get_robot_parts()` → `RobotPart{count_remaining, minutes_remaining, ...}` → new `roomba_parts` table | M | confirmed on hardware |
| **Filter %** | Single "filter 63%" gauge | `get_settings().filter_pack.pct_left` | M | beta (needs `rw-settings`; can time out) |
| **Per-room clean-score heatmap** | "Which room is dirtiest right now" | `get_clean_score_raw(p2map_id)` → `CleanScoreRegion.clean_score` (**higher = dirtier**, accumulated) | M | confirmed (GET `?p2map_id=`) |
| **Device-info header + firmware** | "Roomba Combo G2, G284020, SN…, firmware 9.x" | `get_serial_number_data()` + `get_named_shadow("rw-software")` | M (cache once) | confirmed |
| **Basic control: Start / Stop / Pause / Dock / Find** | The obvious "run it now" buttons + locate chime | `send_simple_command("start"/"stop"/"pause"/"dock"/"find")` | S **on top of the one-time command-path M** | confirmed on hardware |
| **Run a saved favorite** | "Clean just the kitchen" by replaying app-authored zones | `get_favorites()` → resend `command_defs` via `send_routine_command_via_cmd_topic` | M | confirmed (safest zone-clean path) |

Notes: control items are the first *writes* — they need the ADMIN command path (#2 above) and the
"accepted ≠ done" UI treatment. `find` is a safe, delightful first button. Prefer replaying a saved
favorite over hand-building region payloads (a malformed region clean silently becomes whole-house).

---

## 🔵 Tier 3 — Big "wow", larger effort.

| Add | What it gives | Source | Effort | Conf |
|---|---|---|---|---|
| **Live moving robot dot** | The static plan becomes a live view during a clean | `watch_live_map()` → `PositionUpdateMessage(x,y,theta)` | L — start with a `roomba_position` row the poller updates + 1–2 s frontend poll, graduate to SSE | confirmed in lib |
| **Richer run history (per-room + why-it-ended)** | Per-room coverage + "battery / user-ended / timebox / docked" reasons | `watch_mission_timeline()` → `RoomEvent` + `done_code` (persist at mission end) | L | beta (live-only stream; complements our phase-observation) |
| **Authoritative history backfill** | Full historical run list + embedded per-room timeline in one call | `get_mission_history(max_age=<days>)` — add `done_code`/`run_minutes`/`oModeStats`/`initiator` columns | M | confirmed on other accounts (returns `[]` on our fresh robot — treat as "none yet", use days-not-years maxAge) |
| **Vac-vs-mop split per run** | For the Combo: minutes/sqft vacuuming vs mopping | `oModeStats` (via timeline/history) | M | beta |

**History reality:** REST `get_mission_history` is the *proper* source but is empty until the robot
accrues cloud history; `watch_mission_timeline` is a *live* MQTT stream (idle robot stays silent) that
gets us per-room data *now* as missions happen. Keep the current phase-observation as the always-on
skeleton; layer these to enrich.

---

## 🔴 Tier 4 — Defer / avoid (destructive or untested on hardware).

- **Schedule authoring / time-day changes** — "surprise activity" risk; server rejects incomplete
  bodies. *Exception:* **enable/disable an existing schedule** is the one confirmed, prevent-only,
  safe schedule write — OK to add with a read-only schedule view.
- **DND quiet-hours window** — write modeled but first live PUT 400'd; not reconfirmed.
- **Favorite / zone CRUD** (create/delete/reorder) — destructive; a from-scratch favorite is invisible
  in the app.
- **Virtual-wall / keep-out zone EDITS** — REPLACE semantics: omitting a zone **deletes** it. High blast
  radius; only "resend unchanged" is confirmed.
- **Map edits / `delete_map` / room split-merge** — destructive rewrites of the persistent map;
  some paths need an unimplemented V3 MQTT route.
- **Zone naming CLI** — issue #75: "tool exists, never run against a robot" (and we have 0 zones yet).
- **`reset_robot(send_wipe)`** — factory/data wipe. Never surface.
- **Global suction/scrub/pad-wetness sliders** — regions override globals; the "set but no effect"
  trap. Do power/scrub per-region inside a clean command, or not at all. (`childLock` is the one
  `set_setting` with a confirmed physical effect.)

---

## Recommended build order

1. **Phase A — Tier 1 reads.** Persist + decode the fields we already fetch (errors, dock, charge/wear
   counters, initiator, needs-attention flag) + the frontend-only map overlays (keep-out zones, room
   names). Highest value/effort ratio, zero risk, no new robot calls.
2. **Phase B — Maintenance + identity.** `get_robot_parts()` parts-life tiles, clean-score heatmap,
   device/firmware header.
3. **Phase C — Control.** Build the ADMIN command path once, then Start/Stop/Dock/Find + run-a-favorite.
4. **Phase D — Live dot.** `watch_live_map` → `roomba_position` + poll (SSE later).
5. **Phase E — History depth.** `watch_mission_timeline` enrichment now; `get_mission_history` backfill
   as the robot accrues cloud history.

## Library version note
b7 is installed; b9/master has the `done_code` fix and the newer tools (incl. the zone-naming CLI).
Bumping the pin is worth it before Phase E / any zone work.
