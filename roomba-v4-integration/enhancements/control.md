# Roomba V4/"Prime" control surface — candidate dashboard additions

Research map of the CONTROL / SCHEDULING / ZONE-CLEANING / SETTINGS / NOTIFICATIONS surface a home
dashboard could add for an iRobot Roomba (V4/"Prime" cloud) via `roombapy-prime`. This is the
WRITE/interactive side. **v1 (current) is read-only**: status card + run history + static map. There
is NO control, no scheduling, no zones, no settings today — every item below is NEW write capability.

Sources: installed `roombapy_prime` library `.py` docstrings (authoritative on hardware confirmation),
`roombapy_prime_tools/verify_*.py` tool headers, the GitHub README, and issue #75.

---

## Cross-cutting architecture notes (these set every effort estimate)

**The architecture reality.** The current integration is read-only: `poller.py`
(`C:\...\home-automation\roomba-poller\poller.py`) holds the *single* iRobot cloud MQTT/REST
connection and writes status to Postgres; `RoombaController.java`
(`C:\...\home-automation\backend\src\main\java\com\homeplatform\controller\RoombaController.java`)
serves that data read-only. Every item below is **net-new write capability** and needs the same new
plumbing:

- **A command path that does not yet exist:** browser → new authenticated Spring endpoint
  (`POST /api/admin/roomba/...`, gated to `ADMIN`, matching the existing `/api/admin/sync/*` pattern)
  → the **poller process** (which owns the live connection) → `PrimeRobot.<method>()`. The backend
  cannot open its own connection — see the single-connection caveat — so this means adding a command
  channel into the poller (e.g. poller reads a `roomba_commands` queue table, or exposes a tiny local
  HTTP/IPC endpoint the backend calls). That shared plumbing is a **one-time M**; per-feature effort
  below is *on top of* that.
- **Single-connection constraint is real and load-bearing.** The library repeatedly documents that
  two simultaneous connections cause a reconnect storm (task A tears down the shared MQTT client, task
  B sees a drop, ping-pong — the "DaRealGuGu" field bug). Testers are told to **close the iRobot phone
  app and stop other integrations** while writing. So: all commands must funnel through the one poller
  connection, and a user driving the robot from the iRobot app at the same time can disrupt both.
- **"A confirmed send proves delivery, never intent."** The library's hardest-won lesson: a broker
  PUBACK ≠ the robot did what you asked. Several paths accept a payload and either do nothing, or do
  the *wrong* thing (e.g. a region clean with a missing map id → PUBACK + **whole-house clean**). Treat
  write success in the UI as "accepted," not "done," unless status polling confirms.

**Legend** — **Write**: mutation type, **DESTRUCTIVE** = deletes/rewrites persisted robot state
(schedules, favorites, zones, maps). **Confidence**: *confirmed-on-hardware* (a named tester observed
the effect) vs *untested* (payload/schema modeled, write path built, never validated live, or
accepted-but-effect-unconfirmed).

---

## Basic control (immediate, reversible, low-risk)

