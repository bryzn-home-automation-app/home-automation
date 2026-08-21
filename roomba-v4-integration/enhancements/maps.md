# Candidate MAP + LIVE-POSITION additions for the Roomba dashboard

Research-only mapping of map/live-position features the home dashboard could add for
an iRobot Roomba (V4/"Prime" cloud) via `roombapy-prime`, beyond the v1 static
floor-plan already integrated. Derived from reading the installed library source
(`livemap.py`, `map_editing.py`, `map_bundle.py`, `prime_robot.py` incl.
`watch_live_map`, `robot_info.py`, `enums_common.py`), the current
`frontend/src/components/RoombaMap.tsx` and `roomba-poller/poller.py` (`refresh_map`),
`roombapy_prime_tools/verify_map_edit.py`, and cross-checking the GitHub README /
issue #75.

## Key facts that make most of these cheap

- **Shared coordinate space.** Live position samples and every bundle GeoJSON layer
  are in the **same meters space** that `RoombaMap.tsx` already projects via
  `project([x,y])`. Overlays reuse the existing transform.
- **Shared room identifier.** Live `region_id`, bundle room `feature.id`, and
  `rooms_metadata.room_id` are the **same** id — overlays join on it.
- **Bundle already fully persisted.** The poller stores `parse_map_bundle(raw)` (a dict
  of **every** file in the bundle) into `roomba_map.geojson`. So any bundle-derived
  overlay whose file is present (`policyZones`, `coverage`, `trajectories`, `furniture`,
  `hazard`, `floorTypes`) is likely **already in the DB** — those are frontend-only work.

---

## 1. LIVE moving robot dot (+ heading)

| Column | Detail |
|---|---|
| **Feature** | Live moving robot dot with heading arrow |
| **Dashboard value** | A real-time dot showing the robot's position and facing while it cleans, on top of the static plan. |
| **Method + message/field** | `robot.watch_live_map()` → async generator yielding `PositionUpdateMessage \| MapUpdateMessage`. `PositionUpdateMessage`: `sequence_number`, `updates: list[PositionSample]`, `last_update_timestamp`, `expires_at`. Each `PositionSample` = `point: (x, y)` (meters, same space as plan), `orientation: float` (radians), `operating_modes: int`. Multiple samples/message = short trajectory. Requires `irbt_topic_prefix` (from LoginResult) — raises `RuntimeError` if absent. Subscribes an MQTT topic; keeps robot publishing via periodic `get_live_map_stream()` REST pings paced by `update_expire_ts`. |
| **Read/Write (destructive?)** | Read (non-destructive). |
| **Effort** | **L.** Poller (M): run generator as long-lived task while mission active, store latest `(x, y, orientation, ts)`. Backend (M): expose it. Frontend (S): draw dot + heading arrow via existing `project()`. Delivery-to-browser is the real cost — simplest is poll a `/api/roomba/position` row every 1–2 s during a mission (no websockets); "true live" wants SSE or websocket from backend to browser (backend is Spring → an SSE `SseEmitter` fed by the poller via DB/Redis is least invasive). Library side is asyncio → lives in the Python poller, not Java backend. |
| **Confidence** | **Confirmed live** (jayjay13011, v0.1.11a6 — both message types verified). Everything downstream is new. |
| **Caveats** | (1) `orientation` is the **raw wire angle, unmodified** — the library's only field observation had the arrow pointing out of the *back* of the robot; treat heading as provisional, be ready to add π. (2) Only publishes while keep-alive pings succeed — a silent empty stream is the documented failure mode; surface `_live_map_ping_failures`. (3) Unbounded internal queue; a slow consumer drops oldest. (4) Only meaningful mid-mission; idle robots don't stream. |

## 2. Live occupancy/coverage image (rawmap PNG) — the *other* `watch_live_map` message

