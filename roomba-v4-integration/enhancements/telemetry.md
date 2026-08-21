# Roomba 105 Combo (G284020) — Candidate Telemetry/Status/Maintenance Additions

**Method of investigation:** read the actual installed `roombapy-prime==0.3.0b7` source. The key insight for effort estimates: our poller (`roomba-poller/poller.py`) **already fetches two shadows every cycle** — `ro-currentstate` (into the `rep` dict) and `ro-stats` (into `stats`) — but surfaces only ~12 fields from them. A large fraction of the additions below are **already in a payload we fetch and throw away** → they are S-effort (add a column + DTO field + UI, no new network call). New REST calls or the `rw-settings` shadow are M. Truly unconfirmed endpoints are L.

Source shorthand:
- `ro-currentstate` → parse with `models.robot_info.CurrentStateShadow.from_json(rep)` — **already polled**
- `ro-stats` → `StatsShadow.from_json(stats)` — **already polled**
- `rw-settings` → `get_settings()` → `RobotSettings.from_json(...)` — **not polled**
- REST → `get_robot_parts()`, `get_serial_number_data()`, `get_firmware_raw()` — **not polled**
- `rw-software` / `ro-configinfo` → `get_named_shadow(...)` — **not polled**

Repo cross-check: the installed `b7` is one step newer than the GitHub `johnnyh1975/roombapy-prime` README's documented `b6`; the installed source is authoritative and was used for all field paths below.

---

## A. Consumable / part life

