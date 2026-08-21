# Roomba V4 (roombapy-prime) — candidate additions for richer run/mission history

Research report (READ-ONLY investigation). Authoritative source: installed
`roombapy_prime` library .py files + GitHub johnnyh1975/roombapy-prime README & issue #75.

## Orienting facts that reframe the whole question

1. **`get_mission_history` is not dead — it was empty because our robot is fresh.**
   The endpoint (`GET /v1/{blid}/missionhistory`) is confirmed working on *other*
   accounts: jouwdan's Max 705 returned 30 parsed missions, utkjmitch had a 49-mission
   archive, another tester 128 missions (issue #75). On our G284020 it returned `[]`
   (probe #1/#2) simply because a days-old robot has little/no cloud-retained history,
   and the one 400 was specifically `maxAge=31536000` (1-year value exceeds a server cap).
   So the REST endpoint is the **proper historical source**, and it returns *the entire
   rich model below in one call* — the run row **and** its per-room timeline are the same
   object (`MissionHistoryEntry.timeline` = `finEvents`).

2. **The MQTT mission timeline is a LIVE stream, not a history query.**
   `request_mission_timeline()` publishes fine but **an idle robot never answers**
   (jouwdan: publish accepted, 0 reports in 35s on an idle robot — a clean negative).
   Reports are tied to an active/just-finished mission. So `watch_mission_timeline` is a
   *live progress* source that mirrors the same event model
   (`MissionTimelineReport.finEvents/futureEvents`), **not** a backfill for old runs.
   Our probe #2 *did* catch a live mission, so this path is usable today even while REST
   history is empty.

3. **The installed `DoneCode` enum (0.3.0b7) is WRONG.** Issue #75's correction: robots
   send abbreviated camelCase (`ok, busy, dndEnd, returnHomeEnd, timeboxEnd, cncl, usrSlp,
   plcDoc, usrEnd, usrSpt, batcncl`), **not** the snake_case values shipped in this
   version (`return_home_end`, `battery_cancel`, `user_sleep`…). Only `"ok"` is confirmed
   to match. `_enum_or_none()` means a mismatch silently returns the raw string, so nothing
   crashes — but every non-"ok" done code would fall through as an unmapped string. **Any
   done-code feature must ship its own corrected mapping or upgrade to ≥b9.**

Clean-score API note: the `get_clean_score_raw` docstring header says `POST` but the code
actually issues **`GET /v1/p2maps/clean-score?p2map_id=`** (confirmed at rest_client.py
line 1305) — the GET form is the one field-confirmed live.

---

## Candidate additions

### 1. Per-room clean events + coverage
- **What it adds:** A run breaks down into rooms: which rooms, how much of each got cleaned, how each visit ended.
- **Exact method + fields:** `get_mission_history()` → `parse_mission_history()` → `entry.timeline` (`MissionTimelineEvent`) → `.room` (`RoomEvent`): `region_id`, `coverage` (fraction actually done), `area`/`total_area`, `pass_count`, `status` (→ `RoomStatus` enum). Live equivalent: `watch_mission_timeline()` → `MissionTimelineReport.fin_events`.
- **Read/Write:** Read
- **Effort:** M
- **Confidence:** beta
- **Caveats:** `coverage` is model/firmware-dependent: jouwdan's 30 missions had populated timelines but **all `coverage`/`dirt` None**. `RoomStatus` (0–8) confirmed from app 3.0.0; the interesting ones: `1 FINISHED_WITH_MORE_PASSES`, `8 SKIPPED_WILL_RETURN`, `4 KIDNAPPED`. Room *names* aren't here — join `region_id` → map metadata `rooms_metadata[]`. On our robot: only via live `watch_mission_timeline` until REST history populates.

### 2. done_code → human "why it ended"
- **What it adds:** Replaces our coarse COMPLETED/STUCK/CANCELLED with a real reason: battery, user-ended, timebox, DND, returned-home, place-on-dock, etc.
- **Exact method + fields:** `entry.done_code` (+ `done_raw`, `error_code`).
- **Read/Write:** Read
- **Effort:** S
- **Confidence:** uncertain
- **Caveats:** **Installed enum values are wrong (issue #75).** Ship our own map: `ok`→completed, `cncl`/`usrEnd`→user-cancelled, `battery`/`batcncl`→low-battery, `stuck`→stuck, `timeboxEnd`→time-limit, `dndEnd`→quiet-hours, `returnHomeEnd`/`plcDoc`→docked. Only `ok` is source-confirmed. Pairs well with our existing phase observation rather than replacing it.

### 3. FaultScene for errors
- **What it adds:** Turns a bare `error_code` into "dock problem" vs "robot problem" per running task.
- **Exact method + fields:** `FaultScene.scene_for(command, cycle, phase)` — derived client-side from `cleanMissionStatus` (phase/cycle) + `rw-software.lastCommand`.
- **Read/Write:** Read
- **Effort:** S
- **Confidence:** uncertain
- **Caveats:** Robot never sends a scene field — it's *derived*. Only 5 of 12 scenes have rules (`evac/wash/dry/refill/dock`); the other 7 (incl. the default `cleanTask`) return None. Our flat error catalogue has no scene today.

### 4. Vacuum vs mop split (oModeStats)
- **What it adds:** For our **Combo G284020**: how many minutes/sqft were vacuum vs mop within one run.
- **Exact method + fields:** `entry.o_mode_stats` (raw dict, e.g. `{"vac":{"nMin":10,"sqft":90}}`).
- **Read/Write:** Read
- **Effort:** S
- **Confidence:** beta
- **Caveats:** Raw dict — inner keys are mode names (`vac` seen; `mop`/`vacMop` plausible, unseen). Present in real entries though absent from iRobot's own app model. Directly relevant to a Combo.

### 5. Four real duration fields
- **What it adds:** Distinguishes wall-clock from actual cleaning; explains "40-min run that only cleaned 10 min".
- **Exact method + fields:** `entry.duration_m` (wall), `minutes_running` (`runM`), `minutes_paused` (`pauseM`), `minutes_charging` (`chrgM`).
- **Read/Write:** Read
- **Effort:** S
- **Confidence:** confirmed
- **Caveats:** Confirmed on real data (chairstacker). Our current `duration_minutes` is effectively wall-clock (`runtimeStats` or completed−start); `runM` is the truer "cleaning time." Cheap upgrade to the existing column set.

### 6. Who/why the run started (initiator)
- **What it adds:** "cloud/schedule vs app vs Alexa vs dock button" per run.
- **Exact method + fields:** `entry.command.initiator` (`MissionCommandRecord`) + `Initiator` enum (25 values). **Already available live** in `ro-currentstate…cleanMissionStatus.initiator` (our probe #2 saw `rmtApp`).
- **Read/Write:** Read
- **Effort:** S
- **Confidence:** beta
- **Caveats:** Enum from app 3.0.0; only `cloud`/`rmtApp` seen in captures. We can capture this **today** from the shadow we already poll — no history dependency.

### 7. Per-room dirtiness / clean score
- **What it adds:** A per-room "needs cleaning" heatmap; which room was last cleaned / left unfinished.
- **Exact method + fields:** `get_clean_score_raw(p2map_id)` → `CleanScoreResponse` → `clean_scores[].regions[]` (`CleanScoreRegion`): `clean_score` (0.0–1.0, **HIGHER = DIRTIER**, accumulated), `mission_last_cleaned`, `mission_last_unfinished`, `smart_clean_prefs`; top-level `clean_score_ranges` (threshold, e.g. `[0.7]`).
- **Read/Write:** Read
- **Effort:** M
- **Confidence:** beta
- **Caveats:** **Not a per-run metric** — it's carried-forward dirtiness state (the "Dirt Detective" data), so you can't attribute a score to one run *except* via the `mission_last_cleaned`/`mission_last_unfinished` `{missionId,nMssn,startTime}` pointers. Endpoint is **GET ?p2map_id=** (confirmed live, 4 rooms, DaRealGuGu). Name is misleading — automations from the name alone invert the meaning. On our robot: only 1 unmapped room so far, so thin until more rooms map.

### 8. Live per-room progress (timeline stream)
- **What it adds:** Real-time "cleaning room X, 60% done, next room Y" while a mission runs.
- **Exact method + fields:** `watch_mission_timeline()` (needs `irbt_topic_prefix`) → `MissionTimelineReport`: `fin_events` (done) + `future_events` (still intended) + `travel`/`room`/`polygon` sub-events; optionally `request_mission_timeline()` to nudge during a mission.
- **Read/Write:** Read (MQTT)
- **Effort:** L
- **Confidence:** beta (live) / uncertain (backfill)
- **Caveats:** **MQTT stream, live-only.** Idle robot won't answer a request (confirmed negative). Confirmed live during an active mission (chairstacker). Reconnect/token-refresh plumbing is nontrivial (async generators, queue backpressure). This is the *bridge* that gets us per-room data **now** while REST history is empty — persist `fin_events` at mission end.

### 9. Estimated time-to-clean (expected vs actual)
- **What it adds:** Predicted per-room / per-mode minutes to compare against actual `runM`.
- **Exact method + fields:** `get_time_estimates()` (body `{"robot_id": blid}`) → `TimeEstimates`: `by_region`, `by_zone`, `cleaning_rates{deep,light,standard}`; `TimeEstimate.seconds`, `.best(**params)`.
- **Read/Write:** Read
- **Effort:** M
- **Confidence:** confirmed
- **Caveats:** Confirmed live (DaRealGuGu N185240). **Forward-looking, not history** — tangential, but enables an "expected vs actual" column on each run. One estimate **per room per param-combo** (44 for one room), no whole-mission total (sum the rooms), `deviation` always 0.0 so no usable confidence.

### 10. Travel / evac / pad-wash / polygon sub-events
- **What it adds:** Rich mid-mission narrative: recharge trips, bin evacuations, pad washes, area cleaned per polygon.
- **Exact method + fields:** Same `entry.timeline` events: `TravelEvent` (+`TravelReason`: 12 values, 5 are routine errands not endings), `EvacEvent`, `PadWashEvent` (+`PadWashReason`), `PolygonEvent.area_cleaned`, `number_of_evacuations` (`evacs`), `number_of_dirt_detects` (`dirt`).
- **Read/Write:** Read
- **Effort:** M–L
- **Confidence:** beta
- **Caveats:** 20 sub-event types, most confirmed via decompilation, many field names corrected against real data (session 31). `dirt`/`evacs` often None on some firmware. `TravelReason` matters: treating any travel as "mission ended" is the classic bug the enum guards against. Highest effort, lowest incremental value vs #1.

---

## Mission timeline vs our phase-observation approach — explicit trade-off

**Our current approach** (poll `ro-currentstate.cleanMissionStatus`, dedup on
`mssnStrtTm`/`missionId`, detect phase leaving `run`):
- Pros: works **today** on our robot, robust, no `irbt_topic_prefix` dependency, no MQTT
  stream plumbing, gives the run skeleton (start/end/duration/sqft/status).
- Cons: no per-room detail, no "why it ended" beyond phase/error inference, no
  coverage/pass data.

**`watch_mission_timeline` (MQTT):**
- Pros: the real per-room `RoomEvent`/`TravelEvent`/done reason, live *and* end-of-mission;
  `future_events` gives "what's next."
- Cons: live-only (no historical backfill — idle robot silent); heavier plumbing (async
  reconnect, token refresh, queue); needs `irbt_topic_prefix`; still beta.

**`get_mission_history` (REST):**
- Pros: the **proper** historical source — full run list *plus* embedded timeline
  (`finEvents` with `RoomEvent`s), done_code, `oModeStats`, 4 minute fields — in one paged
  call; survives restarts; no live-window constraint.
- Cons: returns `[]` on our fresh robot right now; `maxAge` has an undiscovered server cap
  (avoid year-scale values); done_code enum wrong in this version.

**Recommendation:** keep phase-observation as the always-on skeleton; layer
`watch_mission_timeline` to enrich runs *as they happen*; adopt `get_mission_history` for
backfill/authoritative detail once the robot accrues cloud history (poll it periodically
and reconcile on `missionId`).

---

## Top 3 picks

1. **Live per-room coverage via `watch_mission_timeline` → persist `RoomEvent`s + done
   reason at mission end (#8 + #1 + #2).** This is the one path that delivers the headline
   "richer history" (per-room coverage, why-it-ended) **on our actual robot today**, since
   REST history is empty but we already catch live missions. It naturally feeds the same
   schema the REST backfill will later fill. Ship a *corrected* done-code map (issue #75)
   with it.

2. **`get_mission_history` backfill as the authoritative source, wired but tolerant of
   empty (#1/#2/#4/#5/#6/#10 in one call).** Every rich field is one REST call away and
   it's the durable, restart-safe record. Effort is mostly the reconcile logic; the model
   is already parsed for us by the library. Add columns for `done_code`, `run_minutes`,
   `o_mode_stats`, `initiator`, then treat empty `[]` as "no cloud history yet," not
   failure. Use a modest `maxAge` (days, not years) to dodge the 400 cap. When it
   populates, it supersedes the live-captured rows via `missionId` match.

3. **Per-room dirtiness heatmap via `get_clean_score_raw` (#7).** Confirmed working live
   (GET `?p2map_id=`), and it's **independent of mission-history being empty** — it answers
   "which room needs cleaning" right now. Just model it honestly: higher = dirtier,
   accumulated state, and attribute to runs only through its
   `mission_last_cleaned`/`mission_last_unfinished` pointers. Thin on our 1-room robot
   today, but zero-cost to light up as rooms map.

**Runners-up deliberately left out of the top 3:** time-estimates (#9) is confirmed and
valuable but is prediction, not history (better as an "expected vs actual" enhancement
once #1 lands); FaultScene (#3) and the full 20 sub-event set (#10) are high-effort polish
that only pay off after the core per-room pipeline exists.

---

## Source files read (all absolute)

- `...\roomba-venv\Lib\site-packages\roombapy_prime\prime_robot.py`
- `...\roombapy_prime\models\mission_history.py` (RoomEvent/RoomStatus/DoneCode/Initiator/FaultScene/MissionHistoryEntry/MissionTimelineReport)
- `...\roombapy_prime\models\map_bundle.py` (CleanScoreRegion/CleanScoreData/CleanScoreResponse)
- `...\roombapy_prime\models\time_estimates.py`
- `...\roombapy_prime\rest_client.py` (get_mission_history / get_time_estimates / get_clean_score_raw)
- `...\roombapy_prime\mqtt_client.py` (mission_timeline_topic / request_mission_timeline / rejected_report_topic)
- `C:\code-repos\claude-repos\home-automation\roomba-v4-integration\FINDINGS.md`
- `C:\code-repos\claude-repos\home-automation\backend\src\main\java\com\homeplatform\dto\RoombaRunResponse.java`
- GitHub: johnnyh1975/roombapy-prime README + issue #75