| Column | Detail |
|---|---|
| **Feature** | Live occupancy/coverage image (rawmap PNG) |
| **Dashboard value** | The robot's own live-rendered map image (occupancy grid) updating during a run — closer to what the app shows than the static vector plan. |
| **Method + message/field** | Same `watch_live_map()` stream, `MapUpdateMessage`: `livemap_url`, `livemap_url_raw`, `timestamp`. Download `livemap_url_raw` and run `decode_rawmap_to_png(bytes)` → PNG (5 cm/cell grid, already vertically flipped to app orientation). |
| **Read/Write (destructive?)** | Read. |
| **Effort** | **M–L** (rides on #1's stream; adds image fetch/decode + storing/serving a PNG). Needs `Pillow` (deliberately not a hard dep). |
| **Confidence** | **Confirmed** message shape; rawmap layout visually verified (chairstacker). zlib-wrapped payloads handled. |
| **Caveats** | Raster, not vector — won't align pixel-perfect with the SVG plan without extra georeferencing; probably a *separate* view rather than an overlay. Different render than the vector plan already shipped. |

## 3. Room NAMES + types on the map

| Column | Detail |
|---|---|
| **Feature** | Room names + types labelled/styled on the plan |
| **Dashboard value** | Labels ("Kitchen", "Bathroom") and per-type styling on each room polygon. |
| **Method + message/field** | Already-fetched `get_active_map_versions()` → `P2MapVersion.rooms_metadata: list[RoomMetadataEntry]` (`room_id`, `name`, `category: RoomCategory`, `region_type`). Helper `build_room_name_map(map_versions, blid)` → `{room_id: name}`. Also in bundle: `rooms` feature → `RoomFeature.properties.name` / `.room_type` / `.adjacent_room_ids`. Join label to polygon by `feature.id == room_id`; place at polygon centroid. |
| **Read/Write (destructive?)** | Read. |
| **Effort** | **S–M.** Poller persists `rooms_metadata` (currently reads `versions[0]` but keeps only `name`/ids). Frontend computes centroids + draws text. |
| **Confidence** | **Confirmed** (real `rooms_metadata` captured; "Master Bathroom" etc.). |
| **Caveats** | This robot currently has **1 unnamed room**, so nothing shows until rooms are named in the app (or via feature #8). Room *type* has **three encodings** (2100-range ints / 0–8 ints / bundle strings) — use `RoomCategory` strings from the bundle or `category` from metadata; don't cross them. |

## 4. No-go / keep-out zones + virtual walls overlay

| Column | Detail |
|---|---|
| **Feature** | Keep-out / no-mop zones + virtual walls overlay |
| **Dashboard value** | Draws keep-out rectangles, no-mop zones, and virtual-wall lines over the plan. |
| **Method + message/field** | Bundle file `policyZones` → `PolicyZoneFeature`; use `.category` → `PolicyZoneCategory` (`KEEP_OUT_ZONE`, `VIRTUAL_WALL`, `NO_MOP_ZONE`, `THRESHOLD`). Geometry is `Polygon` for zones, `LineString` for virtual walls. |
| **Read/Write (destructive?)** | Read. |
| **Effort** | **S** (frontend-mostly). `policyZones` is a bundle file → if present it's **already in `roomba_map.geojson`**; render `geo.policyZones.features`, style by category. For typed categorization server-side, the poller can map it. |
| **Confidence** | **Confirmed** read side (field-confirmed `policyZones.geojson` present in a real bundle). |
| **Caveats** | Non-obvious rule: a **virtual wall is a `KeepOutZone`-typed feature whose geometry is a `LineString`**, not its own type string — a naive renderer mis-draws it. Presence varies per map (some bundles have no `policyZones` file at all). |

## 5. Per-room clean-score heat overlay

| Column | Detail |
|---|---|
| **Feature** | Per-room clean-score (dirtiness) heat overlay |
| **Dashboard value** | Rooms tinted by how *dirty* they are (time since last cleaned) — a "what needs cleaning" heat map. |
| **Method + message/field** | `robot.get_clean_score_raw(p2map_id)` → parse with `CleanScoreResponse.from_json`. `CleanScoreData.regions: list[CleanScoreRegion]`: `region_id`, `clean_score` (0.0–1.0, **HIGHER = DIRTIER**), `mission_last_cleaned`, `mission_last_unfinished`, `high_traffic_enum`, `smart_clean_prefs`. `clean_score_ranges` (e.g. `[0.7]`) is the "needs cleaning" threshold. Join `region_id == room_id → polygon`. |
| **Read/Write (destructive?)** | Read. |
| **Effort** | **M.** Poller: new periodic fetch. Backend/DB: store per-room scores. Frontend: sequential color scale on room polygons (load the **dataviz** skill for the palette). |
| **Confidence** | **Confirmed live** (@DaRealGuGu, 4 rooms parsed) but the **request body is still "a guess"** per the client docstring, and the meaning of `0.0` (spotless vs unscored) is unresolved. |
| **Caveats** | Field name lies — score is dirtiness, invert for "clean %". `mission_last_unfinished` uniquely tells you which room got skipped (nice secondary signal). |

## 6. Multi-map support

| Column | Detail |
|---|---|
| **Feature** | Multi-map support (switch between saved maps) |
| **Dashboard value** | Switch between multiple saved maps (e.g. floors, "Whole House" vs a sub-map). |
| **Method + message/field** | `get_active_map_versions()` returns a **list** of `P2MapVersion` (`p2map_id`, `name`, `active_p2mapv_id`, `visible`, `state`, `rooms_metadata`, `user_orientation_rad`). Poller currently uses **`versions[0]` only**. |
| **Read/Write (destructive?)** | Read. |
| **Effort** | **M.** Poller: loop all versions, download each bundle, DB keyed by `(robot_id, map_id)`. Backend: return list. Frontend: map switcher. |
| **Confidence** | **Confirmed** — a real account had two ("Whole House", "Master_Bathroom"). |
| **Caveats** | More bundle downloads (bandwidth/rate). Use `visible` to hide inactive maps. Pairs with #7. |

## 7. Apply map orientation to the render

| Column | Detail |
|---|---|
| **Feature** | Apply user map orientation to the render |
| **Dashboard value** | Rotates the plan to match how the user oriented it in the app. |
| **Method + message/field** | `P2MapData.user_orientation_rad` / `P2MapVersion.user_orientation_rad` (radians). Read side of `set_map_orientation`. |
| **Read/Write (destructive?)** | Read. |
| **Effort** | **S** (a rotation in `RoombaMap.tsx`'s projection; poller already can capture the field). |
| **Confidence** | **Confirmed** field exists; note it's **omitted when unset**, default to 0. |
| **Caveats** | Must rotate the live dot (#1) with the same transform or they desync. |

## 8. Write-side: rename room / set category — the SAFE edit

| Column | Detail |
|---|---|
| **Feature** | Rename room / set room category (safe write) |
| **Dashboard value** | Name rooms and set their type from the dashboard (directly enables #3/#5 labels on the currently-unnamed map). |
| **Method + message/field** | `robot.edit_map_checked(p2map_id, SetRoomMetadataV1(room_id, name=..., room_type=RoomCategory.X))` → `MapEditResult`. Envelope `{"command":"set_room_metadata","params":{"room_id":...,"room_metadata":{"name":...,"type":...}}}`. Read `MapEditResult.is_error` / `.is_partial` / `.error` (→ `MapEditingError`). |
| **Read/Write (destructive?)** | **Write. Reversible** (capture old name/`category` first, same capture-then-revert pattern as `verify_map_edit.py`). Low destructiveness. |
| **Effort** | **M** (backend write endpoint w/ auth gating + confirmation UX; the library call is trivial). |
| **Confidence** | **Confirmed live, both directions** (chairstacker: renamed a real room and reverted, verified in the app). The **only** map-edit command with live confirmation. |
| **Caveats** | Gate behind ADMIN + explicit confirm. Handle `is_partial` (edit applied but rendered map not yet regenerated → re-fetch bundle). Distinguish `MapEditingError` groups: INVALID = fix request; NOT-FOUND = re-read map (someone else edited); NOT-NOW (`editAppliedMapNotReady`) = retry unchanged. |

## 9. Write-side: set map name / orientation

| Column | Detail |
|---|---|
| **Feature** | Set whole-map name / save orientation (write) |
| **Dashboard value** | Rename a whole map; save a rotation. |
| **Method + message/field** | `robot.set_map_name(p2map_id, name)`, `robot.set_map_orientation(p2map_id, orientation_rad)`. |
| **Read/Write (destructive?)** | **Write, reversible** (non-destructive). |
| **Effort** | **S** each. |
| **Confidence** | Field names confirmed (match read-side `P2MapData`); **live physical effect not explicitly confirmed** but low risk. |
| **Caveats** | Confirm the response; no capture of these responses exists. |

## 10. Write-side: split / merge rooms, virtual-wall / keep-out edits, delete map — DESTRUCTIVE

| Column | Detail |
|---|---|
| **Feature** | Split/merge rooms, zone/virtual-wall/furniture edits, delete map |
| **Dashboard value** | Full map editing (reshape rooms, add/remove zones, delete a map). |
| **Method + message/field** | `SplitRoomV1` (`split_room`), `MergeRoomsV1` (command is literally `"arrange_room"`), `SetVirtualWallsV1`, `SetPermanentAreasV1` / `DeletePermanentAreasV1`, `AdjustFurnitureV1`, and `robot.delete_map(p2map_id)`. |
| **Read/Write (destructive?)** | **Write. DESTRUCTIVE / irreversible.** |
| **Effort** | **L** (geometry-editing UI) — not recommended for this dashboard. |
| **Confidence** | **Experimental / untested live.** None of these eight commands has been live-confirmed; only resend-unchanged has been tried for zones. |
| **Caveats** | `SetVirtualWallsV1` **replaces the entire `virwall` list** (keep-out + no-mop + virtual walls share one array) — a partial send **deletes every other zone**; the first array element is a **count** that must match. Split/merge can't be undone (boundary info is lost). Thresholds and carpets are only reachable via **V3 MQTT**, which this library **does not implement**. `RenameRoomV1`/`SetRoomTypeV1` are deprecated (RenameRoom returned HTTP 500) — use `SetRoomMetadataV1` (#8) instead. |

---

## Bonus (bundle overlays, all Read, all likely already in the DB)

`coverage` (`CoverageFeature`, MultiPolygon — where it actually cleaned last run),
`trajectories` (`TrajectoryFeature`, LineString — the robot's path), `furniture`
(`FurnitureFeature` — beds/sofas/pet items), `hazard` (`HazardFeature` —
cables/socks/pet-waste points), `floorTypes` (carpet areas). Each is **S**,
frontend-only, **confirmed read models** — good low-cost visual richness.
`floorTypes` is flagged experimental in the library.

---

## Top 3 picks

1. **Room names + types (#3) — do this first.** The keystone: nearly free (data
   already fetched by the poller), and the prerequisite that makes clean-score (#5)
   and the whole map legible. On the current single unnamed map it also motivates
   shipping **the safe rename write (#8) so rooms can be named from your own UI.**
   Confirmed data, S–M effort, unlocks two other features.

2. **No-go / keep-out + virtual-wall overlay (#4).** Highest value-per-effort of the
   pure overlays: the `policyZones` file is likely **already in `roomba_map.geojson`**,
   so essentially frontend-only (S). Confirmed read side. Just implement the
   non-obvious category rule (LineString `KeepOutZone` = virtual wall). Ship bundle #7
   (apply `user_orientation_rad`) alongside — also S, makes every overlay line up with
   the app.

3. **Live moving robot dot (#1).** The biggest "wow" upgrade and the headline of the
   task — a static plan becoming a live view. **Confirmed working in the library** and
   reuses the existing `project()` transform. Rated L only for browser-delivery
   plumbing, so scope pragmatically: start with a `roomba_position` DB row the poller
   updates during a mission + a 1–2 s frontend poll, and graduate to SSE later. Defer
   #2 (rawmap PNG) — a separate raster view that won't overlay cleanly.

**Reasoning:** this ordering front-loads confirmed, low-risk, high-legibility Read
features that compound (names → clean-score → labels-on-live-dot), keeps the one safe
Write (#8) as the only mutation, and treats #10 (split/merge/zone edits/delete) as out
of scope — experimental, irreversible, and partially unreachable without the
unimplemented V3 MQTT path.