| Feature | Dashboard value | Source (method → field path) | R/W | Effort | Confidence | Caveats |
|---|---|---|---|---|---|---|
| **Consumable parts life (filter, brushes, pad, evacs)** | Per-part "X% / N missions remaining" maintenance tiles — the headline maintenance feature | `get_robot_parts()` → `RobotPartsInfo.parts[]` → each `RobotPart{part_id, count_type, count_remaining, count_used, minutes_remaining, counter_category, reset_by}` | R | **M** | **confirmed-in-lib** (real live response) | New REST call + new `roomba_parts` table (it's a list). `count_type` seen: `combo_missions`, `pad_washes_used`, `minutes`, `evacs`. `minutes_remaining = -1` when not time-based. Which exact parts a G284020 reports is device-specific — render whatever comes back. |
| **Filter life as a percentage** | Single "filter 63%" gauge — the *only* native %-based consumable figure in the whole library | `get_settings()` → `RobotSettings.filter_pack` → `FilterPackStatus{pct_left, last_reset_time}` (wire: `filterStatus.pctLeft`) | R | **M** | **beta** (declared/native-confirmed; SMART-tier, no G284020 capture) | Requires the `rw-settings` shadow, which the poller doesn't fetch and which **times out intermittently** on some devices (see `get_settings` docstring). Pairs with `get_robot_parts` — may duplicate the filter part row. |
| **Pad-wash counter** | "Pad washed N times since reset" | `get_robot_parts()` → part with `count_type="pad_washes_used"` | R | S (once parts table exists) | confirmed-in-lib | Combo-only; comes free with the parts call above. |
| **Detected mop pad type** | Shows which pad is installed (e.g. `padPlate`) vs. "no pad" | `ro-currentstate` → `rep["detectedPad"]` (`CurrentStateShadow.detected_pad`) | R | **S** | confirmed-in-lib (live on our robot per FINDINGS) | Already in the `rep` dict we poll; just not persisted. String enum, surface raw. |

## B. Battery health / charge cycles

| Feature | Dashboard value | Source | R/W | Effort | Confidence | Caveats |
|---|---|---|---|---|---|---|
| **Charge-cycle count + charge errors** | Battery-aging signal ("2 cycles" now → trend over years); `nChgErr>0` flags a charging fault | `ro-stats` → `stats["bbchg"]` → `BbChgStats{n_chg_ok, n_chg_err, n_lith_f, aborts, smberr}` | R | **S** | **confirmed-in-lib** (real values, e.g. `nChgOk=561`) | **Already fetched** in `stats` — poller reads only `bbmssn`/`bbsys`. `nLithF` = lithium failure count (wear/safety signal). |
| **Powered-on hours meter** | Lifetime operating hours (distinct from lifetime *run* minutes we already show) | `ro-stats` → `stats["bbsys"]` → `BbSysStats{hours, minutes}` | R | **S** | confirmed-in-lib | We already compute `lifetime_run_minutes` from `bbsys`. **Caveat (explicit in lib):** this is powered-on time, NOT time-since-purchase — do not label it "age". |
| **Battery manufacturer + rated-life + cycle count** | Deep battery-health card (`cCount` cycles vs `mLife` rated life) | `get_named_shadow("ro-configinfo")` → `ConfigInfoShadow.bat_info` → `BatInfo{c_count, m_life, m_name, m_date}` | R | **M** | **uncertain** (declared from app 3.0.0; absent from every capture the maintainer holds) | May simply not be sent by this SKU — parses to `None` silently. Placement confirmed, presence not. |
| **Battery-estimate stats** | "Avg run minutes per charge", est. capacity | `ro-stats` → `stats["bbchg3"]` → `BbChg3Stats{avg_minutes, est_capacity, n_docks, hours_on_dock}` | R | S | beta (fields absent in the one real capture; `nAvail`/`hOnDock` seen) | Already fetched; several fields firmware-dependent and may be `None`. |

## C. WiFi signal strength

| Feature | Dashboard value | Source | R/W | Effort | Confidence | Caveats |
|---|---|---|---|---|---|---|
| **WiFi RSSI / signal strength** | Signal bars | — no confirmed field — | R | — | **uncertain / likely unavailable** | **No RSSI/`rssi`/`snr` field exists anywhere in the V4 shadows or models.** `cap["5ghz"]` is a *capability* flag (band support), not signal. `wlan0HwAddr` (in `ro-configinfo.hwPartsRev`) is the MAC, not strength. Closest available is **connection liveness** (below), not signal quality. Recommend dropping this ask for V4. |
| **Online / connected status** | "Robot online" dot | `get_named_shadow("rw-constatus")` → `ConnectionStatusShadow{connected, connected_v2}`; or `ro-currentstate.last_disconnect` | R | S–M | confirmed-in-lib | We already derive `online` from status freshness; `rw-constatus` gives an authoritative MQTT-connected bool. `last_disconnect` is in the `rep` dict we already poll. |

## D. Firmware version + SKU details

| Feature | Dashboard value | Source | R/W | Effort | Confidence | Caveats |
|---|---|---|---|---|---|---|
| **SKU / series / family / serial identity** | Device-info header ("Roomba Combo, G2, G284020, SN …") | `get_serial_number_data()` → `RobotSerialInfo{sku, series, family, serial_number, is_refurbished}` | R | **M** | **confirmed-in-lib** (real live response) | One REST call, static — fetch once and cache, not every poll. We already captured this manually in FINDINGS. |
| **Installed firmware version** | "Firmware 9.3.7" + OTA state | `get_named_shadow("rw-software")` → `SoftwareStatusShadow{software_version, last_sw_update, deployment_state}` + `sub_module_versions{con, nav, linux, mcu}` | R | **M** | **confirmed-in-lib** (real capture) | Firmware is **not** in `ro-currentstate`/`get_state` (confirmed absent). Prefer `sub_module_versions.con` over the deployment-package name (records ship version, not installed). `deployment_state` int enum meaning unconfirmed. |
| **Available firmware releases** | "Update available" badge | `get_firmware_raw(sku)` | R | **L** | **uncertain** (method + envelope both unconfirmed) | Must pass SKU explicitly (no `self.sku`). Response shape unknown — treat as exploratory. |
| **Capability flags (feature gating)** | Hide UI for features this unit lacks (mop lift, auto-evac, scrub, heated wash) | `get_state()` → `state.reported.cap` → `CapabilityFlags` (36 fields) + `digiCap` | R | M | confirmed-in-lib (live) | Values are graduated ints, not bools — a `0` means "cannot"; nonzero level meaning is per-field. Static; fetch once. |

## E. Human-readable error / notReady decoding

| Feature | Dashboard value | Source | R/W | Effort | Confidence | Caveats |
|---|---|---|---|---|---|---|
| **Decoded robot error (title + fix-it text)** | Turns `error: 26` into **"Vacuum motor is stalled — filter may be clogged; tap it out"** in 8 languages | `CleanMissionStatus.error_text` → `vendor_errors.vendor_error(code)` → `{title, content}` | R | **S** | **confirmed-in-lib** (112-code vendor catalogue, transcribed from app 3.0.0) | **Error code already polled** (`rep.cleanMissionStatus.error`) — this is a pure local lookup, zero network. `@val` placeholder = robot name; substitute or leave. Returns `None` for undocumented codes (surface "error N, undocumented"). |
| **`notReady` / `condNotReady` reasons** | "Can't start: bin full / on a cliff" pre-flight status | `ro-currentstate` → `rep.cleanMissionStatus["notReady"]` (int) + `["condNotReady"]` (list) → `CleanMissionStatus.not_ready / cond_not_ready` | R | **S** | confirmed-in-lib (fields live); **beta** for a decode table | Already in the polled `rep`. The lib models the values but there's no packaged `notReady`-code→text table like `vendor_error` — you'd show the raw code or build a small map. |
| **Pre-mission readiness verdict** | "Ready to clean" vs blocked, before sending a command | `get_settings()` → `RobotSettings.precheck` → `PrecheckStatus{readiness, readiness_time}` | R | M | uncertain (declared; no capture) | `rw-settings` shadow; may be `None`. |
| **Stats-shadow "unprocessed" fault string** | Catches faults `cleanMissionStatus.error` reports as 0 | `ro-stats` → `stats["unprocessedError"]` → `StatsShadow.unprocessed_error` | R | S | confirmed-in-lib (real value `"picea unknown fault code:2105"`) | **Already fetched.** Free-text, not a code; show verbatim. |

## F. Dock / auto-empty (evac) + mop/pad state

| Feature | Dashboard value | Source | R/W | Effort | Confidence | Caveats |
|---|---|---|---|---|---|---|
| **Full dock status decoded** | "Dock: emptying bin", "Bag full", "Pad washing", "Clean-water tank removed" instead of a bare number | `ro-currentstate` → `rep["dock"]` → `DockStatus{state, pw_state, pd_state, error, tank_lvl, fw_version}`, each resolved via the 86-value `DockState` enum + `DockStatus.error_text` | R | **S** | **confirmed-in-lib** (live; 86 codes extracted) | **`rep["dock"]` already polled** — poller keeps only `dock.state` as an int. `state=302`=evacuating, `353`=bag full, `pw_state`/`pd_state` cover wash/dry. **Server sends codes past the enum** (e.g. `671`) — handle unknowns. `tank_lvl` (clean-water %) only on some docks. |
| **Auto-evac frequency / evac counter** | "Empties every 2nd run", lifetime evac count | `get_settings().autoevac_freq` (needs `cap.autoevac` to interpret); evac count via `get_robot_parts()` `count_type="evacs"` | R | M | confirmed-in-lib | Freq needs the cap level to pick the valid value set (see `RobotSettings.autoevac_freq` docstring). |
| **Mop tank + pad-wetness/wash settings** | "Tank present", pad-wetness level, pad-wash/dry schedule | `rep["tankPresent"]` (already shown); `get_settings()` → `pad_wetness`, `pad_wash_return`, `pad_wash_heat`, `pad_dry_duration` | R | S (tank) / M (settings) | tank: confirmed-live; pad settings: beta (SMART-tier, mop-specific) | Tank already surfaced. Pad-wash *dock* capability is gated by `dock.cap.pw/pd` — a G284020 with `pw:1` won't expose heat. |
| **Detergent level/capability** | Detergent tile (combo docks) | `rep["detergent"]` and/or `rep.dock.detergent` → `CurrentStateShadow.detergent` | R | S | uncertain (two vendor sources disagree on placement; read both) | Already in `rep`; may be `None` on this dock. |

## G. "Stuck / needs attention" derivations

| Feature | Dashboard value | Source | R/W | Effort | Confidence | Caveats |
|---|---|---|---|---|---|---|
| **Wear-fault counters (stalls, cliffs, pickups, stuck events)** | "Stuck 4× this month", brush/wheel stall trends — predictive maintenance | `ro-stats` → `stats["bbrun"]` → `BbRunStats{n_stuck, n_mb_stll, n_rb_stll, n_w_stll, n_cliffs_f, n_picks, n_slips, n_panics, n_optical_dd, n_piezo_dd}` (16 counters) | R | **S** | **beta** (declared app 3.0.0; not yet in any capture, but same call we make) | **Already fetched** in `stats` if the robot sends `bbrun` — cross-checked against Classic `bbrun`. May be absent on this firmware → `None`. |
| **Navigation-reset / OOM counters** | "Robot rebooted mid-clean / ran out of memory" reliability signal | `ro-stats` → `stats["bbrstinfo"]` → `BbRstInfoStats{n_nav_rst, n_oom_rst, n_map_load_rst}` | R | S | confirmed-in-lib (`nNavRst=22` real) | Already fetched; `n_nav_rst` confirmed, OOM/map-load fields firmware-dependent. |
| **Derived "needs attention" flag** | One boolean tile combining: `error≠0` OR `dock.error≠0` OR `notReady≠0` OR bin/tank missing OR any part `count_remaining≈0` | Composite of the above, all in payloads already/soon fetched | R | S–M | confirmed (inputs confirmed) | Pure backend derivation; no new source. Highest-value rollup for a glanceable dashboard. |
| **Per-mission vac/mop split + evacs (run history enrichment)** | For each run: minutes vacuuming vs mopping, sqft, evac count, pad used | `MissionHistoryEntry{run_m, sqft, evacs, pad_category, mode_breakdown vac/mop}` | R | **L** | confirmed-in-lib model, **but** `get_mission_history()` REST returns `[]` for this V4 robot | Data must instead be **reconstructed from live `cleanMissionStatus` transitions** (as the poller already does for runs). The richer per-mode split is not observable that way — leave for a future timeline (`request_mission_timeline`) path. |

---

## Top 3 picks for the home dashboard

1. **Decoded error + dock-status text (§E, §F) — do this first.** It is **S-effort with zero new network calls**: the error code and the entire `dock{}` object are already inside the `ro-currentstate` payload the poller fetches every cycle and discards. `vendor_error()` and the `DockState` enum turn "error 26 / dock 353" into "Vacuum motor stalled — clean the filter" and "Dock bag full." This is the single biggest jump in usefulness per line of code, and it directly delivers the "stuck/needs attention" ask.

2. **Consumable parts life via `get_robot_parts()` (§A).** This is the marquee *maintenance* capability and the whole reason to go beyond a status card — filter/brush/pad/evac life with remaining counts, **confirmed against real hardware**. It's M-effort (one new REST call + a `roomba_parts` child table) but it's the feature a homeowner actually acts on. Pair with `filter_pack.pct_left` if the `rw-settings` fetch proves reliable on this unit.

3. **Charge cycles + wear counters from `ro-stats` (§B, §G).** Also **S-effort — already fetched.** We read `bbmssn`/`bbsys` from the `stats` payload and ignore `bbchg` (charge cycles, lithium-fail count) and `bbrun` (stuck/stall/cliff counters). Surfacing these gives a battery-aging trend and a reliability history for free, and feeds the composite "needs attention" flag.

**One thing to explicitly drop:** WiFi signal strength (§C). There is no RSSI/signal field anywhere in the V4 protocol — `cap.5ghz` is band capability, not signal. Offer "online/offline" (from `rw-constatus` or freshness) instead and don't promise signal bars.

---

## Key files referenced (all read-only, nothing modified)

- Installed library: `...\scratchpad\roomba-venv\Lib\site-packages\roombapy_prime\`
  - `prime_robot.py` — public methods (`get_robot_parts`, `get_serial_number_data`, `get_settings`, `get_firmware_raw`, `get_named_shadow`, `poll_echo_value`, etc.)
  - `models\robot_info.py` — all shadow/parts/stats/settings models (`CurrentStateShadow`, `CleanMissionStatus`, `DockStatus`+`DockState` enum, `StatsShadow` + `BbChgStats`/`BbRunStats`/`BbSysStats`/`BbRstInfoStats`, `RobotPartsInfo`/`RobotPart`, `RobotSerialInfo`, `RobotSettings`+`FilterPackStatus`/`PrecheckStatus`, `SoftwareStatusShadow`, `ConfigInfoShadow`+`BatInfo`, `CapabilityFlags`)
  - `vendor_errors.py` — 112-code vendor catalogue + `vendor_error(code, language="en") -> {title, content} | None`
  - `models\mission_history.py` — `MissionHistoryEntry`
- Current coverage: `roomba-poller\poller.py`, `backend\src\main\java\com\homeplatform\dto\RoombaStatusResponse.java`, `roomba-v4-integration\FINDINGS.md`
