r"""
Roomba V4 / "Prime" cloud poller.

Reads a Roomba's cloud telemetry via `roombapy-prime` on an interval and writes
it straight to Postgres (append-only, mirroring the CoServ sync pattern). This
service is the ONLY holder of iRobot credentials; the Spring backend is a
read-only REST API over the tables this writes.

Every POLL_INTERVAL_SECONDS it:
  * reads the `ro-currentstate` named shadow (live status) + `ro-stats` (lifetime)
  * UPSERTs a single `roomba_status` row (UNIQUE robot_id)
  * detects mission completion and INSERTs one `roomba_runs` row per mission
  * refreshes `roomba_map` (UNIQUE robot_id) when the active map version changes

Robustness contract: fail-open. Any cloud/DB error is logged and swallowed; the
loop never crash-loops. Connection loss triggers a reconnect on the next cycle.

Credentials + config come from env only (never a file):
  IROBOT_EMAIL, IROBOT_PASSWORD, IROBOT_COUNTRY (default US), IROBOT_ROBOT_BLID
  (optional), POLL_INTERVAL_SECONDS (default 60), and POSTGRES_* (same names the
  backend receives).
"""
import asyncio
import contextlib
import hashlib
import json
import logging
import os
import sys
import time
import uuid
from datetime import datetime, timezone

import aiohttp
import psycopg
from psycopg.types.json import Json
from roombapy_prime.auth import login
from roombapy_prime.models.livemap import PositionUpdateMessage
from roombapy_prime.models.map_bundle import parse_map_bundle
from roombapy_prime.models.robot_info import DockState
from roombapy_prime.prime_factory import PrimeFactory
from roombapy_prime.vendor_errors import vendor_error

try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    stream=sys.stdout,
)
log = logging.getLogger("roomba-poller")

# Phases that mean the mission is over. Anything else with a missionId is "running".
TERMINAL_PHASES = {"charge", "stop", "hmPostMsn"}

# Live position (watch_live_map) DB write throttle — the stream can emit many
# samples/sec; we persist at most one row per this many seconds.
LIVE_WRITE_MIN_INTERVAL = 1.0


# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
def _env(name, default=None, required=False):
    val = os.environ.get(name, default)
    if required and not val:
        log.error("Missing required env var %s", name)
        raise SystemExit(2)
    return val


def build_conninfo():
    """psycopg connection string from the POSTGRES_* vars the backend also gets."""
    return psycopg.conninfo.make_conninfo(
        host=_env("POSTGRES_HOST", "postgres"),
        port=_env("POSTGRES_PORT", "5432"),
        dbname=_env("POSTGRES_DB", "homeplatform"),
        user=_env("POSTGRES_USER", "homeplatform"),
        password=_env("POSTGRES_PASSWORD", required=True),
    )


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------
def _payload(obj):
    return getattr(obj, "payload", obj)


def _reported(shadow):
    """state.reported dict out of a named-shadow ShadowResponse."""
    return _payload(shadow).get("state", {}).get("reported", {}) or {}


def _epoch_to_utc(epoch):
    if not epoch:
        return None
    try:
        return datetime.fromtimestamp(int(epoch), timezone.utc)
    except (ValueError, TypeError, OverflowError):
        return None