| Feature | Enables | Exact method + args | Write | Effort | Confidence | Caveats |
|---|---|---|---|---|---|---|
| **Start / Stop / Pause / Resume / Dock** | Core "run the robot now" buttons; a whole-house clean is literally `start` | `PrimeRobot.send_simple_command("start"\|"stop"\|"pause"\|"resume"\|"dock")` (initiator defaults `"localApp"`) | Transient action (no persisted mutation) | **S** (on top of shared path) | **Confirmed on hardware** (multiple testers; README + issue #75; `verify_mission_commands.py`) | Needs `irbt_topic_prefix` from login or raises. A "phantom mission" (cloud doc stuck `phase:"run"` + `error`) makes verbs silently inert until a physical power-cycle — even iRobot's own app can't clear it. Not the old shadow path (`send_mission_command` times out — deprecated). |
| **Find / locate (chime)** | "Where's my robot" audible beep | `send_simple_command("find")` | Transient | **S** | **Confirmed** (README: "robot chimed"). Note the *other* locate paths — `trigger_echo_via_shadow()` and `poll_echo_value()` — are **disproven/unreliable**; use `find` | Same topic-prefix requirement. |
| **Empty bin / auto-evac** | Trigger clean-base evacuation | `send_simple_command("evac")` (stop: `"stopevac"`) | Transient | **S** | **Untested** (enum value confirmed from vendor serializer `flushsluice`/`evac`; no live observation) | Only meaningful on robots with a Clean Base dock; harmless no-op otherwise. Wrong SKU → silent nothing. |

---

## Zone / room-specific cleaning (high value, sharp edges)

| Feature | Enables | Exact method + args | Write | Effort | Confidence | Caveats |
|---|---|---|---|---|---|---|
| **Clean specific room(s)** | "Clean just the kitchen" from real map rooms | `PrimeRobot.send_routine_command_via_cmd_topic(RoutineCommand(command_type=START, asset_id=blid, map_id=<active p2map_id>, regions=[Region(region_id=<room id>, region_type=RegionType.RID, params=CommandParams(operating_mode=...))], initiator="rmtApp"))` | Transient action, but **the riskiest write path in the library** | **L** (needs map/room-id fetch via `get_map_metadata`, mode selection UI, the shared path) | **Confirmed on hardware** for the *exact* shape at left (Echovictor37, Combo 105 — cleaned only the targeted room). Everything off that shape is untested. | **`command_type` must be `START`, not `CLEAN`; `map_id` must NOT be null.** `CLEAN`+`map_id=None` → PUBACK + **whole-house clean** (wrong-intent failure). Empty `region_id` raises by design. `clean_all`/`select_all` is **inert** — don't build a "clean all via regions" button; use `send_simple_command("start")`. Zone IDs from real map data only. |
| **Zone (saved area) cleaning** | Clean a saved zone rather than a room | Same, `region_type=RegionType.ZID` | Transient | **L** | **Confirmed** RID and ZID observed live | `TID` (ad-hoc/temporary zones, IDs 160–199) is **untested and explicitly gated** ("stage 4, never yet run by anyone") — do not expose. |
| **Spot clean** | Point/spot clean | `send_routine_command_via_cmd_topic` with `command_type=CLEAN_SPOT` (`"point_clean"`) or a `SPOT_CLEAN` favorite | Transient | **L** | **Untested** live for the command form (value double-confirmed from serializer + a stored favorite, but no observed spot-clean run) | Requires geometry/params not auto-derivable. |

---

## Favorites = saved clean zones (CRUD)

| Feature | Enables | Exact method + args | Write | Effort | Confidence | Caveats |
|---|---|---|---|---|---|---|
| **Run a saved favorite** | One-tap "Downstairs" routine the user already made in the app | Fetch `get_favorites()` → resend its `command_defs` via `send_routine_command_via_cmd_topic` (byte-for-byte) | Transient | **M** | **Confirmed** (resending an unchanged favorite behaves like pressing it in the app) | Safest way to do zone cleaning — reuses app-authored payloads, avoids hand-building regions. **Recommended over building regions from scratch.** |
| **Rename / recolor favorite** | Cosmetic edits | `update_favorite(id, FavoriteV1(...))` (color-only is the safe stage) | **DESTRUCTIVE** (rewrites the stored favorite) | **M** | **Confirmed** on hardware (update-unchanged + color change) | `update` replaces the object; carry unknown/unmodeled fields through or you silently drop server-side keys. |
| **Create / delete / reorder favorite** | Manage saved zones from the dashboard | `create_favorite` / `delete_favorite(id)` / `order_favorite(id, insert_at=...)` | **DESTRUCTIVE** (delete/reorder) | **M–L** | Create/delete: **confirmed** server-side. **Caveat:** a favorite created with empty `command_defs` is real+listable but **invisible in the iRobot app UI** | Building a *useful* favorite (with regions) from scratch is effectively untested. Delete is irreversible. |

---

## Schedules (CRUD) — delayed-effect writes

| Feature | Enables | Exact method + args | Write | Effort | Confidence | Caveats |
|---|---|---|---|---|---|---|
| **View schedules** | Show the weekly plan | `get_schedules(household_id)` (get id via `get_household_id()`) | Read | **S** | **Confirmed** live | `household_id` ≠ always blid — use `get_household_id()`. |
| **Disable a schedule** | "Pause the Tuesday clean" | `update_schedules(household_id, schedule_id, [HouseholdSchedule(...enabled=False)])` | **DESTRUCTIVE** (rewrites the schedule list) | **M** | **Confirmed** live (chairstacker) — chosen as the *safe* mutation because it can only *prevent* future activity | App's Automations screen may not refresh immediately (UI cache) — `get_schedules()` reflects it right away. **Do not** pause a schedule via `set_setting("schedHold")` — that write is accepted but the schedule **stays active** (documented false-positive). |
| **Create schedule / change time-day** | Full schedule authoring | `create_schedules(...)` / `update_schedules(...)` with new `ScheduleTime` | **DESTRUCTIVE** | **L** | **Untested / deliberately not built** in verify tooling | *Delayed-effect risk*: a wrong time can make the robot start unexpectedly when nobody's home. Server requires a semantically complete schedule (bare name+enabled → HTTP 500); derive from an existing one. Highest "surprise activity" risk of anything here. |

---

## Do Not Disturb

| Feature | Enables | Exact method + args | Write | Effort | Confidence | Caveats |
|---|---|---|---|---|---|---|
| **Toggle DND now (ad-hoc)** | Quiet the robot immediately | `send_simple_command("start_dnd")` / `"stop_dnd"` | Transient | **S** | **Untested** (wire values confirmed from serializer; no live observation) | No time window — just on/off. |
| **Set quiet-hours window** | Persisted daily quiet hours | `set_dnd_settings(household_id, DNDDailySchedule.from_clock(...).to_json())` (minutes-since-midnight, 0–1439) | **DESTRUCTIVE** (rewrites DND config) | **M** | **Partly / untested** — issue #75 says DND "can be enforced in HA," but the first live PUT returned HTTP 400 (three body faults) and the corrected `DNDDailySchedule` body is modeled-but-not-yet-reconfirmed live | Body is the variant object directly (no envelope); wrong key casing (`dailyStart` not `daily_start`) or mixing variants → 400. |

---

## Settings / suction / scrub / profiles

| Feature | Enables | Exact method + args | Write | Effort | Confidence | Caveats |
|---|---|---|---|---|---|---|
| **Child lock** | Toggle child lock | `set_setting("childLock", True/False)` | Rewrites one settings key | **S** | **Confirmed end-to-end** (DaRealGuGu — showed in app + audible announcement). The *only* setting with a confirmed physical effect. | Only meaningful on SMART tier. |
| **Carpet boost / eco-charge / vacHigh / noAutoPasses** | Misc toggles | `set_setting("carpetBoost"/"ecoCharge"/"vacHigh"/"noAutoPasses", bool)` | Rewrites one key | **S each** | **Untested effect** — write accepted + read-back confirmed, but real behavior unobserved (none readily observable) | UI must not claim "on" as truth — only that the write was accepted. |
| **Suction level / scrub / operating mode** | Per-clean power/mop intensity | Not global settings — passed as `CommandParams(suction_level=SuctionLevel.HIGH, scrub=..., operating_mode=...)` **inside a region/mission command** | Transient (per-mission) | **L** | **Partial** — suction/operating-mode values confirmed from native analysis + one live combo (`command 32→status 6`); as a standalone control, untested | **Global pad-wetness / suction sliders are explicitly advised against** — regions override globals, and the app doesn't treat them as user-modifiable (would be the `schedHold` false-UI trap again). Do per-region only, or not at all. |
| **Cleaning profiles (read)** | Show "Deep/Standard" profiles | `get_cleaning_profiles(asset_id, p2map_id)` | Read | **S** | Read only; modeled | Useful as a picker feeding region-clean `params`. |

---

## Notifications & diagnostics

| Feature | Enables | Exact method + args | Write | Effort | Confidence | Caveats |
|---|---|---|---|---|---|---|
| **Notifications feed** | Show robot alerts/events in the dashboard | `get_notifications(app_version="2.2.4")` | Read | **M** | Untested shape but modeled | Read-only; pairs naturally with the existing Debug Dashboard event log. |
| **Consumable/parts life** | "Filter/brush at X%" | `get_robot_parts()` (read); `reset_robot_parts(part_ids=[...])` to reset after replacement | Read / **DESTRUCTIVE reset** | **M** | Read modeled; reset untested | Reset zeroes maintenance counters — irreversible bookkeeping change. |

---

## ⚠️ Do NOT surface (destructive, dangerous, or untested-and-irreversible)

- **`reset_robot(send_wipe=...)`** — factory/data wipe. Library flags it "likely a consequential action." Never put in a dashboard.
- **`set_virtual_wall` / keep-out zone edits** — **REPLACE semantics**: a partial list **deletes every zone you omit**. Only "resend unchanged" is confirmed; add/move/remove is "never attempted." High blast radius.
- **Zone *naming* via CLI** — the explicit "**tool exists, never run against a robot**" warning in issue #75.
- **Map edits / delete_map** — destructive rewrites of the persistent map; edit responses documented-but-unobserved.
- **TID / ad-hoc zones, `send_umi_get_request`, raw furniture commands** — experimental/unconfirmed.

---

## Top 3 picks for the home dashboard

1. **Basic control — Start / Stop / Pause / Dock / Find (`send_simple_command`).** Highest value,
   lowest risk, **confirmed on hardware by multiple testers**, effort **S** on top of the shared
   command path. Transient and reversible (Stop always works, except the rare phantom-mission case,
   which is worth a small "if it won't stop, power-cycle" note in the UI). This is the obvious first
   write feature.

2. **Run a saved favorite (`get_favorites` → resend `command_defs`).** Delivers the marquee "clean
   just the kitchen" experience **without** hand-building region payloads — it replays app-authored,
   byte-for-byte payloads, which is exactly the confirmed-safe path and sidesteps the wrong-intent
   whole-house-clean trap. Effort **M**, confidence high, and it leans on zones the user already
   curated in the iRobot app.

3. **Disable/enable a schedule (read via `get_schedules`, toggle `enabled`).** The one schedule
   mutation **confirmed live** and chosen specifically because it can only *prevent* unexpected
   activity, never cause it — the safe direction for a delayed-effect write. Pair the read-only
   schedule view with an enable/disable switch; defer time/day authoring and creation (untested +
   "surprise activity" risk).

All three are confirmed-on-hardware, reversible-or-preventive, and reuse the one poller connection.
Anything touching favorites-CRUD, schedule authoring, DND windows, virtual walls, maps, or
`reset_robot` should wait — they're either destructive, untested live, or both — and every write must
go through the single poller connection behind an `ADMIN`-gated endpoint, with the UI treating
"accepted" as distinct from "done."

---

## Key source files for implementation reference (absolute paths)

- `...\roomba-venv\Lib\site-packages\roombapy_prime\prime_robot.py` — all write methods
- `...\roomba-venv\Lib\site-packages\roombapy_prime\models\mission_control.py` — `RoutineCommand`, `Region`, `RegionType`, `CommandParams`, `SuctionLevel`, `MissionCommandType`
- `...\roomba-venv\Lib\site-packages\roombapy_prime\models\schedules_dnd.py` — schedules + `DNDDailySchedule`
- `...\roomba-venv\Lib\site-packages\roombapy_prime_tools\verify_*.py` — exact hardware-validated payload shapes and safety-gate design