def _elapsed_min(start_dt, end_dt=None):
    """Whole minutes from a mission's start to now (or end_dt).

    NOTE: `ro-currentstate.runtimeStats.hr` is NOT hours — it's a large internal
    counter (observed hr=496446), so `hr*60+min` produced a nonsense ~29.8M-minute
    value. Mission runtime + run duration are derived from `mssnStrtTm` wall-clock.
    (Lifetime hours come from `ro-stats.bbsys`, which IS hr/min and stays correct.)
    """
    if start_dt is None:
        return None
    end = end_dt or datetime.now(timezone.utc)
    return max(0, int((end - start_dt).total_seconds() // 60))


def _error_text(code):
    """Human-readable title for a robot error code (None when no error)."""
    try:
        code = int(code or 0)
    except (ValueError, TypeError):
        return None
    if code == 0:
        return None
    info = vendor_error(code)
    if info and info.get("title"):
        return info["title"][:255]
    return f"Error {code}"


def _dock_text(state):
    """Friendly label for a dock state code (server may send codes past the enum)."""
    if state is None:
        return None
    try:
        return DockState(int(state)).name.replace("DOCK_", "").replace("_", " ").title()
    except (ValueError, TypeError):
        return f"Dock state {state}"


def _classify(phase, error):
    """roomba_runs.status from the terminal phase + error code."""
    try:
        err = int(error or 0)
    except (ValueError, TypeError):
        err = 0
    if err != 0:
        return "STUCK"
    if phase == "stop":
        return "CANCELLED"
    return "COMPLETED"


def _map_version(rep):
    """Map version pointer carried in the live shadow (mid-mission only)."""
    p2maps = rep.get("p2maps") or []
    if p2maps and isinstance(p2maps[0], dict):
        return p2maps[0].get("p2mapv_id")
    return None


# ---------------------------------------------------------------------------
# Poller state (in-memory dedup + change detection)
# ---------------------------------------------------------------------------
class PollerState:
    def __init__(self):
        self.active = None            # snapshot dict of the currently-running mission
        self.completed_missions = set()  # missionIds already INSERTed this process
        self.last_map_version = None  # last map version successfully persisted
        self.device_synced = False    # static device identity/firmware persisted this process
        self.mission_running = False  # true while a mission is actively cleaning (drives the live-map task)
        self.map_refresh_due = None   # monotonic ts: re-fetch the map bundle soon (set after a map edit)
        self.robot_name = None        # user-assigned name from the account (e.g. "iRummy")


def _snapshot(cms):
    return {
        "mission_id": cms.get("missionId"),
        "started_at": _epoch_to_utc(cms.get("mssnStrtTm")),
        "sqft": cms.get("sqft"),
        "error": cms.get("error", 0),
        "phase": cms.get("phase"),
        "initiator": cms.get("initiator"),
        "cycle": cms.get("cycle"),
        "mission_number": cms.get("nMssn"),
    }


# ---------------------------------------------------------------------------
# DB writes (each opens its own short-lived autocommit connection — simplest
# robust option at a 60s cadence; a dead connection just fails this one cycle)
# ---------------------------------------------------------------------------
def upsert_status(conninfo, robot_id, name, rep, stats, map_version):
    cms = rep.get("cleanMissionStatus") or {}
    _mission_start = _epoch_to_utc(cms.get("mssnStrtTm"))
    _running = bool(cms.get("missionId")) and cms.get("phase") not in TERMINAL_PHASES
    lifetime_missions = None
    lifetime_run_minutes = None
    charge_cycles = None
    charge_errors = None
    fault_text = None
    wear = None
    if stats:
        bbmssn = stats.get("bbmssn") or {}
        bbsys = stats.get("bbsys") or {}
        bbchg = stats.get("bbchg") or {}
        lifetime_missions = bbmssn.get("nMssn")
        if bbsys:
            try:
                lifetime_run_minutes = int(bbsys.get("hr", 0)) * 60 + int(bbsys.get("min", 0))
            except (ValueError, TypeError):
                lifetime_run_minutes = None
        charge_cycles = bbchg.get("nChgOk")
        _ce, _lf = bbchg.get("nChgErr"), bbchg.get("nLithF")
        if _ce is not None or _lf is not None:
            charge_errors = (_ce or 0) + (_lf or 0)
        fault_text = stats.get("unprocessedError")  # free-text fault error==0 misses
        wear = stats.get("bbrun")  # stall/cliff/pickup counters dict, or None

    dock = rep.get("dock") or {}
    dock_state = dock.get("state")

    sql = """
        INSERT INTO roomba_status (
            robot_id, name, battery_pct, phase, cycle, error, error_text, bin_present,
            tank_present, current_mission_id, mission_start, sqft, runtime_minutes,
            dock_state, dock_error, dock_text, not_ready, initiator, detected_pad,
            charge_cycles, charge_errors, fault_text, wear,
            lifetime_missions, lifetime_run_minutes, map_version, raw, updated_at
        ) VALUES (
            %(robot_id)s, %(name)s, %(battery_pct)s, %(phase)s, %(cycle)s, %(error)s,
            %(error_text)s, %(bin_present)s, %(tank_present)s, %(current_mission_id)s,
            %(mission_start)s, %(sqft)s, %(runtime_minutes)s, %(dock_state)s,
            %(dock_error)s, %(dock_text)s, %(not_ready)s, %(initiator)s, %(detected_pad)s,
            %(charge_cycles)s, %(charge_errors)s, %(fault_text)s, %(wear)s,
            %(lifetime_missions)s, %(lifetime_run_minutes)s, %(map_version)s, %(raw)s, NOW()
        )
        ON CONFLICT (robot_id) DO UPDATE SET
            name = EXCLUDED.name,
            battery_pct = EXCLUDED.battery_pct,
            phase = EXCLUDED.phase,
            cycle = EXCLUDED.cycle,
            error = EXCLUDED.error,
            error_text = EXCLUDED.error_text,
            bin_present = EXCLUDED.bin_present,
            tank_present = EXCLUDED.tank_present,
            current_mission_id = EXCLUDED.current_mission_id,
            mission_start = EXCLUDED.mission_start,
            sqft = EXCLUDED.sqft,
            runtime_minutes = EXCLUDED.runtime_minutes,
            dock_state = EXCLUDED.dock_state,
            dock_error = EXCLUDED.dock_error,
            dock_text = EXCLUDED.dock_text,
            not_ready = EXCLUDED.not_ready,
            initiator = EXCLUDED.initiator,
            detected_pad = EXCLUDED.detected_pad,
            charge_cycles = EXCLUDED.charge_cycles,
            charge_errors = EXCLUDED.charge_errors,
            fault_text = EXCLUDED.fault_text,
            wear = EXCLUDED.wear,
            lifetime_missions = EXCLUDED.lifetime_missions,
            lifetime_run_minutes = EXCLUDED.lifetime_run_minutes,
            map_version = EXCLUDED.map_version,
            raw = EXCLUDED.raw,
            updated_at = NOW()
    """
    params = {
        "robot_id": robot_id,
        "name": name,
        "battery_pct": rep.get("batPct"),
        "phase": cms.get("phase"),
        "cycle": cms.get("cycle"),
        "error": cms.get("error", 0),
        "error_text": _error_text(cms.get("error")),
        "bin_present": (rep.get("bin") or {}).get("present"),
        "tank_present": rep.get("tankPresent"),
        "current_mission_id": cms.get("missionId"),
        "mission_start": _mission_start,
        "sqft": cms.get("sqft"),
        "runtime_minutes": _elapsed_min(_mission_start) if _running else None,
        "dock_state": dock_state,
        "dock_error": dock.get("error"),
        "dock_text": _dock_text(dock_state),
        "not_ready": cms.get("notReady"),
        "initiator": cms.get("initiator"),
        "detected_pad": rep.get("detectedPad"),
        "charge_cycles": charge_cycles,
        "charge_errors": charge_errors,
        "fault_text": fault_text,
        "wear": Json(wear) if wear is not None else None,
        "lifetime_missions": lifetime_missions,
        "lifetime_run_minutes": lifetime_run_minutes,
        "map_version": map_version,
        "raw": Json(rep),
    }
    with psycopg.connect(conninfo, autocommit=True) as conn:
        conn.execute(sql, params)


def run_exists(conninfo, started_at):
    """DB-level dedup marker: a run with this source+start already persisted.

    roomba_runs has no mission_id column, so started_at (= mssnStrtTm) is the
    stable per-mission marker that survives process restarts.
    """
    if started_at is None:
        return False
    with psycopg.connect(conninfo, autocommit=True) as conn:
        row = conn.execute(
            "SELECT 1 FROM roomba_runs WHERE source = %s AND started_at = %s LIMIT 1",
            ("roombapy-prime", started_at),
        ).fetchone()
    return row is not None


def insert_run(conninfo, snap, status):
    started = snap.get("started_at")
    completed = datetime.now(timezone.utc)
    duration = _elapsed_min(started, completed)
    err = snap.get("error", 0)
    sql = """
        INSERT INTO roomba_runs (
            started_at, completed_at, duration_minutes, dirt_events, square_feet,
            status, mission_id, mission_number, error, error_text, initiator, cycle,
            source, source_provider, ingestion_batch_id
        ) VALUES (
            %s, %s, %s, NULL, %s, %s, %s, %s, %s, %s, %s, %s,
            'roombapy-prime', 'irobot', %s
        )
    """
    with psycopg.connect(conninfo, autocommit=True) as conn:
        conn.execute(
            sql,
            (
                started, completed, duration, snap.get("sqft"), status,
                snap.get("mission_id"), snap.get("mission_number"),
                err, _error_text(err), snap.get("initiator"), snap.get("cycle"),
                str(uuid.uuid4()),
            ),
        )


def upsert_device(conninfo, robot_id, sku, series, family, serial, firmware):
    sql = """
        INSERT INTO roomba_device (robot_id, sku, series, family, serial_number, firmware, updated_at)
        VALUES (%s, %s, %s, %s, %s, %s, NOW())
        ON CONFLICT (robot_id) DO UPDATE SET
            sku = EXCLUDED.sku, series = EXCLUDED.series, family = EXCLUDED.family,
            serial_number = EXCLUDED.serial_number, firmware = EXCLUDED.firmware, updated_at = NOW()
    """
    with psycopg.connect(conninfo, autocommit=True) as conn:
        conn.execute(sql, (robot_id, sku, series, family, serial, firmware))


async def sync_device(robot, conninfo, robot_id):
    """Fetch static identity (serial/sku/series/family) + firmware once and persist."""
    info = await robot.get_serial_number_data()
    firmware = None
    try:
        swrep = _reported(await robot.get_named_shadow("rw-software", timeout=8.0))
        sub = swrep.get("subModSwVer") or {}
        firmware = sub.get("con") or swrep.get("softwareVer")  # controller ver = installed
    except Exception as e:  # noqa: BLE001 — firmware is a nice-to-have
        log.debug("rw-software read failed: %s: %s", type(e).__name__, e)
    upsert_device(
        conninfo, robot_id,
        getattr(info, "sku", None), getattr(info, "series", None),
        getattr(info, "family", None), getattr(info, "serial_number", None), firmware,
    )


def load_map_version(conninfo, robot_id):
    with psycopg.connect(conninfo, autocommit=True) as conn:
        row = conn.execute(
            "SELECT map_version FROM roomba_map WHERE robot_id = %s", (robot_id,)
        ).fetchone()
    return row[0] if row else None


def upsert_map(conninfo, robot_id, map_id, map_version, name, geojson):
    sql = """
        INSERT INTO roomba_map (robot_id, map_id, map_version, name, geojson, updated_at)
        VALUES (%s, %s, %s, %s, %s, NOW())
        ON CONFLICT (robot_id) DO UPDATE SET
            map_id = EXCLUDED.map_id,
            map_version = EXCLUDED.map_version,
            name = EXCLUDED.name,
            geojson = EXCLUDED.geojson,
            updated_at = NOW()
    """
    with psycopg.connect(conninfo, autocommit=True) as conn:
        conn.execute(sql, (robot_id, map_id, map_version, name, Json(geojson)))


def upsert_position(conninfo, robot_id, x, y, theta):
    """UPSERT the latest live position (UNIQUE robot_id). x/y meters, theta radians."""
    sql = """
        INSERT INTO roomba_position (robot_id, x, y, theta, updated_at)
        VALUES (%s, %s, %s, %s, NOW())
        ON CONFLICT (robot_id) DO UPDATE SET
            x = EXCLUDED.x,
            y = EXCLUDED.y,
            theta = EXCLUDED.theta,
            updated_at = NOW()
    """
    with psycopg.connect(conninfo, autocommit=True) as conn:
        conn.execute(sql, (robot_id, x, y, theta))


# ---------------------------------------------------------------------------
# Live position stream (concurrent task, shares the single robot connection)
# ---------------------------------------------------------------------------
async def run_live_map(robot, conninfo, robot_id):
    """Stream live position from watch_live_map() and UPSERT the latest point
    (throttled to ~1/sec) into roomba_position.

    Runs as a CONCURRENT task over the SAME robot connection as the main loop —
    it opens no second cloud connection. Strictly fail-open: every error is
    logged and swallowed so it can never crash the poller; the task simply ends
    (no dot) and the main loop restarts it on the next mission / reconnect.
    Cancelled cleanly on disconnect (watch_live_map()'s own finally unsubscribes).

    Field names come straight from roombapy_prime.models.livemap:
      PositionUpdateMessage.updates : list[PositionSample]
      PositionSample.point          : (x, y)  meters
      PositionSample.orientation    : float   radians (raw wire heading)
    MapUpdateMessage (the other stream shape) is ignored — we only want the dot.
    """
    last_write = 0.0
    try:
        async for msg in robot.watch_live_map():
            try:
                if not isinstance(msg, PositionUpdateMessage) or not msg.updates:
                    continue
                now = time.monotonic()
                if now - last_write < LIVE_WRITE_MIN_INTERVAL:
                    continue  # throttle DB writes; keep only ~1 sample/sec
                sample = msg.updates[-1]  # newest point in this trajectory-like message
                x, y = sample.point
                upsert_position(conninfo, robot_id, x, y, sample.orientation)
                last_write = now
            except Exception as e:  # noqa: BLE001 — one bad sample must not end the stream
                log.warning("live position sample failed: %s: %s", type(e).__name__, e)
    except asyncio.CancelledError:
        raise
    except RuntimeError as e:
        # watch_live_map() raises RuntimeError when irbt_topic_prefix is absent —
        # degrade gracefully (no dot) rather than break anything.
        log.info("live position stream unavailable (no dot): %s", e)
    except Exception as e:  # noqa: BLE001 — fail-open; a new task starts on reconnect
        log.warning("live position stream ended (%s: %s)", type(e).__name__, e)


async def _cancel_live_task(task):
    """Cancel + await the live-map task, swallowing whatever it ends with."""
    if task is None:
        return
    if not task.done():
        task.cancel()
    with contextlib.suppress(asyncio.CancelledError, Exception):
        await task


async def _manage_live_task(task, robot, conninfo, state):
    """Start the live-map task while a mission is running, stop it otherwise, and
    replace a task that has finished/failed. Returns the current task handle."""
    running = bool(state.mission_running)
    alive = task is not None and not task.done()
    if running and not alive:
        if task is not None:
            await _cancel_live_task(task)  # clear a finished/failed handle first
        log.info("Mission running — starting live-position stream")
        return asyncio.ensure_future(run_live_map(robot, conninfo, robot.blid))
    if not running and task is not None:
        if alive:
            log.info("Mission ended — stopping live-position stream")
        await _cancel_live_task(task)
        return None
    return task


# ---------------------------------------------------------------------------
# Mission completion detection
# ---------------------------------------------------------------------------
def detect_completion(state, rep, conninfo):
    """Compare this poll's cleanMissionStatus to the last-seen running mission
    and INSERT a roomba_runs row on a running->terminal transition or a
    missionId change. Dedup: in-memory set + DB existence check on started_at.
    """
    cms = rep.get("cleanMissionStatus") or {}
    cur_mid = cms.get("missionId")
    cur_phase = cms.get("phase")
    cur_error = cms.get("error", 0)
    cur_running = bool(cur_mid) and cur_phase not in TERMINAL_PHASES

    prev = state.active
    completed = None
    status = None

    if prev is not None:
        same_mission = (cur_mid == prev["mission_id"]) or (not cur_mid)
        if same_mission and cur_phase in TERMINAL_PHASES:
            # Prefer current terminal cms values if still populated for this mission.
            completed = dict(prev)
            if cur_mid == prev["mission_id"] and cms.get("sqft") is not None:
                completed["sqft"] = cms.get("sqft")
            status = _classify(cur_phase, cur_error or prev.get("error"))
        elif cur_mid and cur_mid != prev["mission_id"]:
            # Jumped straight to a new mission; the previous one finished unseen.
            completed = dict(prev)
            status = _classify(None, prev.get("error"))

    if completed and completed.get("mission_id") not in state.completed_missions:
        started = completed.get("started_at")
        try:
            if run_exists(conninfo, started):
                log.info(
                    "Mission %s already persisted (started %s); skipping",
                    completed.get("mission_id"), started,
                )
            else:
                insert_run(conninfo, completed, status)
                log.info(
                    "Recorded mission %s status=%s sqft=%s duration=%smin",
                    completed.get("mission_id"), status,
                    completed.get("sqft"), completed.get("runtime_minutes"),
                )
            state.completed_missions.add(completed.get("mission_id"))
        except Exception as e:  # noqa: BLE001 — fail-open
            log.warning("Failed to record mission %s: %s: %s",
                        completed.get("mission_id"), type(e).__name__, e)
        state.active = None
        # A finished mission means the robot has regenerated its floor plan — schedule a
        # prompt bundle re-fetch (same one-shot the map-edit path uses) so the newly
        # learned map lands in roomba_map within ~MAP_REFRESH_AFTER_RUN s rather than on
        # the next status poll (up to 300s later on the NUC). refresh_map's version check
        # makes this a cheap no-op if the robot hasn't bumped the map version yet.
        state.map_refresh_due = time.monotonic() + MAP_REFRESH_AFTER_RUN

    # Refresh / set the active snapshot for the currently-running mission.
    if cur_running:
        state.active = _snapshot(cms)
    elif completed is not None:
        state.active = None


async def refresh_map(robot, conninfo, robot_id, state, shadow_version):
    """Fetch + persist the map bundle when the active map version changes."""
    try:
        versions = await robot.get_active_map_versions()
    except Exception as e:  # noqa: BLE001
        log.warning("get_active_map_versions failed: %s: %s", type(e).__name__, e)
        return

    if not (isinstance(versions, list) and versions):
        return
    v0 = versions[0]
    map_id = v0.get("p2map_id") or v0.get("p2mapId")
    map_version = v0.get("active_p2mapv_id") or shadow_version
    name = v0.get("name")
    if not (map_id and map_version):
        return

    # The robot can mutate the active map — newly discovered area, added/renamed
    # rooms — WITHOUT bumping active_p2mapv_id, so gating the refresh on the version
    # string alone silently misses those changes (the downloaded bundle *does*
    # reflect them). Fold the room metadata into the dedup key so any content change
    # triggers a re-download. A bare stored version (pre-signature, or after a
    # restart) never matches a signature, so we re-fetch once and self-heal.
    sig_src = json.dumps(v0.get("rooms_metadata") or v0, sort_keys=True, default=str)
    map_sig = f"{map_version}:{hashlib.sha1(sig_src.encode('utf-8')).hexdigest()[:12]}"

    if state.last_map_version is None:
        # Lazily learn what's already persisted so we don't refetch on restart.
        try:
            state.last_map_version = load_map_version(conninfo, robot_id)
        except Exception as e:  # noqa: BLE001
            log.warning("load_map_version failed: %s: %s", type(e).__name__, e)

    if map_sig == state.last_map_version:
        return

    try:
        link = await robot.get_map_geojson_link(map_id, map_version)
        url = link.get("map_url") if isinstance(link, dict) else None
        if not url:
            log.warning("No map_url in geojson link for %s/%s", map_id, map_version)
            return
        raw = await robot.download_map_bundle(url)
        parsed = parse_map_bundle(raw)
        upsert_map(conninfo, robot_id, map_id, map_version, name, parsed)
        state.last_map_version = map_sig
        log.info("Updated map %s version=%s sig=%s (%d bytes)", map_id, map_version, map_sig[-12:], len(raw))
    except Exception as e:  # noqa: BLE001
        log.warning("Map refresh failed: %s: %s", type(e).__name__, e)


# ---------------------------------------------------------------------------
# Cloud connection + main loop
# ---------------------------------------------------------------------------
async def connect_robot(session, email, password, country, blid, state):
    # Log in ourselves so we can read the user-assigned robot name (which lives in
    # the account's robot list, not on the PrimeRobot object), then hand the same
    # login result to the factory to avoid a second login round-trip.
    login_result = await login(session, email, password, country)
    robot = await PrimeFactory.create_prime_robot(
        session=session, username=email, password=password,
        country_code=country, blid=blid or None, login_result=login_result,
    )
    await robot.connect(timeout=15.0)
    try:
        target = blid or login_result.primary_blid()
        entry = login_result.robots.get(target)
        raw_name = getattr(entry, "name", None) if entry else None
        state.robot_name = raw_name.strip() if isinstance(raw_name, str) and raw_name.strip() else None
    except Exception as e:  # noqa: BLE001 — name is a nice-to-have, never fatal
        log.debug("robot name lookup failed: %s: %s", type(e).__name__, e)
    log.info("Connected to Roomba '%s' (BLID %s)", state.robot_name or "?", robot.blid)
    return robot


async def poll_once(robot, conninfo, state):
    """One read/write cycle. Raises only on connection loss (caller reconnects)."""
    cur = await robot.get_named_shadow("ro-currentstate", timeout=10.0)
    rep = _reported(cur)

    stats = {}
    try:
        stats = _reported(await robot.get_named_shadow("ro-stats", timeout=10.0))
    except Exception as e:  # noqa: BLE001 — lifetime stats are non-critical
        log.warning("ro-stats read failed: %s: %s", type(e).__name__, e)

    shadow_version = _map_version(rep)
    name = state.robot_name or getattr(robot, "name", None)
    robot_id = robot.blid

    # Drives the concurrent live-position task (started only mid-mission).
    _cms = rep.get("cleanMissionStatus") or {}
    state.mission_running = bool(_cms.get("missionId")) and _cms.get("phase") not in TERMINAL_PHASES

    if not state.device_synced:
        try:
            await sync_device(robot, conninfo, robot_id)
            state.device_synced = True
        except Exception as e:  # noqa: BLE001
            log.warning("device sync failed: %s: %s", type(e).__name__, e)

    try:
        upsert_status(conninfo, robot_id, name, rep, stats,
                      state.last_map_version or shadow_version)
    except Exception as e:  # noqa: BLE001
        log.warning("upsert_status failed: %s: %s", type(e).__name__, e)

    try:
        detect_completion(state, rep, conninfo)
    except Exception as e:  # noqa: BLE001
        log.warning("detect_completion failed: %s: %s", type(e).__name__, e)

    await refresh_map(robot, conninfo, robot_id, state, shadow_version)


# ---------------------------------------------------------------------------
# Control commands (poller executes what the backend enqueued into roomba_commands)
# ---------------------------------------------------------------------------
CMD_TICK_SECONDS = 5
# After a map edit applies, re-fetch the map bundle this many seconds later — enough
# for the robot to regenerate the rendered map, far sooner than the next status poll
# (POLL_INTERVAL_SECONDS, 300s on the NUC). Keeps the floor plan from lagging ~5 min.
MAP_REFRESH_AFTER_EDIT = 12
# Same idea after a mission finishes: the robot regenerates its floor plan (new map
# version) at the end of a run, so schedule a prompt bundle re-fetch instead of waiting
# up to a full poll cycle for the version bump to be noticed. Slightly longer than the
# edit delay to give the robot time to publish the finalized map.
MAP_REFRESH_AFTER_RUN = 25
SIMPLE_COMMANDS = {"start", "stop", "pause", "resume", "dock", "find", "evac"}
RENAME_ROOM = "rename_room"
SPLIT_ROOM = "split_room"
MERGE_ROOMS = "merge_rooms"
CLEAN_ROOM = "clean_room"


def _fetch_pending(conninfo, limit=5):
    with psycopg.connect(conninfo, autocommit=True) as conn:
        return conn.execute(
            "SELECT id, command, arg FROM roomba_commands "
            "WHERE status = 'PENDING' ORDER BY id LIMIT %s",
            (limit,),
        ).fetchall()


def _mark_command(conninfo, cmd_id, status, detail=None, terminal=True):
    with psycopg.connect(conninfo, autocommit=True) as conn:
        if terminal:
            conn.execute(
                "UPDATE roomba_commands SET status = %s, detail = %s, processed_at = NOW() WHERE id = %s",
                (status, (detail[:500] if detail else None), cmd_id),
            )
        else:
            conn.execute("UPDATE roomba_commands SET status = %s WHERE id = %s", (status, cmd_id))


async def _run_favorite(robot, favorite_id):
    """Replay a saved favorite/zone by id. Unvalidated on hardware (we have 0 favorites
    yet) — kept best-effort; any failure is caught and marked FAILED by the caller."""
    from roombapy_prime.models.mission_control import MissionCommandType, RoutineCommand
    cmd = RoutineCommand(
        command_type=MissionCommandType.START,
        asset_id=robot.blid,
        favorite_id=favorite_id,
        initiator="rmtApp",
    )
    await robot.send_routine_command_via_cmd_topic(cmd)


async def _active_p2map_id(robot):
    """Current active p2map_id, or None. Map edits target a specific map id."""
    versions = await robot.get_active_map_versions()
    if not (isinstance(versions, list) and versions):
        return None
    return versions[0].get("p2map_id") or versions[0].get("p2mapId")


async def _rename_room(robot, conninfo, arg, state):
    """Rename a mapped room (and optionally set its category) via the map-edit API.

    Uses SetRoomMetadataV1 → edit_map_checked — the ONLY map edit that's been
    live-confirmed on hardware (both rename + revert), and it's reversible. The
    JSON `arg` (built + validated by the backend) carries {room_id, name?, type?}.

    Returns (ok, detail). On success the local map-version cache is cleared so the
    next poll re-fetches the bundle and the new name shows on the floor plan.
    """
    from roombapy_prime.models.enums_common import RoomCategory
    from roombapy_prime.models.map_editing import SetRoomMetadataV1

    try:
        params = json.loads(arg or "{}")
    except (ValueError, TypeError):
        return False, "bad rename payload"
    room_id = params.get("room_id")
    name = params.get("name")
    rtype = params.get("type")
    if not room_id:
        return False, "missing room_id"

    room_type = None
    if rtype:
        try:
            room_type = RoomCategory(rtype)  # snake_case wire value, e.g. "living_room"
        except ValueError:
            room_type = None  # unknown category → ignore rather than fail the rename
    if name is None and room_type is None:
        return False, "nothing to change"

    # Resolve the current map id fresh — the edit targets a specific p2map_id.
    p2map_id = await _active_p2map_id(robot)
    if not p2map_id:
        return False, "no active map"

    cmd = SetRoomMetadataV1(room_id=str(room_id), name=name, room_type=room_type)
    return await _apply_map_edit(robot, p2map_id, cmd, state)


async def _split_room(robot, conninfo, arg, state):
    """Divide a mapped room in two along a user-drawn line (adds a "section").

    EXPERIMENTAL — never validated on hardware and NOT cleanly reversible (the
    library maintainer's own verify tool refuses to test it for that reason).
    Same transport as rename (edit_map_checked); the risk is the robot's
    acceptance + the self-derived split geometry.

    `arg` JSON: {room_id, points: [[x, y], [x, y], ...]} in the map's meter space.
    SplitRoomV1 flattens the points into split_points [x1, y1, x2, y2, ...].
    """
    from roombapy_prime.models.map_editing import SplitRoomV1

    try:
        params = json.loads(arg or "{}")
    except (ValueError, TypeError):
        return False, "bad split payload"
    room_id = params.get("room_id")
    raw_points = params.get("points")
    if not room_id:
        return False, "missing room_id"
    if not isinstance(raw_points, list) or len(raw_points) < 2:
        return False, "need at least two points for the divide line"
    points = []
    for p in raw_points:
        if not (isinstance(p, (list, tuple)) and len(p) >= 2):
            return False, "malformed point"
        try:
            points.append((float(p[0]), float(p[1])))
        except (ValueError, TypeError):
            return False, "non-numeric point"

    p2map_id = await _active_p2map_id(robot)
    if not p2map_id:
        return False, "no active map"

    cmd = SplitRoomV1(room_id=str(room_id), split_points=points)
    return await _apply_map_edit(robot, p2map_id, cmd, state)


async def _merge_rooms(robot, conninfo, arg, state):
    """Combine two or more mapped rooms into one (the inverse of a divide).

    EXPERIMENTAL, same caveats as split. `arg` JSON: {room_ids: [...]}. No geometry
    — MergeRoomsV1 just takes the ids under the (confusingly named) "arrange_room"
    command.
    """
    from roombapy_prime.models.map_editing import MergeRoomsV1

    try:
        params = json.loads(arg or "{}")
    except (ValueError, TypeError):
        return False, "bad merge payload"
    ids = params.get("room_ids")
    if not isinstance(ids, list) or len(ids) < 2:
        return False, "need at least two rooms to merge"
    ids = [str(i) for i in ids if i is not None and str(i).strip()]
    if len(ids) < 2:
        return False, "need at least two rooms to merge"

    p2map_id = await _active_p2map_id(robot)
    if not p2map_id:
        return False, "no active map"

    cmd = MergeRoomsV1(ids=ids)
    return await _apply_map_edit(robot, p2map_id, cmd, state)


async def _apply_map_edit(robot, p2map_id, cmd, state):
    """Send a map-edit command and interpret the MapEditResult. On success (or
    partial) clears the map-version cache so the next poll re-fetches the bundle.
    Returns (ok, detail)."""
    result = await robot.edit_map_checked(p2map_id, cmd)
    if result.is_error:
        # MapEditingError groups: NOT_FOUND (stale id, re-read), INVALID (bad request),
        # NOT_NOW (transient) — surface the code so the UI can explain the failure.
        err = result.error.name if result.error else result.error_code
        msg = (result.error_message or "").strip()
        return False, f"robot refused ({err}){': ' + msg if msg else ''}"
    # Success, or partial: edit applied but the rendered map hasn't regenerated yet.
    # Clear the cache AND schedule a soon map re-fetch so the UI updates in seconds,
    # not at the next 5-minute status poll.
    state.last_map_version = None
    state.map_refresh_due = time.monotonic() + MAP_REFRESH_AFTER_EDIT
    return True, "applied; map updating shortly" if result.is_partial else "applied"


async def _clean_room(robot, conninfo, arg):
    """Clean ONE specific room (region clean). CONFIRMED working on a Combo 105.

    `arg` JSON: {room_id, suction?: 1-4, passes?: "one"|"two", mode?: 2|4|6}.
    mode = operatingMode command value (vendor codec): 2=vacuum, 4=mop, 6=vac+mop.

    SAFETY — this exact shape is load-bearing (see the library's
    send_routine_command_via_cmd_topic docstring): it MUST use command_type=START
    (never CLEAN) and a real map_id (never None) with a RID region + an initiator,
    or the robot cleans the WHOLE HOUSE instead of the requested room. Those are
    hardcoded here; only room_id + optional suction/passes come from the caller.
    """
    from roombapy_prime.models.mission_control import (
        CommandParams,
        MissionCommandType,
        Region,
        RegionType,
        RoutineCommand,
    )

    try:
        params = json.loads(arg or "{}")
    except (ValueError, TypeError):
        return False, "bad clean payload"
    room_id = params.get("room_id")
    if not room_id:
        return False, "missing room_id"

    p2map_id = await _active_p2map_id(robot)
    if not p2map_id:
        # Required: a null map_id turns a room clean into a whole-house clean.
        return False, "no active map"

    cp_kwargs = {}
    suction = params.get("suction")
    if suction is not None:
        try:
            lvl = int(suction)
            if 1 <= lvl <= 4:
                cp_kwargs["suction_level"] = lvl
        except (ValueError, TypeError):
            pass
    passes = params.get("passes")
    if passes == "two":
        cp_kwargs["two_pass"] = True
    elif passes == "one":
        cp_kwargs["two_pass"] = False
        cp_kwargs["no_auto_passes"] = True
    mode = params.get("mode")
    if mode is not None:
        try:
            m = int(mode)
            if m in (2, 4, 6):  # vendor codec: vacuum / mop / vac+mop
                cp_kwargs["operating_mode"] = m
        except (ValueError, TypeError):
            pass
    cparams = CommandParams(**cp_kwargs) if cp_kwargs else None

    region = Region(region_id=str(room_id), region_type=RegionType.RID, params=cparams)
    cmd = RoutineCommand(
        command_type=MissionCommandType.START,  # NOT CLEAN
        asset_id=robot.blid,
        map_id=p2map_id,                          # NOT None
        regions=[region],
        initiator="rmtApp",                       # mandatory (presence, not value)
    )
    ok = await robot.send_routine_command_via_cmd_topic(cmd)
    return (True, "clean started") if ok else (False, "broker rejected")


async def process_commands(robot, conninfo, state):
    """Execute PENDING control commands through the shared robot connection. 'OK' means
    the broker accepted it — NOT that the robot necessarily acted (phantom-mission case)."""
    try:
        pending = _fetch_pending(conninfo)
    except Exception as e:  # noqa: BLE001 — table may not exist yet at first boot
        log.debug("command fetch skipped: %s: %s", type(e).__name__, e)
        return
    for cmd_id, command, arg in pending:
        try:
            _mark_command(conninfo, cmd_id, "SENT", terminal=False)  # claim → no double-send on restart
        except Exception:
            continue
        try:
            if command in SIMPLE_COMMANDS:
                ok = await robot.send_simple_command(command)
                _mark_command(conninfo, cmd_id, "OK" if ok else "FAILED",
                              "accepted by broker" if ok else "broker rejected")
            elif command == "favorite":
                await _run_favorite(robot, arg)
                _mark_command(conninfo, cmd_id, "OK", f"favorite {arg} sent")
            elif command == RENAME_ROOM:
                ok, detail = await _rename_room(robot, conninfo, arg, state)
                _mark_command(conninfo, cmd_id, "OK" if ok else "FAILED", detail)
            elif command == SPLIT_ROOM:
                ok, detail = await _split_room(robot, conninfo, arg, state)
                _mark_command(conninfo, cmd_id, "OK" if ok else "FAILED", detail)
            elif command == MERGE_ROOMS:
                ok, detail = await _merge_rooms(robot, conninfo, arg, state)
                _mark_command(conninfo, cmd_id, "OK" if ok else "FAILED", detail)
            elif command == CLEAN_ROOM:
                ok, detail = await _clean_room(robot, conninfo, arg)
                _mark_command(conninfo, cmd_id, "OK" if ok else "FAILED", detail)
            else:
                _mark_command(conninfo, cmd_id, "FAILED", f"unknown command: {command}")
            log.info("command #%s (%s) processed", cmd_id, command)
        except Exception as e:  # noqa: BLE001 — fail-open, never crash the loop
            log.warning("command #%s (%s) failed: %s: %s", cmd_id, command, type(e).__name__, e)
            try:
                _mark_command(conninfo, cmd_id, "FAILED", f"{type(e).__name__}: {e}")
            except Exception:
                pass


async def main():
    email = _env("IROBOT_EMAIL", required=True)
    password = _env("IROBOT_PASSWORD", required=True)
    country = _env("IROBOT_COUNTRY", "US")
    blid = _env("IROBOT_ROBOT_BLID")
    try:
        interval = max(5, int(_env("POLL_INTERVAL_SECONDS", "60")))
    except (ValueError, TypeError):
        interval = 60
    conninfo = build_conninfo()
    state = PollerState()

    log.info("Roomba poller starting (poll every %ss, command tick %ss)", interval, CMD_TICK_SECONDS)

    async with aiohttp.ClientSession() as session:
        robot = None
        live_task = None
        last_poll = 0.0
        while True:
            try:
                if robot is None:
                    robot = await connect_robot(session, email, password, country, blid, state)
                    last_poll = 0.0  # poll immediately after (re)connect
                # Commands are latency-sensitive → checked every tick; status polls on interval.
                await process_commands(robot, conninfo, state)
                now = time.monotonic()
                if now - last_poll >= interval:
                    await poll_once(robot, conninfo, state)
                    last_poll = now
                # A recent map edit asked for a prompt bundle re-fetch — do it once the
                # short settle delay has passed (poll_once above may already have, which
                # makes this a cheap no-op via the version check in refresh_map).
                if state.map_refresh_due is not None and now >= state.map_refresh_due:
                    state.map_refresh_due = None
                    await refresh_map(robot, conninfo, robot.blid, state, None)
                # Keep the concurrent live-position task in sync with mission state.
                live_task = await _manage_live_task(live_task, robot, conninfo, state)
            except asyncio.CancelledError:
                await _cancel_live_task(live_task)
                live_task = None
                raise
            except Exception as e:  # noqa: BLE001 — fail-open, reconnect next cycle
                log.warning("Cycle failed (%s: %s); will reconnect", type(e).__name__, e)
                await _cancel_live_task(live_task)  # tied to this connection — drop it
                live_task = None
                state.mission_running = False
                if robot is not None:
                    try:
                        await robot.disconnect()
                    except Exception:
                        pass
                robot = None
            await asyncio.sleep(CMD_TICK_SECONDS)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        sys.exit(130)
