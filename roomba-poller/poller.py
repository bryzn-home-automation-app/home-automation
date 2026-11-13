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
  * syncs the cloud's mission history over `roomba_runs` (see sync_history)

It also runs the dashboard's queued commands (`roomba_commands`). A Postgres NOTIFY
wakes it the moment one is queued; it sends over the existing cloud link when that link
has just proved itself, and then reads the robot's state back until it reacts (see
command_flow.py for the rules and CommandRunner below for the I/O).

Robustness contract: fail-open. Any cloud/DB error is logged and swallowed; the
loop never crash-loops. Connection loss triggers a reconnect on the next cycle.

Credentials + config come from env only (never a file):
  IROBOT_EMAIL, IROBOT_PASSWORD, IROBOT_COUNTRY (default US), IROBOT_ROBOT_BLID
  (optional), POLL_INTERVAL_SECONDS (default 60), and POSTGRES_* (same names the
  backend receives).
"""
import asyncio
import contextlib
import gzip
import hashlib
import io
import json
import logging
import tarfile
import os
import sys
import time
import uuid
from datetime import datetime, timedelta, timezone

import aiohttp
import psycopg
from psycopg.types.json import Json
from roombapy_prime.auth import login
from roombapy_prime.models.livemap import MapUpdateMessage, PositionUpdateMessage
from roombapy_prime.models.map_bundle import parse_map_bundle
from roombapy_prime.models.robot_info import DockState
from roombapy_prime.prime_factory import PrimeFactory
from roombapy_prime.vendor_errors import vendor_error

import coverage_passes
import dock_issues
from command_flow import (
    CMD_TICK_SECONDS,
    CONFIRMED,
    DONE,
    FRESH,
    NO_FOLLOW_UP,
    PROBE_TIMEOUT,
    RESEND,
    RESEND_SAFE,
    ROBOT_COMMANDS,
    SENT,
    STALE_SENT_SECONDS,
    START_COMMANDS,
    STATUS_READ_TIMEOUT,
    SWEEP_SECONDS,
    UNCONFIRMED,
    REFUSED,
    WAIT,
    WATCH,
    CommandTiming,
    FollowUp,
    failure_backoff,
    link_decision,
    link_down_detail,
    loop_sleep,
    mission_signature,
    mission_under_way,
    no_reaction_detail,
    no_reaction_hint,
    reaction_expected,
    robot_reacted,
    timing_line,
)

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
# The live-position stream also follows the robot home after the mission (hmPostMsn),
# although the run ends there: its last position should be where it stopped, on the dock
# or wherever it gave up on the way, not where it finished cleaning.
LIVE_AFTER_MISSION_PHASES = {"hmPostMsn"}

# Live position (watch_live_map) DB write throttle — the stream can emit many
# samples/sec; we persist at most one row per this many seconds (LivePositionWriter).
LIVE_WRITE_MIN_INTERVAL = 1.0
# How long the end of a stream waits for its last position to be written.
LIVE_FINAL_WRITE_TIMEOUT = 5.0
# Live cleaning-coverage refresh throttle. The coverage layer only needs to grow
# every few seconds, and each update downloads + untars the live-map bundle, so
# process at most one MapUpdateMessage per this many seconds.
COVERAGE_WRITE_MIN_INTERVAL = 12.0
# Pass count (coverage_passes): the twice-over area the map draws, and the full
# grid kept so a restart mid-clean carries on (~85 KB of JSON for a whole-house
# two-pass clean), are written at most this often.
PASSES_WRITE_MIN_INTERVAL = 15.0


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


def _wants_live_position(cms):
    """Whether the live-position stream should run: a mission under way, or the trip home
    after one. It stops once the robot is docked (charge) or stopped (stop)."""
    phase = cms.get("phase")
    return bool(cms.get("missionId")) and (phase not in TERMINAL_PHASES or phase in LIVE_AFTER_MISSION_PHASES)


def _recharging(cms):
    """Docked to recharge partway through a mission. The robot resumes the same
    missionId once charged (a whole-house clean here takes ~2 recharge stops), so
    this is NOT the end of the run even though "charge" is a terminal phase. At a
    real mission end the cycle drops back to "none"."""
    return cms.get("phase") == "charge" and (cms.get("cycle") or "none") != "none"


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
        self.mission_running = False  # true while a mission is under way or the robot heads home after one (drives the live-map task and the fast poll)
        self.map_refresh_due = None   # monotonic ts: re-fetch the map bundle soon (set after a map edit)
        self.robot_name = None        # user-assigned name from the account (e.g. "iRummy")
        self.fast_poll_until = 0.0    # monotonic ts: poll at the fast cadence until this time (set after a mission-starting command)
        self.last_parts_at = None     # monotonic ts of the last successful parts refresh (None = never → due now)
        self.parts_refresh_due = None # monotonic ts: re-read the part counters soon (set after a run completes)
        self.unsaved_runs = {}        # mission_id -> (run dict, status) whose DB write failed; retried each poll
        self.history_due = 0.0        # monotonic ts: next mission-history sync (0 = now)
        self.history_backfilled = False  # first sync of this process asks for the full history
        # Pass count for the running mission (coverage_passes.PassGrid). Lives here,
        # not in the live-map task: that task stops on a pause or recharge and is
        # restarted on every reconnect, and the count must carry on across all three.
        self.passes = None
        self.passes_written = (-1, 0.0)  # (grid version, monotonic ts) of the last write
        self.passes_error_at = 0.0       # last logged pass-count failure (rate-limits the warning)


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
    dock_issue, dock_issue_code = dock_issues.dock_issue(dock)

    # dock_issue_since: when the dock's current complaint began. Kept while the same complaint
    # stands, restarted when it changes, cleared with it; the backend alerts once per start.
    sql = """
        INSERT INTO roomba_status (
            robot_id, name, battery_pct, phase, cycle, error, error_text, bin_present,
            tank_present, current_mission_id, mission_start, sqft, runtime_minutes,
            dock_state, dock_error, dock_text, not_ready, initiator, detected_pad,
            charge_cycles, charge_errors, fault_text, wear,
            lifetime_missions, lifetime_run_minutes, map_version, raw, updated_at,
            dock_issue, dock_issue_code, dock_issue_since
        ) VALUES (
            %(robot_id)s, %(name)s, %(battery_pct)s, %(phase)s, %(cycle)s, %(error)s,
            %(error_text)s, %(bin_present)s, %(tank_present)s, %(current_mission_id)s,
            %(mission_start)s, %(sqft)s, %(runtime_minutes)s, %(dock_state)s,
            %(dock_error)s, %(dock_text)s, %(not_ready)s, %(initiator)s, %(detected_pad)s,
            %(charge_cycles)s, %(charge_errors)s, %(fault_text)s, %(wear)s,
            %(lifetime_missions)s, %(lifetime_run_minutes)s, %(map_version)s, %(raw)s, NOW(),
            %(dock_issue)s, %(dock_issue_code)s,
            CASE WHEN %(dock_issue)s::varchar IS NULL THEN NULL ELSE NOW() END
        )
        ON CONFLICT (robot_id) DO UPDATE SET
            dock_issue = EXCLUDED.dock_issue,
            dock_issue_code = EXCLUDED.dock_issue_code,
            dock_issue_since = CASE
                WHEN EXCLUDED.dock_issue IS NULL THEN NULL
                WHEN roomba_status.dock_issue_since IS NOT NULL
                     AND roomba_status.dock_issue IS NOT DISTINCT FROM EXCLUDED.dock_issue
                     AND roomba_status.dock_issue_code IS NOT DISTINCT FROM EXCLUDED.dock_issue_code
                    THEN roomba_status.dock_issue_since
                ELSE EXCLUDED.dock_issue_since
            END,
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
        "dock_issue": dock_issue,
        "dock_issue_code": dock_issue_code,
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


def replace_parts(conninfo, robot_id, parts):
    """Full replace of a robot's roomba_parts rows (a part the cloud stops reporting
    must disappear too, not linger from an earlier read). One transaction."""
    with psycopg.connect(conninfo, autocommit=False) as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM roomba_parts WHERE robot_id = %s", (robot_id,))
            for p in parts:
                part_id = getattr(p, "part_id", None)
                if not part_id:
                    continue
                cur.execute(
                    "INSERT INTO roomba_parts (robot_id, part_id, count_type, counter, "
                    "count_remaining, count_used, minutes_remaining, counter_category, "
                    "reset_by, last_updated_at, updated_at) "
                    "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())",
                    (
                        robot_id, str(part_id), getattr(p, "count_type", None),
                        getattr(p, "counter", None), getattr(p, "count_remaining", None),
                        getattr(p, "count_used", None), getattr(p, "minutes_remaining", None),
                        getattr(p, "counter_category", None), getattr(p, "reset_by", None),
                        _epoch_to_utc(getattr(p, "last_updated_ts", None)),
                    ),
                )
        conn.commit()


async def refresh_parts(robot, conninfo, robot_id, state, force=False):
    """Read the consumable / maintenance counters (the record behind the iRobot
    app's Maintenance screen) and replace roomba_parts. Cloud REST only — never
    touches the robot. Fail-open: a failed read is retried sooner than the normal
    cadence, so a table that doesn't exist yet on first boot self-heals."""
    now = time.monotonic()
    if not force and state.last_parts_at is not None and now - state.last_parts_at < PARTS_REFRESH_SECONDS:
        return
    try:
        info = await robot.get_robot_parts()
        parts = list(getattr(info, "parts", None) or [])
        replace_parts(conninfo, robot_id, parts)
        state.last_parts_at = now
        log.info("Maintenance parts refreshed: %d part(s)", len(parts))
    except Exception as e:  # noqa: BLE001 — fail-open
        state.last_parts_at = now - PARTS_REFRESH_SECONDS + PARTS_RETRY_SECONDS
        log.warning("parts refresh failed: %s: %s", type(e).__name__, e)


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


def upsert_position(conninfo, robot_id, x, y, theta, seen_at=None):
    """UPSERT the latest live position (UNIQUE robot_id). x/y meters, theta radians;
    `seen_at` is when the sample arrived (UTC, default now), which the map shows as
    "last seen" — a sample held back by the write throttle keeps its own time."""
    sql = """
        INSERT INTO roomba_position (robot_id, x, y, theta, updated_at)
        VALUES (%s, %s, %s, %s, %s)
        ON CONFLICT (robot_id) DO UPDATE SET
            x = EXCLUDED.x,
            y = EXCLUDED.y,
            theta = EXCLUDED.theta,
            updated_at = EXCLUDED.updated_at
    """
    # The column is a plain timestamp holding UTC: send UTC wall-clock, so the session's
    # time zone can't shift it.
    at = (seen_at or datetime.now(timezone.utc)).astimezone(timezone.utc).replace(tzinfo=None)
    with psycopg.connect(conninfo, autocommit=True) as conn:
        conn.execute(sql, (robot_id, x, y, theta, at))


def upsert_coverage(conninfo, robot_id, mission_id, coverage):
    """UPSERT the latest cleaning-coverage GeoJSON for a robot (UNIQUE robot_id)."""
    sql = """
        INSERT INTO roomba_coverage (robot_id, mission_id, coverage, updated_at)
        VALUES (%s, %s, %s, NOW())
        ON CONFLICT (robot_id) DO UPDATE SET
            mission_id = EXCLUDED.mission_id,
            coverage = EXCLUDED.coverage,
            updated_at = NOW()
    """
    with psycopg.connect(conninfo, autocommit=True) as conn:
        conn.execute(sql, (robot_id, mission_id, Json(coverage)))


async def _persist_coverage(conninfo, robot_id, msg):
    """Download the live-map bundle referenced by a MapUpdateMessage, pull out
    coverage.geojson (the cleaned/traveled area), and UPSERT it into
    roomba_coverage. The bundle is a gzip'd tar of GeoJSON layers in the same
    meter coordinate space as the floor-plan map, so the frontend overlays it
    directly. Fail-open: any error is the caller's to log; the stream continues.
    Returns the bundle's file names (None when there was nothing to read), so the
    caller can log what a live bundle holds.
    """
    url = getattr(msg, "livemap_url", None)
    if not url:
        return None
    async with aiohttp.ClientSession() as session:
        async with session.get(url) as resp:
            raw = await resp.read()
    body = gzip.decompress(raw) if raw[:3] == b"\x1f\x8b\x08" else raw
    coverage = None
    mission_id = None
    with tarfile.open(fileobj=io.BytesIO(body)) as tf:
        names = set(tf.getnames())
        if "coverage.geojson" not in names:
            return names
        coverage = json.loads(tf.extractfile("coverage.geojson").read())
        if "metadata.json" in names:
            meta = json.loads(tf.extractfile("metadata.json").read())
            sm = meta.get("sourceMetadata") or {}
            mission_id = str(sm.get("missionStartTime") or meta.get("version") or "") or None
    upsert_coverage(conninfo, robot_id, mission_id, coverage)
    return names


# ---------------------------------------------------------------------------
# Pass count: where the robot has cleaned more than once (see coverage_passes).
# Kept beside the coverage row: `passes` is the twice-over area the map draws,
# `pass_grid` every visited cell with its count (read back after a restart), both
# keyed by passes_mission_id = the mission's start (mssnStrtTm, epoch seconds),
# which is also what the live bundle calls missionStartTime (the coverage row's
# mission_id).
# ---------------------------------------------------------------------------
def _mission_key(state):
    started = (state.active or {}).get("started_at")
    return str(int(started.timestamp())) if started is not None else None


def load_pass_grid(conninfo, robot_id):
    """(pass_grid, passes_mission_id) stored for the robot, or (None, None)."""
    with psycopg.connect(conninfo, autocommit=True) as conn:
        row = conn.execute(
            "SELECT pass_grid, passes_mission_id FROM roomba_coverage WHERE robot_id = %s",
            (robot_id,),
        ).fetchone()
    return (row[0], row[1]) if row else (None, None)


def save_passes(conninfo, robot_id, mission_id, shown, grid):
    """Write the twice-over area and the full grid onto the robot's coverage row.
    An UPDATE: the row is the coverage's, created by upsert_coverage."""
    sql = """
        UPDATE roomba_coverage
        SET passes = %s, passes_mission_id = %s, passes_updated_at = NOW()
        WHERE robot_id = %s
    """
    with psycopg.connect(conninfo, autocommit=True) as conn:
        conn.execute(sql, (Json(shown, dumps=_compact_json), mission_id, robot_id))
        # Its own statement: pass_grid is only the restart backup (and a column the
        # backend's migration adds), so if it can't be written the map still gets `passes`.
        try:
            conn.execute("UPDATE roomba_coverage SET pass_grid = %s WHERE robot_id = %s",
                         (Json(grid, dumps=_compact_json), robot_id))
        except Exception as e:  # noqa: BLE001
            log.warning("pass grid backup not written: %s: %s", type(e).__name__, e)


def _compact_json(obj):
    return json.dumps(obj, separators=(",", ":"))


def _resume_passes(conninfo, robot_id, key):
    """The pass grid for mission `key`: the stored one when it is this mission's (a
    restart mid-clean), else a fresh one. Blocking; run in a thread."""
    try:
        data, stored_key = load_pass_grid(conninfo, robot_id)
        if data and stored_key == key:
            grid = coverage_passes.PassGrid.restore(key, data)
            log.info("Pass count for mission %s carried on from the database (%d cells)", key, len(grid.cells))
            return grid
    except Exception as e:  # noqa: BLE001 — a fresh count is the fallback
        log.warning("pass grid reload failed (starting a fresh count): %s: %s", type(e).__name__, e)
    return coverage_passes.PassGrid(key)


def _write_passes(conninfo, robot_id, mission_id, cell, counts):
    """Encode + write (blocking; run in a thread — the tidying takes ~0.2 s for a
    whole house)."""
    save_passes(conninfo, robot_id, mission_id,
                coverage_passes.display(counts, cell), coverage_passes.encode_grid(counts, cell))


async def _count_passes(state, conninfo, robot_id, msg):
    """Add a PositionUpdateMessage's samples (all of them, not just the newest) to
    the mission's pass grid and write it when due. Never raises."""
    try:
        key = _mission_key(state)
        if key is None:
            return
        grid = state.passes
        if grid is None or grid.mission_id != key:
            grid = await asyncio.to_thread(_resume_passes, conninfo, robot_id, key)
            state.passes = grid
            state.passes_written = (grid.version, 0.0)
        now = time.monotonic()
        grid.add_samples(
            [(s.point[0], s.point[1], s.operating_modes) for s in msg.updates], now,
        )
        written_version, written_at = state.passes_written
        if grid.version == written_version or now - written_at < PASSES_WRITE_MIN_INTERVAL:
            return
        version = grid.version
        # Stamp before writing, so a failing write is retried on the interval, not
        # on every message.
        state.passes_written = (written_version, now)
        await asyncio.to_thread(_write_passes, conninfo, robot_id, key, grid.cell, grid.counts())
        state.passes_written = (version, now)
    except Exception as e:  # noqa: BLE001 — the position dot must not depend on this
        now = time.monotonic()
        if now - state.passes_error_at >= 300:
            state.passes_error_at = now
            log.warning("pass count failed: %s: %s", type(e).__name__, e)


# ---------------------------------------------------------------------------
# Live position stream (concurrent task, shares the single robot connection)
# ---------------------------------------------------------------------------
class LivePositionWriter:
    """Writes the robot's newest live position to roomba_position at most once per
    `interval`, without losing the last one. The throttle used to drop a sample that came
    within a second of the previous write, so when the robot stopped (stuck, paused, flat
    battery) the row could hold where it was up to a second earlier, and that was the
    "last seen" spot. Now a sample inside the interval is held and written when the
    interval is up, and whatever is held when the stream ends is written then. Each row
    carries the time its sample arrived. One write at a time, in order, from one task."""

    def __init__(self, conninfo, robot_id, interval, clock=time.monotonic):
        self.conninfo = conninfo
        self.robot_id = robot_id
        self.interval = interval
        self._clock = clock
        self._held = None        # (x, y, theta, seen_at) not written yet
        self._last_write = None  # clock() at the last write
        self._task = None        # the task writing held samples
        self._closing = asyncio.Event()  # set by close(): no more waiting out the interval

    def offer(self, x, y, theta):
        self._held = (x, y, theta, datetime.now(timezone.utc))
        if self._task is None or self._task.done():
            self._task = asyncio.ensure_future(self._drain())

    async def _drain(self):
        while self._held is not None:
            if self._last_write is not None and not self._closing.is_set():
                wait = self.interval - (self._clock() - self._last_write)
                if wait > 0:
                    with contextlib.suppress(asyncio.TimeoutError, TimeoutError):
                        await asyncio.wait_for(self._closing.wait(), wait)
            sample, self._held = self._held, None
            self._last_write = self._clock()
            try:
                # Blocking psycopg write — off the event loop so ~1/s writes don't
                # stall the robot connection's other tasks.
                await asyncio.to_thread(upsert_position, self.conninfo, self.robot_id, *sample)
            except Exception as e:  # noqa: BLE001 — fail-open; the next sample (or close) retries
                if self._held is None:
                    self._held = sample
                log.warning("live position write failed: %s: %s", type(e).__name__, e)
                return

    async def close(self, timeout=LIVE_FINAL_WRITE_TIMEOUT):
        """The stream has ended (or its task is being cancelled): write what is held, the
        last place the robot reported, at once. Waits for a write already under way rather
        than cancelling it, so an older row can never land after a newer one."""
        self._closing.set()
        if self._held is not None and (self._task is None or self._task.done()):
            self._task = asyncio.ensure_future(self._drain())
        if self._task is not None and not self._task.done():
            await asyncio.wait({self._task}, timeout=timeout)


async def run_live_map(robot, conninfo, robot_id, state=None):
    """Stream live position from watch_live_map() and UPSERT the latest point
    (throttled to ~1/sec, the last one never dropped: LivePositionWriter) into
    roomba_position. With `state`, every sample also goes into the mission's pass
    count (_count_passes).

    Runs as a CONCURRENT task over the SAME robot connection as the main loop —
    it opens no second cloud connection. Strictly fail-open: every error is
    logged and swallowed so it can never crash the poller; the task simply ends
    (no dot) and the main loop restarts it on the next mission / reconnect.
    Cancelled cleanly on disconnect (watch_live_map()'s own finally unsubscribes).

    Field names come straight from roombapy_prime.models.livemap:
      PositionUpdateMessage.updates : list[PositionSample]
      PositionSample.point          : (x, y)  meters
      PositionSample.orientation    : float   radians (raw wire heading)
      PositionSample.operating_modes: int     OperatingModeBitmask (see coverage_passes)
    MapUpdateMessage (the other stream shape) carries the live-map bundle URL,
    from which we extract cleaning coverage (see _persist_coverage).
    """
    writer = LivePositionWriter(conninfo, robot_id, LIVE_WRITE_MIN_INTERVAL)
    last_coverage = 0.0
    bundle_files = None
    try:
        async for msg in robot.watch_live_map():
            try:
                # MapUpdateMessage carries the live-map bundle URL — pull the
                # cleaning coverage out of it (throttled) so the tab can shade
                # cleaned area as the robot works.
                if isinstance(msg, MapUpdateMessage):
                    now = time.monotonic()
                    if now - last_coverage >= COVERAGE_WRITE_MIN_INTERVAL:
                        names = await _persist_coverage(conninfo, robot_id, msg)
                        last_coverage = now
                        # What a live bundle holds (e.g. whether it has a
                        # trajectories layer), once per stream.
                        if names is not None and names != bundle_files:
                            bundle_files = names
                            log.info("Live map bundle files: %s", ", ".join(sorted(names)))
                    continue
                if not isinstance(msg, PositionUpdateMessage) or not msg.updates:
                    continue
                if state is not None:
                    await _count_passes(state, conninfo, robot_id, msg)
                sample = msg.updates[-1]  # newest point in this trajectory-like message
                x, y = sample.point
                writer.offer(x, y, sample.orientation)
            except Exception as e:  # noqa: BLE001 — one bad sample must not end the stream
                log.warning("live sample failed: %s: %s", type(e).__name__, e)
    except asyncio.CancelledError:
        raise
    except RuntimeError as e:
        # watch_live_map() raises RuntimeError when irbt_topic_prefix is absent —
        # degrade gracefully (no dot) rather than break anything.
        log.info("live position stream unavailable (no dot): %s", e)
    except Exception as e:  # noqa: BLE001 — fail-open; a new task starts on reconnect
        log.warning("live position stream ended (%s: %s)", type(e).__name__, e)
    finally:
        # The stream is stopping (the robot docked or stopped, or the link dropped), so the
        # newest sample is where the robot is now: write it even if the throttle held it.
        await writer.close()


async def _cancel_live_task(task):
    """Cancel + await the live-map task, swallowing whatever it ends with."""
    if task is None:
        return
    if not task.done():
        task.cancel()
    with contextlib.suppress(asyncio.CancelledError, Exception):
        await task


def _break_pass_path(state):
    """The position stream stopped or is starting over: the pass count must not join the
    last sample before the gap to the first one after it (coverage_passes.PassGrid)."""
    grid = getattr(state, "passes", None)
    if grid is not None:
        grid.break_path()


async def _manage_live_task(task, robot, conninfo, state):
    """Start the live-map task while a mission is running, stop it otherwise, and
    replace a task that has finished/failed. Returns the current task handle."""
    running = bool(state.mission_running)
    alive = task is not None and not task.done()
    if running and not alive:
        if task is not None:
            await _cancel_live_task(task)  # clear a finished/failed handle first
        _break_pass_path(state)
        log.info("Mission running — starting live-position stream")
        return asyncio.ensure_future(run_live_map(robot, conninfo, robot.blid, state))
    if not running and task is not None:
        if alive:
            log.info("Mission ended — stopping live-position stream")
        await _cancel_live_task(task)
        return None
    return task


# ---------------------------------------------------------------------------
# Mission completion detection
# ---------------------------------------------------------------------------
def _record_run(state, conninfo, run, status):
    """Persist one finished mission (idempotent by start time). False when the DB
    write failed — the caller keeps the run and retries on the next poll."""
    started = run.get("started_at")
    try:
        if run_exists(conninfo, started):
            log.info("Mission %s already persisted (started %s); skipping", run.get("mission_id"), started)
        else:
            insert_run(conninfo, run, status)
            log.info(
                "Recorded mission %s status=%s sqft=%s duration=%smin",
                run.get("mission_id"), status, run.get("sqft"), _elapsed_min(started),
            )
        state.completed_missions.add(run.get("mission_id"))
        return True
    except Exception as e:  # noqa: BLE001 — fail-open; retried next poll
        log.warning("Failed to record mission %s (will retry): %s: %s",
                    run.get("mission_id"), type(e).__name__, e)
        return False


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
        if same_mission and cur_phase in TERMINAL_PHASES and not _recharging(cms):
            # Prefer current terminal cms values if still populated for this mission.
            completed = dict(prev)
            if cur_mid == prev["mission_id"] and cms.get("sqft") is not None:
                completed["sqft"] = cms.get("sqft")
            status = _classify(cur_phase, cur_error or prev.get("error"))
        elif cur_mid and cur_mid != prev["mission_id"]:
            # Jumped straight to a new mission; the previous one finished unseen.
            completed = dict(prev)
            status = _classify(None, prev.get("error"))

    # Runs whose write failed earlier (e.g. Postgres restarting) — retry before
    # anything new, so a DB blip at mission end doesn't lose the run.
    for mid, (run, run_status) in list(state.unsaved_runs.items()):
        if _record_run(state, conninfo, run, run_status):
            state.unsaved_runs.pop(mid, None)

    if completed and completed.get("mission_id") not in state.completed_missions:
        if not _record_run(state, conninfo, completed, status):
            state.unsaved_runs[completed.get("mission_id")] = (completed, status)
        state.active = None
        # A finished mission means the robot has regenerated its floor plan — schedule a
        # prompt bundle re-fetch (same one-shot the map-edit path uses) so the newly
        # learned map lands in roomba_map within ~MAP_REFRESH_AFTER_RUN s rather than on
        # the next status poll (up to 300s later on the NUC). refresh_map's version check
        # makes this a cheap no-op if the robot hasn't bumped the map version yet.
        state.map_refresh_due = time.monotonic() + MAP_REFRESH_AFTER_RUN
        # The part counters (filter/brush hours, pad missions, dock-bag empties) advance
        # at mission end too — re-read them shortly after instead of waiting hours.
        state.parts_refresh_due = time.monotonic() + PARTS_REFRESH_AFTER_RUN
        # And the cloud's own record of the run replaces this poll-based one.
        state.history_due = time.monotonic() + HISTORY_AFTER_RUN

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
# Mission history (GET /v1/{blid}/missionhistory — the cloud's record behind the
# iRobot app's History list; a REST read, nothing is sent to the robot)
# ---------------------------------------------------------------------------
# detect_completion() only sees the robot every few minutes, so on its own it
# recorded a run at the first mid-mission recharge (half the area, a third of the
# time), marked stuck runs "completed" when the error had cleared by the next poll,
# and missed every run that ended while the poller or the NUC was down. The cloud
# history has the robot's own totals and outcome, so it overwrites the poll-based
# row for each mission and inserts the ones the poller never saw.
HISTORY_REFRESH_SECONDS = 30 * 60
HISTORY_RETRY_SECONDS = 300      # after a failed read (or columns not created yet)
HISTORY_AFTER_RUN = 60           # the cloud closes the entry shortly after the robot docks
HISTORY_BACKFILL_REPORTS = 30    # first sync per process (the cloud returns at most 30)
HISTORY_RECENT_REPORTS = 10
# The shadow's mssnStrtTm and the history's startTime for one mission can differ
# by a second, so rows are matched on start time within this window (plus the
# mission number when the row has one).
HISTORY_MATCH_SECONDS = 300

# Done codes, from the app's completion semantics (see DoneCode in roombapy_prime).
DONE_COMPLETED = {"ok", "busy", "dndEnd", "returnHomeEnd", "timeboxEnd"}
DONE_CANCELLED = {"cncl", "usrSlp", "plcDoc", "usrEnd", "usrSpt", "batcncl"}


def _history_status(done):
    if done in DONE_COMPLETED:
        return "COMPLETED"
    if done in DONE_CANCELLED:
        return "CANCELLED"
    if done == "stuck":
        return "STUCK"
    return "INCOMPLETE"


def _history_regions(entry):
    """Rooms (rid) / zones (zid) the mission was sent to, with each one's settings."""
    out = []
    for r in (entry.get("cmd") or {}).get("regions") or []:
        if not isinstance(r, dict) or r.get("region_id") is None:
            continue
        p = r.get("params") or {}
        out.append({
            "id": str(r["region_id"]),
            "type": r.get("type") or "rid",
            "suction": p.get("suctionLevel"),
            "twoPass": p.get("twoPass"),
            "mode": p.get("operatingMode"),
        })
    return out


def _history_row(entry):
    """roomba_runs values for one finished history entry; None to skip it (still
    running, or missing the fields a run needs)."""
    started = _epoch_to_utc(entry.get("startTime"))
    ended = _epoch_to_utc(entry.get("timestamp"))
    done = entry.get("done") or entry.get("done_raw")
    if started is None or ended is None or not done:
        return None
    status = _history_status(done)
    # pauseId carries the error that stopped a stuck mission (1010 on the run the
    # poller also saw as error 1010); on a clean finish it's 0.
    error = 0
    if status in ("STUCK", "INCOMPLETE"):
        try:
            error = int(entry.get("pauseId") or 0)
        except (ValueError, TypeError):
            error = 0
    return {
        "started_at": started,
        "completed_at": ended,
        "duration_minutes": entry.get("durationM"),
        "charge_minutes": entry.get("chrgM"),
        "pause_minutes": entry.get("pauseM"),
        "square_feet": entry.get("sqft"),
        "evacuations": entry.get("evacs"),
        "status": status,
        "done_code": str(done)[:20],
        "mission_number": entry.get("nMssn"),
        "error": error,
        "error_text": _error_text(error),
        "initiator": entry.get("initiator") or (entry.get("cmd") or {}).get("initiator"),
        "regions": _history_regions(entry),
    }


def upsert_history_run(conninfo, row, batch_id):
    """Write one history entry over the poller's row for that mission, or insert it.
    Returns "inserted", "updated", or None when the stored row already matches."""
    started = row["started_at"]
    params = {
        **row,
        "regions": Json(row["regions"]),
        "lo": started - timedelta(seconds=HISTORY_MATCH_SECONDS),
        "hi": started + timedelta(seconds=HISTORY_MATCH_SECONDS),
        "batch": batch_id,
    }
    same_number = (" AND (mission_number IS NULL OR mission_number = %(mission_number)s)"
                   if row["mission_number"] is not None else "")
    with psycopg.connect(conninfo, autocommit=True) as conn:
        found = conn.execute(
            "SELECT id, source, status, duration_minutes, square_feet FROM roomba_runs"
            " WHERE source_provider = 'irobot' AND started_at BETWEEN %(lo)s AND %(hi)s"
            + same_number + " ORDER BY id LIMIT 1",
            params,
        ).fetchone()
        if found is None:
            conn.execute(
                """
                INSERT INTO roomba_runs (
                    started_at, completed_at, duration_minutes, charge_minutes, pause_minutes,
                    square_feet, evacuations, status, done_code, mission_number, error,
                    error_text, initiator, regions, source, source_provider,
                    ingestion_batch_id, processing_version
                ) VALUES (
                    %(started_at)s, %(completed_at)s, %(duration_minutes)s, %(charge_minutes)s,
                    %(pause_minutes)s, %(square_feet)s, %(evacuations)s, %(status)s,
                    %(done_code)s, %(mission_number)s, %(error)s, %(error_text)s,
                    %(initiator)s, %(regions)s, 'irobot-history', 'irobot', %(batch)s, '2.0'
                )
                """,
                params,
            )
            return "inserted"
        _id, source, status, duration, sqft = found
        if (source == "irobot-history" and status == row["status"]
                and duration == row["duration_minutes"] and sqft == row["square_feet"]):
            return None
        conn.execute(
            """
            UPDATE roomba_runs SET
                completed_at = %(completed_at)s, duration_minutes = %(duration_minutes)s,
                charge_minutes = %(charge_minutes)s, pause_minutes = %(pause_minutes)s,
                square_feet = %(square_feet)s, evacuations = %(evacuations)s,
                status = %(status)s, done_code = %(done_code)s,
                mission_number = %(mission_number)s, error = %(error)s,
                error_text = %(error_text)s, initiator = COALESCE(%(initiator)s, initiator),
                regions = %(regions)s, source = 'irobot-history',
                ingestion_batch_id = %(batch)s, processing_version = '2.0'
            WHERE id = %(id)s
            """,
            {**params, "id": _id},
        )
        return "updated"


async def sync_history(robot, conninfo, state):
    """Pull the cloud's mission history into roomba_runs. Fail-open: a failed read
    is retried after HISTORY_RETRY_SECONDS (e.g. before the backend has added the
    new roomba_runs columns on first boot)."""
    now = time.monotonic()
    reports = HISTORY_RECENT_REPORTS if state.history_backfilled else HISTORY_BACKFILL_REPORTS
    try:
        raw = await robot.get_mission_history(robot.blid, max_reports=reports)
        entries = raw if isinstance(raw, list) else []
        # Never write the mission the robot is still on (e.g. docked mid-clean to
        # recharge); its entry isn't final until it really ends.
        active_start = (state.active or {}).get("started_at")
        batch_id = str(uuid.uuid4())
        inserted = updated = 0
        for entry in entries:
            row = _history_row(entry) if isinstance(entry, dict) else None
            if row is None:
                continue
            if active_start is not None and abs((row["started_at"] - active_start).total_seconds()) <= HISTORY_MATCH_SECONDS:
                continue
            result = await asyncio.to_thread(upsert_history_run, conninfo, row, batch_id)
            inserted += result == "inserted"
            updated += result == "updated"
        state.history_backfilled = True
        state.history_due = now + HISTORY_REFRESH_SECONDS
        if inserted or updated:
            log.info("Mission history synced: %d new run(s), %d corrected", inserted, updated)
    except Exception as e:  # noqa: BLE001 — fail-open
        state.history_due = now + HISTORY_RETRY_SECONDS
        log.warning("mission history sync failed: %s: %s", type(e).__name__, e)


# ---------------------------------------------------------------------------
# Cloud connection + main loop
# ---------------------------------------------------------------------------
async def connect_robot(session, email, password, country, blid, state):
    # Log in ourselves so we can read the user-assigned robot name (which lives in
    # the account's robot list, not on the PrimeRobot object), then hand the same
    # login result to the factory to avoid a second login round-trip.
    login_result = await login(session, email, password, country)
    # auto_refresh: the cloud MQTT token lasts ~1 h. Without it the link died every
    # hour ("Connect timed out" on the next reconnect), failing that cycle and
    # cutting the live-position stream mid-clean; the library now logs in again
    # 5 min before expiry and swaps the token under the running connection.
    robot = await PrimeFactory.create_prime_robot(
        session=session, username=email, password=password,
        country_code=country, blid=blid or None, login_result=login_result,
        auto_refresh=True,
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

    # Drives the concurrent live-position task (started only mid-mission and on the way home).
    state.mission_running = _wants_live_position(rep.get("cleanMissionStatus") or {})

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
    await refresh_parts(robot, conninfo, robot_id, state)


# ---------------------------------------------------------------------------
# Control commands (poller executes what the backend enqueued into roomba_commands)
# ---------------------------------------------------------------------------
# CMD_TICK_SECONDS (command_flow) is now only the fallback: the roomba_commands insert
# trigger NOTIFYs this channel and listen_for_commands() wakes the loop at once.
COMMAND_CHANNEL = "roomba_commands"
# After a map edit applies, re-fetch the map bundle this many seconds later — enough
# for the robot to regenerate the rendered map, far sooner than the next status poll
# (POLL_INTERVAL_SECONDS, 300s on the NUC). Keeps the floor plan from lagging ~5 min.
MAP_REFRESH_AFTER_EDIT = 12
# Same idea after a mission finishes: the robot regenerates its floor plan (new map
# version) at the end of a run, so schedule a prompt bundle re-fetch instead of waiting
# up to a full poll cycle for the version bump to be noticed. Slightly longer than the
# edit delay to give the robot time to publish the finalized map.
MAP_REFRESH_AFTER_RUN = 25
# Consumable / maintenance counters (GET /v1/robots/{blid}/parts — a plain cloud
# REST read; nothing is sent to the robot). They only move when a mission ends,
# so refresh on connect, shortly after each completed run, and on a slow timer.
PARTS_REFRESH_SECONDS = 6 * 3600
PARTS_RETRY_SECONDS = 120        # after a failed read (e.g. the table isn't created yet)
PARTS_REFRESH_AFTER_RUN = 40     # a little after the post-run map re-fetch
SIMPLE_COMMANDS = {"start", "stop", "pause", "resume", "dock", "find", "evac"}
# The detail for a publish the broker never confirmed (no PUBACK within 5 s).
BROKER_REJECTED = "broker rejected"
RENAME_ROOM = "rename_room"
SPLIT_ROOM = "split_room"
MERGE_ROOMS = "merge_rooms"
CLEAN_ROOM = "clean_room"
CLEAN_ROOMS = "clean_rooms"
LIST_SCHEDULES = "list_schedules"

# Commands that (may) start a mission. After one, the poller polls at the fast
# cadence for a short window so mission start — and thus the live dot + coverage
# capture — is picked up within seconds instead of on the next full poll cycle.
MISSION_START_COMMANDS = {"start", "resume", CLEAN_ROOM, CLEAN_ROOMS, "favorite"}
FAST_POLL_INTERVAL = 10   # seconds — poll cadence while a mission runs or was just commanded
FAST_POLL_WINDOW = 180    # seconds — how long to fast-poll after a mission-starting command


def _fetch_pending(conninfo, limit=5):
    """PENDING commands, oldest first: (id, command, arg, ms since it was queued). The age
    is measured on the database's clock (created_at is UTC, set by the backend)."""
    with psycopg.connect(conninfo, autocommit=True) as conn:
        return conn.execute(
            "SELECT id, command, arg, "
            "EXTRACT(EPOCH FROM ((clock_timestamp() AT TIME ZONE 'UTC') - created_at)) * 1000 "
            "FROM roomba_commands WHERE status = 'PENDING' ORDER BY id LIMIT %s",
            (limit,),
        ).fetchall()


def _clip(detail):
    return detail[:500] if detail else None


def _mark_command(conninfo, cmd_id, status, detail=None, terminal=True):
    with psycopg.connect(conninfo, autocommit=True) as conn:
        if terminal:
            conn.execute(
                "UPDATE roomba_commands SET status = %s, detail = %s, processed_at = NOW() WHERE id = %s",
                (status, _clip(detail), cmd_id),
            )
        else:
            conn.execute("UPDATE roomba_commands SET status = %s WHERE id = %s", (status, cmd_id))


def _mark_sent(conninfo, cmd_id, detail):
    """The broker confirmed the send; the row stays SENT until the robot is seen to react.
    processed_at records the send, so processed_at - created_at stays "click to sent"."""
    with psycopg.connect(conninfo, autocommit=True) as conn:
        conn.execute(
            "UPDATE roomba_commands SET detail = %s, processed_at = NOW() WHERE id = %s",
            (_clip(detail), cmd_id),
        )


def _finish_command(conninfo, cmd_id, status, detail):
    """Settle a sent command (OK / FAILED) without moving its send time."""
    with psycopg.connect(conninfo, autocommit=True) as conn:
        conn.execute(
            "UPDATE roomba_commands SET status = %s, detail = %s, "
            "processed_at = COALESCE(processed_at, NOW()) WHERE id = %s",
            (status, _clip(detail), cmd_id),
        )


def _settle_interrupted_commands(conninfo):
    """At start-up, settle the rows a previous run left SENT (it stopped while a command was
    going out or being checked), so the page doesn't wait on them forever. One poller owns
    the queue, so any SENT row now belongs to a process that is gone. Fail-open."""
    try:
        with psycopg.connect(conninfo, autocommit=True) as conn:
            checked = conn.execute(
                "UPDATE roomba_commands SET status = 'OK', detail = %s "
                "WHERE status = 'SENT' AND processed_at IS NOT NULL",
                ("accepted by broker; the poller restarted before the robot's reaction was checked",),
            ).rowcount
            lost = conn.execute(
                "UPDATE roomba_commands SET status = 'FAILED', detail = %s, processed_at = NOW() "
                "WHERE status = 'SENT' AND processed_at IS NULL",
                ("the poller restarted while sending it, so it may not have reached the robot",),
            ).rowcount
        if checked or lost:
            log.info("Settled %d unchecked and %d interrupted command(s) from the last run", checked, lost)
    except Exception as e:  # noqa: BLE001 — the table may not exist yet at first boot
        log.debug("command settle skipped: %s: %s", type(e).__name__, e)


def _settle_stale_sent(conninfo, keep_id=None, older_than=STALE_SENT_SECONDS):
    """Settle SENT rows the running poller lost track of (their OK / FAILED write failed,
    say): older than `older_than` seconds and not `keep_id` (the command being followed
    up). Same split as at start-up: sent (processed_at set) -> OK on the broker's word,
    never sent -> FAILED. Returns (ok, failed) counts; raises on a database error.
    created_at / processed_at are UTC, so the cut-off is too."""
    cutoff = "(clock_timestamp() AT TIME ZONE 'UTC') - make_interval(secs => %s)"
    keep = -1 if keep_id is None else keep_id
    with psycopg.connect(conninfo, autocommit=True) as conn:
        checked = conn.execute(
            "UPDATE roomba_commands SET status = 'OK', detail = %s "
            "WHERE status = 'SENT' AND processed_at IS NOT NULL AND id <> %s "
            f"AND processed_at < {cutoff}",
            ("accepted by broker; the poller lost track of it before the robot's reaction was checked",
             keep, older_than),
        ).rowcount
        lost = conn.execute(
            "UPDATE roomba_commands SET status = 'FAILED', detail = %s, processed_at = NOW() "
            "WHERE status = 'SENT' AND processed_at IS NULL AND id <> %s "
            f"AND created_at < {cutoff}",
            ("the poller lost track of it while sending, so it may not have reached the robot",
             keep, older_than),
        ).rowcount
    return checked, lost


def _not_sent(e, what):
    """(False, reason) for a failure BEFORE the publish: nothing left, so the runner reports
    it as refused (no reconnect, no "may not have reached the robot")."""
    return False, f"couldn't prepare the {what}, so nothing was sent ({type(e).__name__}: {e})"


async def _run_favorite(robot, favorite_id):
    """Replay a saved favorite/zone by id. Unvalidated on hardware (we have 0 favorites
    yet) — kept best-effort. Returns (ok, detail) like the room cleans."""
    try:
        from roombapy_prime.models.mission_control import MissionCommandType, RoutineCommand
        cmd = RoutineCommand(
            command_type=MissionCommandType.START,
            asset_id=robot.blid,
            favorite_id=favorite_id,
            initiator="rmtApp",
        )
    except Exception as e:  # noqa: BLE001 — nothing sent yet
        return _not_sent(e, "favorite")
    ok = await robot.send_routine_command_via_cmd_topic(cmd)
    return (True, f"favorite {favorite_id} sent") if ok is not False else (False, BROKER_REJECTED)


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


def _clean_command_params(params):
    """Build CommandParams (suction/passes/mode) from a clean payload dict, or None
    when the caller supplied none. Shared by the single- and multi-room cleans.

    suction: 1-4 -> suction_level; passes: "one"/"two" -> two_pass/no_auto_passes;
    mode: vendor codec 2=vacuum/4=mop/6=vac+mop -> operating_mode.
    """
    from roombapy_prime.models.mission_control import CommandParams

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
    return CommandParams(**cp_kwargs) if cp_kwargs else None


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
    try:
        params = json.loads(arg or "{}")
    except (ValueError, TypeError):
        return False, "bad clean payload"
    room_id = params.get("room_id")
    if not room_id:
        return False, "missing room_id"

    # Everything up to the publish: a failure here (the map read, say) sent nothing.
    try:
        from roombapy_prime.models.mission_control import (
            MissionCommandType,
            Region,
            RegionType,
            RoutineCommand,
        )

        p2map_id = await _active_p2map_id(robot)
        if not p2map_id:
            # Required: a null map_id turns a room clean into a whole-house clean.
            return False, "no active map"

        cparams = _clean_command_params(params)

        region = Region(region_id=str(room_id), region_type=RegionType.RID, params=cparams)
        cmd = RoutineCommand(
            command_type=MissionCommandType.START,  # NOT CLEAN
            asset_id=robot.blid,
            map_id=p2map_id,                          # NOT None
            regions=[region],
            initiator="rmtApp",                       # mandatory (presence, not value)
        )
    except Exception as e:  # noqa: BLE001 — nothing sent yet
        return _not_sent(e, "room clean")
    ok = await robot.send_routine_command_via_cmd_topic(cmd)
    return (True, "clean started") if ok else (False, BROKER_REJECTED)


async def _clean_rooms(robot, conninfo, arg):
    """Clean a SET of rooms (multi-region clean). "Clean all" is just every mapped
    room in the list; "clean selection" is the chosen subset. Same safety-critical
    START/RID/map_id shape as _clean_room (a null map_id or CLEAN type would turn
    this into a whole-house clean), only with N regions instead of one.

    `arg` JSON: {room_ids: [str, ...], suction?: 1-4, passes?: "one"|"two", mode?: 2|4|6}.
    """
    try:
        params = json.loads(arg or "{}")
    except (ValueError, TypeError):
        return False, "bad clean payload"
    room_ids = params.get("room_ids")
    if not isinstance(room_ids, list) or not room_ids:
        return False, "missing room_ids"

    # Everything up to the publish: a failure here (the map read, say) sent nothing.
    try:
        from roombapy_prime.models.mission_control import (
            MissionCommandType,
            Region,
            RegionType,
            RoutineCommand,
        )

        p2map_id = await _active_p2map_id(robot)
        if not p2map_id:
            # Required: a null map_id turns a region clean into a whole-house clean.
            return False, "no active map"

        cparams = _clean_command_params(params)
        regions = [
            Region(region_id=str(r), region_type=RegionType.RID, params=cparams)
            for r in room_ids
            if r
        ]
        if not regions:
            return False, "no valid rooms"

        cmd = RoutineCommand(
            command_type=MissionCommandType.START,  # NOT CLEAN
            asset_id=robot.blid,
            map_id=p2map_id,                          # NOT None
            regions=regions,
            initiator="rmtApp",                       # mandatory (presence, not value)
        )
    except Exception as e:  # noqa: BLE001 — nothing sent yet
        return _not_sent(e, "room clean")
    ok = await robot.send_routine_command_via_cmd_topic(cmd)
    return (True, f"clean started ({len(regions)} room(s))") if ok else (False, BROKER_REJECTED)


def _replace_native_schedules(conninfo, robot_id, schedules):
    """Full replace, not upsert: schedules deleted natively (app or a probe
    script) must disappear here too, not just linger from a previous read.
    `schedules` is a list of (household_schedule_id, options_dict)."""
    with psycopg.connect(conninfo, autocommit=False) as conn:
        with conn.cursor() as cur:
            # Only this robot's rows — another robot's schedules aren't in `schedules`.
            cur.execute("DELETE FROM roomba_native_schedule WHERE robot_id = %s", (robot_id,))
            for household_schedule_id, options in schedules:
                cur.execute(
                    "INSERT INTO roomba_native_schedule "
                    "(household_schedule_id, robot_id, options, updated_at) "
                    "VALUES (%s, %s, %s, NOW())",
                    (household_schedule_id, robot_id, Json(options)),
                )
        conn.commit()


async def _list_schedules(robot, conninfo):
    """Read the robot's REAL (cloud-side) schedules and fully replace
    roomba_native_schedule with what get_schedules() reports right now."""
    household_id = await robot.get_household_id()
    if not household_id:
        return False, "no household_id"
    resp = await robot.get_schedules(household_id)
    rows = []
    for sched_list in getattr(resp, "household_schedules", None) or []:
        household_schedule_id = getattr(sched_list, "household_schedule_id", None)
        if not household_schedule_id:
            continue
        for entry in getattr(sched_list, "schedules", None) or []:
            options = entry.get("options") if isinstance(entry, dict) else None
            if isinstance(options, dict):
                rows.append((household_schedule_id, options))
    _replace_native_schedules(conninfo, robot.blid, rows)
    return True, f"{len(rows)} schedule(s)"


async def _robot_command(robot, conninfo, command, arg):
    """Send one robot (cloud MQTT) command. Returns (outcome, detail): SENT once the broker
    confirmed it (PUBACK; that it reached the robot is checked afterwards), UNCONFIRMED
    when it didn't confirm, REFUSED when the request itself was bad or couldn't be built
    and nothing was sent. An exception from the publish itself propagates (the caller
    treats it as UNCONFIRMED)."""
    if command in SIMPLE_COMMANDS:
        ok = await robot.send_simple_command(command)
        return (SENT, "accepted by broker") if ok else (UNCONFIRMED, BROKER_REJECTED)
    if command == "favorite":
        ok, detail = await _run_favorite(robot, arg)
    elif command == CLEAN_ROOM:
        ok, detail = await _clean_room(robot, conninfo, arg)
    elif command == CLEAN_ROOMS:
        ok, detail = await _clean_rooms(robot, conninfo, arg)
    else:
        return REFUSED, f"unknown command: {command}"
    if ok:
        return SENT, detail
    return (UNCONFIRMED, detail) if detail == BROKER_REJECTED else (REFUSED, detail)


async def _rest_command(robot, conninfo, state, command, arg):
    """Map edits and the schedule read: cloud REST calls, no MQTT link involved (the REST
    client logs in again by itself on a 403). Returns (ok, detail)."""
    if command == RENAME_ROOM:
        return await _rename_room(robot, conninfo, arg, state)
    if command == SPLIT_ROOM:
        return await _split_room(robot, conninfo, arg, state)
    if command == MERGE_ROOMS:
        return await _merge_rooms(robot, conninfo, arg, state)
    if command == LIST_SCHEDULES:
        return await _list_schedules(robot, conninfo)
    return False, f"unknown command: {command}"


async def read_status(robot, conninfo, state, stats, timeout):
    """One ro-currentstate read, written through like a poll's (roomba_status, mission
    completion, the live-dot switch) so the page sees a command's effect within a second
    or two. `stats` is the last ro-stats reading; without one the row isn't written (it
    would blank the lifetime counters), and the next poll writes it. Returns the reported
    state. Raises when the read fails."""
    rep = _reported(await robot.get_named_shadow("ro-currentstate", timeout=timeout))
    state.mission_running = _wants_live_position(rep.get("cleanMissionStatus") or {})
    if stats is not None:
        try:
            upsert_status(conninfo, robot.blid, state.robot_name or getattr(robot, "name", None),
                          rep, stats, state.last_map_version or _map_version(rep))
        except Exception as e:  # noqa: BLE001
            log.warning("upsert_status failed: %s: %s", type(e).__name__, e)
    try:
        detect_completion(state, rep, conninfo)
    except Exception as e:  # noqa: BLE001
        log.warning("detect_completion failed: %s: %s", type(e).__name__, e)
    return rep


def _link_id(raw_robot):
    """Which MQTT connection is up: the client object plus its connect count (roombapy_prime
    0.8.3, mqtt_client.py `generation`). None when the library doesn't expose it."""
    mqtt = getattr(raw_robot, "_mqtt", None)
    if mqtt is None:
        return None
    generation = getattr(mqtt, "generation", None)
    return (id(mqtt), generation if isinstance(generation, int) else None)


class LinkMonitor:
    """The evidence that the cloud link is delivering: when a shadow read last came back,
    and on which connection. A named-shadow read publishes a request and waits for the
    answer on the same MQTT session a command uses, so a recent answer proves the link in
    both directions. Also keeps the robot's last state and lifetime stats."""

    def __init__(self, clock=time.monotonic):
        self._clock = clock
        self.ok_at = None
        self.ok_link = None
        self.last_rep = None     # ro-currentstate reported, from the last read
        self.last_stats = None   # ro-stats reported, from the last read (kept across links)

    def saw_reply(self, name, reply, link_id):
        self.ok_at = self._clock()
        self.ok_link = link_id
        if name == "ro-currentstate":
            self.last_rep = _reported(reply)
        elif name == "ro-stats":
            self.last_stats = _reported(reply)

    def new_link(self):
        self.ok_at = None
        self.ok_link = None
        self.last_rep = None


class TrackedRobot:
    """The PrimeRobot with every successful shadow read noted in a LinkMonitor. Everything
    else passes straight through, so poll_once, the live-map task and the commands use it
    exactly like the robot itself."""

    def __init__(self, robot, monitor):
        self._robot = robot
        self._monitor = monitor

    @property
    def inner(self):
        return self._robot

    def __getattr__(self, name):
        return getattr(self._robot, name)

    async def get_named_shadow(self, name, timeout=8.0):
        reply = await self._robot.get_named_shadow(name, timeout=timeout)
        self._monitor.saw_reply(name, reply, _link_id(self._robot))
        return reply


class CloudLink:
    """The one iRobot cloud connection and what hangs off it: the live-position task and
    the evidence it's delivering. The main loop and the command runner both (re)connect
    through here, so a reconnect always takes the live task down with the old connection."""

    def __init__(self, session, creds, state, clock=time.monotonic):
        self.session = session
        self.creds = creds          # (email, password, country, blid)
        self.state = state
        self.robot = None
        self.live_task = None
        self.monitor = LinkMonitor(clock)
        self.poll_now = False       # just (re)connected: the main loop polls at once

    async def ensure(self):
        if self.robot is None:
            await self._connect()

    async def _connect(self):
        email, password, country, blid = self.creds
        raw = await connect_robot(self.session, email, password, country, blid, self.state)
        self.robot = TrackedRobot(raw, self.monitor)
        self.monitor.new_link()
        self.poll_now = True

    async def drop(self):
        await _cancel_live_task(self.live_task)  # tied to this connection
        self.live_task = None
        _break_pass_path(self.state)
        self.state.mission_running = False
        robot, self.robot = self.robot, None
        if robot is not None:
            try:
                await robot.disconnect()
            except Exception:  # noqa: BLE001
                pass

    async def reconnect(self, why):
        started = time.monotonic()
        log.info("Reconnecting the cloud link: %s", why)
        await self.drop()
        await self._connect()
        log.info("Cloud link reconnected in %.0f ms", (time.monotonic() - started) * 1000)

    def facts(self):
        """link_decision()'s inputs, read off the library (0.8.3: PrimeMqttClient.connected,
        .generation, .seconds_until_token_refresh_due()). Anything it doesn't expose comes
        back None, which makes the decision a probe, never a blind send."""
        raw = self.robot.inner if self.robot is not None else None
        mqtt = getattr(raw, "_mqtt", None)
        connected = getattr(mqtt, "connected", None) if mqtt is not None else None
        refresh_due_in = None
        if mqtt is not None:
            try:
                due = mqtt.seconds_until_token_refresh_due()
                refresh_due_in = float(due) if isinstance(due, (int, float)) else None
            except Exception:  # noqa: BLE001
                refresh_due_in = None
        return {
            "connected": connected if isinstance(connected, bool) else None,
            "link_id": _link_id(raw) if raw is not None else None,
            "last_ok_at": self.monitor.ok_at,
            "last_ok_link": self.monitor.ok_link,
            "refresh_due_in": refresh_due_in,
            "have_state": self.monitor.last_rep is not None,
        }


def _since_ms(started, clock=time.monotonic):
    return f"{(clock() - started) * 1000:.0f} ms"


class CommandRunner:
    """Runs the queued commands over the shared cloud link, then follows each robot command
    up (command_flow.FollowUp): reads the robot's state back on a short schedule and, when
    a reaction was expected and none came, reconnects and re-sends once (RESEND_SAFE) or
    fails the command with the reason. One follow-up at a time: a newer command supersedes
    it, so an older command is never re-sent after a newer one."""

    def __init__(self, link, conninfo, state, clock=time.monotonic):
        self.link = link
        self.conninfo = conninfo
        self.state = state
        self.clock = clock
        self.followup = None
        # Settling writes that failed (cmd_id -> (status, detail)), retried by the sweep so
        # the row gets its real outcome rather than the sweep's guess.
        self.unwritten = {}
        self.sweep_due = 0.0

    def next_check_at(self):
        return self.followup.next_check_at() if self.followup is not None else None

    def _write(self, what, fn, *args):
        """A row write after the command went out: a failure is logged, never turned into
        FAILED (the robot has the command). Returns whether it was written."""
        try:
            fn(self.conninfo, *args)
            return True
        except Exception as e:  # noqa: BLE001
            log.warning("couldn't %s for command #%s: %s: %s", what, args[0] if args else "?", type(e).__name__, e)
            return False

    def sweep_if_due(self):
        """About once a minute: retry settling writes that failed, then settle SENT rows the
        poller lost track of (older than STALE_SENT_SECONDS, not the current follow-up).
        Database only; never raises."""
        now = self.clock()
        if now < self.sweep_due:
            return
        self.sweep_due = now + SWEEP_SECONDS
        for cmd_id, (status, detail) in list(self.unwritten.items()):
            try:
                _finish_command(self.conninfo, cmd_id, status, detail)
                self.unwritten.pop(cmd_id, None)
                log.info("command #%s marked %s (retried)", cmd_id, status)
            except Exception as e:  # noqa: BLE001
                log.debug("retry of #%s's %s write failed: %s: %s", cmd_id, status, type(e).__name__, e)
        try:
            keep = self.followup.cmd_id if self.followup is not None else None
            checked, lost = _settle_stale_sent(self.conninfo, keep)
            if checked or lost:
                log.warning("Settled %d unchecked and %d lost command(s) left SENT", checked, lost)
        except Exception as e:  # noqa: BLE001
            log.debug("stale command sweep failed: %s: %s", type(e).__name__, e)

    async def run_pending(self, woke=""):
        try:
            pending = _fetch_pending(self.conninfo)
        except Exception as e:  # noqa: BLE001 — table may not exist yet at first boot
            log.debug("command fetch skipped: %s: %s", type(e).__name__, e)
            return
        for cmd_id, command, arg, age_ms in pending:
            try:
                queued_ms = float(age_ms) if age_ms is not None else None
            except (TypeError, ValueError):
                queued_ms = None
            timing = CommandTiming(seen_at=self.clock(), queued_ms=queued_ms, woke=woke)
            await self._run_one(cmd_id, command, arg, timing)

    async def _read(self, timeout):
        if self.link.robot is None:
            raise ConnectionError("no cloud link")
        return await read_status(self.link.robot, self.conninfo, self.state,
                                 self.link.monitor.last_stats, timeout)

    async def _try_read(self, timeout):
        try:
            return await self._read(timeout)
        except Exception as e:  # noqa: BLE001
            log.info("robot state read failed: %s: %s", type(e).__name__, e)
            return None

    async def _send(self, command, arg):
        try:
            return await _robot_command(self.link.robot, self.conninfo, command, arg)
        except Exception as e:  # noqa: BLE001 — a publish that raised may not have left
            return UNCONFIRMED, f"{type(e).__name__}: {e}"

    async def _run_one(self, cmd_id, command, arg, timing):
        try:
            _mark_command(self.conninfo, cmd_id, "SENT", terminal=False)  # claim → no double-send on restart
        except Exception:  # noqa: BLE001
            return
        went_out = False  # once the broker has it, nothing below may mark the row FAILED
        try:
            if command not in ROBOT_COMMANDS:
                ok, detail = await _rest_command(self.link.robot, self.conninfo, self.state, command, arg)
                went_out = ok
                timing.sent_at = self.clock()
                if not self._write("record the result", _mark_command, cmd_id, "OK" if ok else "FAILED", detail):
                    self.unwritten[cmd_id] = ("OK" if ok else "FAILED", detail)
                log.info(timing_line(cmd_id, command, timing, "done" if ok else f"failed ({detail})"))
                return
            if self.followup is not None:
                self._supersede(cmd_id)
            baseline = await self._ready_link(timing)
            published_at = self.clock()
            outcome, detail = await self._send(command, arg)
            if outcome == UNCONFIRMED:
                outcome, detail, baseline = await self._recover_unconfirmed(command, arg, baseline, detail, timing)
            if outcome == WATCH:
                # Not confirmed, and a second copy could start a second clean: keep the row
                # SENT and watch the robot, timed from the first publish; FAILED only if
                # nothing happens by the end of the start's window.
                went_out = True
                timing.sent_at = published_at
                if command in MISSION_START_COMMANDS:
                    self.state.fast_poll_until = time.monotonic() + FAST_POLL_WINDOW
                self._write("mark it sent", _mark_sent, cmd_id,
                            "the cloud didn't confirm it; waiting to see whether the robot reacts")
                self.followup = FollowUp(
                    cmd_id=cmd_id, command=command, arg=arg, baseline=mission_signature(baseline),
                    verify=True, sent_at=published_at, timing=timing, unconfirmed=detail,
                )
                self._skip_past_checks(self.followup)
                return
            if outcome != SENT:
                timing.done_at = self.clock()
                _mark_command(self.conninfo, cmd_id, "FAILED", detail)
                log.info(timing_line(cmd_id, command, timing, f"failed ({detail})"))
                return
            went_out = True
            timing.sent_at = self.clock()
            # A mission-starting command: fast-poll for a window so the live dot +
            # coverage begin within seconds instead of on the next full poll cycle.
            if command in MISSION_START_COMMANDS:
                self.state.fast_poll_until = time.monotonic() + FAST_POLL_WINDOW
            verify = reaction_expected(command, baseline)
            if verify:
                self._write("mark it sent", _mark_sent, cmd_id, "sent; waiting for the robot to react")
            elif not self._write("mark it OK", _mark_command, cmd_id, "OK", detail):
                self.unwritten[cmd_id] = ("OK", detail)
            if command in NO_FOLLOW_UP:
                log.info(timing_line(cmd_id, command, timing, "sent (nothing to read back)"))
                return
            self.followup = FollowUp(
                cmd_id=cmd_id, command=command, arg=arg,
                baseline=mission_signature(baseline), verify=verify,
                sent_at=timing.sent_at, timing=timing,
            )
        except Exception as e:  # noqa: BLE001 — fail-open, never crash the loop
            log.warning("command #%s (%s) failed: %s: %s", cmd_id, command, type(e).__name__, e)
            if went_out:
                return  # the robot has it; the follow-up or the sweep settles the row
            try:
                _mark_command(self.conninfo, cmd_id, "FAILED", f"{type(e).__name__}: {e}")
            except Exception:  # noqa: BLE001
                pass

    def _skip_past_checks(self, fu):
        """Skip the checks that fell due while the send was being recovered (the reconnect
        and its read already looked); the next read is the next one still ahead. The last
        check is never skipped."""
        now = self.clock()
        while fu.checks_done < len(fu.schedule) - 1 and fu.next_check_at() <= now:
            fu.checks_done += 1

    def _supersede(self, newer_id):
        fu, self.followup = self.followup, None
        if fu.verify:
            self._finish(fu.cmd_id, "OK", f"accepted by broker; #{newer_id} followed before the robot was seen to react")
        log.info(timing_line(fu.cmd_id, fu.command, fu.timing, f"superseded by #{newer_id}"))

    async def _ready_link(self, timing):
        """Make sure the link can be trusted before a send. Returns the robot's state just
        before it (the baseline a reaction is judged against), or None if unreadable."""
        decision, why = link_decision(self.clock(), **self.link.facts())
        if decision == FRESH:
            timing.link = f"fresh, {why}"
            return self.link.monitor.last_rep
        started = self.clock()
        try:
            rep = await self._read(PROBE_TIMEOUT)
            timing.link = f"probed in {_since_ms(started, self.clock)} ({why})"
            return rep
        except Exception as e:  # noqa: BLE001 — the link didn't answer: rebuild it
            await self.link.reconnect(f"probe failed before a command ({type(e).__name__}: {e})")
            timing.link = f"reconnected in {_since_ms(started, self.clock)} (probe failed: {type(e).__name__})"
        return await self._try_read(PROBE_TIMEOUT)

    async def _recover_unconfirmed(self, command, arg, baseline, detail, timing):
        """The cloud didn't confirm a send (no PUBACK, or the publish raised). Reconnect;
        then send again when a second copy is harmless. A start is not re-sent: if the first
        copy did get through, a second could begin another clean, and a start can take ~11 s
        to show in the shadow, so one look now is too early to call. It is WATCHed instead:
        the caller keeps the row SENT and follows it up over the start's whole window.
        Returns (outcome, detail, baseline); for WATCH the baseline is the state a reaction
        is judged against."""
        started = self.clock()
        await self.link.reconnect(f"the cloud didn't confirm {command} ({detail})")
        timing.notes.append(f"unconfirmed send ({detail}); reconnected in {_since_ms(started, self.clock)}")
        rep = await self._try_read(PROBE_TIMEOUT)
        fresh = rep if rep is not None else baseline
        if robot_reacted(mission_signature(baseline), rep):
            timing.notes.append("the robot had reacted anyway")
            return SENT, "accepted (the robot reacted)", baseline
        if command not in RESEND_SAFE:
            refused = (f"the cloud didn't confirm it ({detail}), so it may not have reached the robot. "
                       "The link was reconnected; try again")
            if baseline is None and command in START_COMMANDS and mission_under_way(rep):
                # No before-state to compare, but a clean is under way now: take it as started.
                timing.notes.append("a clean is under way after the reconnect")
                return SENT, "accepted (a clean is under way)", rep
            watch_from = baseline if baseline is not None else rep
            if reaction_expected(command, watch_from):
                timing.notes.append("watching the robot instead of sending it again")
                return WATCH, detail, watch_from
            return UNCONFIRMED, refused, fresh
        outcome, detail2 = await self._send(command, arg)
        timing.notes.append(f"sent again: {outcome}")
        if outcome == UNCONFIRMED:
            return UNCONFIRMED, f"the cloud didn't confirm it, even after reconnecting ({detail2})", fresh
        return outcome, detail2, fresh

    async def run_followup_if_due(self, link_down=None):
        """Read the robot's state if the current follow-up's next check is due, and act on
        what it shows. With `link_down` (why the cloud link is down; the main loop passes it
        after a failed cycle) nothing is read and nothing reconnects: every due check counts
        as one with nothing seen, so the schedule still ends on time and the row settles
        with the link's reason instead of waiting out the outage."""
        fu = self.followup
        if fu is None:
            return
        due = fu.next_check_at()
        if due is not None and self.clock() < due:
            return
        if link_down is not None or self.link.robot is None:
            action = fu.run_out(self.clock())
            if action == WAIT:
                return
            self.followup = None
            self._settle_link_down(fu, action, link_down or "no cloud link")
            return
        rep = None
        try:
            rep = await self._read(STATUS_READ_TIMEOUT)
        except Exception as e:  # noqa: BLE001 — counts as a check with nothing seen
            log.info("follow-up read for #%s failed: %s: %s", fu.cmd_id, type(e).__name__, e)
        action = fu.after_check(rep)
        if action == WAIT:
            return
        self.followup = None
        try:
            await self._settle(fu, action, rep)
        except Exception as e:
            # Typically the reconnect failed. Settle the row before the main loop drops the
            # link, so the page isn't left waiting on it.
            log.warning("follow-up for #%s failed: %s: %s", fu.cmd_id, type(e).__name__, e)
            if fu.verify:
                self._finish(fu.cmd_id, "FAILED", link_down_detail(fu.command, f"{type(e).__name__}: {e}"))
            raise

    def _settle_link_down(self, fu, action, reason):
        t = fu.timing
        t.done_at = self.clock()
        if action == DONE or not fu.verify:
            log.info(timing_line(fu.cmd_id, fu.command, t, f"sent; not read back (cloud link down: {reason})"))
            return
        detail = link_down_detail(fu.command, reason)
        self._finish(fu.cmd_id, "FAILED", detail)
        log.info(timing_line(fu.cmd_id, fu.command, t, f"failed ({detail})"))

    def _finish(self, cmd_id, status, detail):
        """Settle a row; a database hiccup is logged (and the write retried by the sweep),
        never mistaken for a link problem."""
        try:
            _finish_command(self.conninfo, cmd_id, status, detail)
            self.unwritten.pop(cmd_id, None)
        except Exception as e:  # noqa: BLE001
            self.unwritten[cmd_id] = (status, detail)
            log.warning("couldn't mark command #%s %s (will retry): %s: %s", cmd_id, status, type(e).__name__, e)

    def _confirmed(self, fu, how=""):
        t = fu.timing
        t.done_at = self.clock()
        if not fu.verify:
            log.info(timing_line(fu.cmd_id, fu.command, t, "sent; the robot's state moved"))
            return
        again = " again" if fu.attempt > 1 else ""
        if fu.unconfirmed and not how:
            how = " (the cloud never confirmed it, but it got there)"
        secs = (t.done_at - (t.sent_at if t.sent_at is not None else t.done_at))
        self._finish(fu.cmd_id, "OK", f"the robot reacted {secs:.1f} s after it was sent{again}{how}")
        log.info(timing_line(fu.cmd_id, fu.command, t, f"confirmed{' after a resend' if fu.attempt > 1 else ''}{how}"))

    async def _settle(self, fu, action, rep):
        t = fu.timing
        if action == CONFIRMED:
            self._confirmed(fu)
            return
        if action == DONE:
            log.info(timing_line(fu.cmd_id, fu.command, t, "sent; no reaction to check"))
            return
        wait = f"{fu.schedule[-1]:.0f} s"
        if action == RESEND:
            started = self.clock()
            await self.link.reconnect(f"no reaction to #{fu.cmd_id} ({fu.command}) within {wait}")
            t.notes.append(f"no reaction within {wait}; reconnected in {_since_ms(started, self.clock)}")
            now_rep = await self._try_read(PROBE_TIMEOUT)
            if robot_reacted(fu.baseline, now_rep):
                self._confirmed(fu, " (seen after reconnecting)")
                return
            outcome, detail = await self._send(fu.command, fu.arg)
            if outcome != SENT:
                t.done_at = self.clock()
                self._finish(fu.cmd_id, "FAILED", f"the robot didn't react, and sending it again failed ({detail})")
                log.info(timing_line(fu.cmd_id, fu.command, t, f"failed (resend: {detail})"))
                return
            t.notes.append("sent again on the new link")
            fu.resent(self.clock(), mission_signature(now_rep))
            self.followup = fu
            return
        # NO_REACTION: no second send for this one (or it was already the second).
        last = rep
        if fu.attempt == 1 and not fu.unconfirmed:
            # Rebuild the link anyway, so a retry from the page goes out on a fresh one, and
            # look once more in case the reaction was just slow. (An unconfirmed send was
            # already reconnected when the cloud didn't confirm it.)
            started = self.clock()
            await self.link.reconnect(f"no reaction to #{fu.cmd_id} ({fu.command}) within {wait}")
            t.notes.append(f"no reaction within {wait}; reconnected in {_since_ms(started, self.clock)}")
            now_rep = await self._try_read(PROBE_TIMEOUT)
            if robot_reacted(fu.baseline, now_rep):
                self._confirmed(fu, " (seen after reconnecting)")
                return
            last = now_rep if now_rep is not None else rep
        cms = (last or {}).get("cleanMissionStatus") or {}
        detail = no_reaction_detail(fu.command, fu.attempt, no_reaction_hint(last, _error_text(cms.get("error"))),
                                    unconfirmed=fu.unconfirmed)
        t.done_at = self.clock()
        self._finish(fu.cmd_id, "FAILED", detail)
        log.info(timing_line(fu.cmd_id, fu.command, t, f"failed ({detail})"))


async def listen_for_commands(conninfo, wake, *, idle_check=60.0, first_backoff=1.0, max_backoff=60.0,
                              connect=None):
    """Set `wake` whenever a command is queued: the roomba_commands insert trigger runs
    pg_notify('roomba_commands', id), and this holds a LISTEN connection for it. Runs for
    the life of the process, reconnects on its own and never raises (the main loop's
    CMD_TICK_SECONDS tick covers any gap). Also sets `wake` on every (re)connect, for a
    command queued while it wasn't listening."""
    if connect is None:
        async def connect():
            return await psycopg.AsyncConnection.connect(conninfo, autocommit=True, connect_timeout=10)
    backoff = first_backoff
    while True:
        try:
            conn = await connect()
            async with conn:
                conn.add_notify_handler(lambda _n: wake.set())
                await conn.execute(f"LISTEN {COMMAND_CHANNEL}")
                log.info("Listening for queued commands (Postgres LISTEN %s)", COMMAND_CHANNEL)
                backoff = first_backoff
                wake.set()
                while True:
                    async for _n in conn.notifies(timeout=idle_check):
                        wake.set()
                    # Quiet for a while: make sure the connection is still there.
                    await conn.execute("SELECT 1")
        except asyncio.CancelledError:
            raise
        except Exception as e:  # noqa: BLE001 — fail-open; the tick covers the gap
            log.warning("Command listener down (%s: %s); retrying in %.0fs, the %.0fs tick covers it meanwhile",
                        type(e).__name__, e, backoff, CMD_TICK_SECONDS)
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, max_backoff)


async def _sleep_until_woken(wake, timeout):
    """Sleep up to `timeout` s, ending early when `wake` is set. Says what ended it."""
    if wake.is_set():
        return "busy"
    try:
        await asyncio.wait_for(wake.wait(), timeout=max(0.0, timeout))
        return "notify"
    except (asyncio.TimeoutError, TimeoutError):
        return "tick"


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

    log.info("Roomba poller starting (poll every %ss; commands wake on Postgres NOTIFY, %ss tick as fallback)",
             interval, CMD_TICK_SECONDS)
    _settle_interrupted_commands(conninfo)

    wake = asyncio.Event()
    listener = asyncio.ensure_future(listen_for_commands(conninfo, wake))
    try:
        async with aiohttp.ClientSession() as session:
            # Commands used to force a full reconnect before every send: the cloud MQTT
            # link went "zombie" as its token aged (Sept 2026, roombapy-prime 0.3.1). Now a
            # recent shadow round trip on the same connection proves it (or a quick read
            # does), the library refreshes the token itself (auto_refresh) and confirms
            # every publish (PUBACK), and a sent command is read back until the robot
            # reacts. See command_flow.py.
            link = CloudLink(session, (email, password, country, blid), state)
            runner = CommandRunner(link, conninfo, state)
            last_poll = 0.0
            woke = "start"
            failures = 0  # failed cycles in a row
            while True:
                try:
                    await link.ensure()
                    wake.clear()
                    # Commands first: a queued command never waits behind a poll, a map
                    # refresh or a history sync in the same pass.
                    await runner.run_pending(woke)
                    await runner.run_followup_if_due()
                    await link.ensure()  # in case a reconnect above didn't complete
                    if link.poll_now:
                        last_poll = 0.0  # poll immediately after (re)connect
                        link.poll_now = False
                    robot = link.robot
                    now = time.monotonic()
                    # Poll fast while a mission is running (or was just commanded) so the
                    # live dot + coverage stay current and mission start/end are caught
                    # promptly; otherwise fall back to the normal, quieter interval.
                    fast = state.mission_running or now < state.fast_poll_until
                    poll_interval = FAST_POLL_INTERVAL if fast else interval
                    # Each step below yields to a command that arrived meanwhile (wake
                    # set): the loop comes straight back round; what was due stays due.
                    if not wake.is_set() and now - last_poll >= poll_interval:
                        await poll_once(robot, conninfo, state)
                        last_poll = now
                    # A recent map edit asked for a prompt bundle re-fetch — do it once the
                    # short settle delay has passed (poll_once above may already have, which
                    # makes this a cheap no-op via the version check in refresh_map).
                    if not wake.is_set() and state.map_refresh_due is not None and now >= state.map_refresh_due:
                        state.map_refresh_due = None
                        await refresh_map(robot, conninfo, robot.blid, state, None)
                    # Same one-shot after a completed run for the maintenance counters.
                    if not wake.is_set() and state.parts_refresh_due is not None and now >= state.parts_refresh_due:
                        state.parts_refresh_due = None
                        await refresh_parts(robot, conninfo, robot.blid, state, force=True)
                    # The cloud's mission history: on start (backfills runs missed while
                    # down), a minute after each run ends, and every half hour.
                    if not wake.is_set() and now >= state.history_due:
                        await sync_history(robot, conninfo, state)
                    # Keep the concurrent live-position task in sync with mission state.
                    link.live_task = await _manage_live_task(link.live_task, robot, conninfo, state)
                    runner.sweep_if_due()
                    failures = 0
                except asyncio.CancelledError:
                    await _cancel_live_task(link.live_task)
                    link.live_task = None
                    raise
                except Exception as e:  # noqa: BLE001 — fail-open, reconnect next cycle
                    failures += 1
                    backoff = failure_backoff(failures)
                    reason = f"{type(e).__name__}: {e}"
                    log.warning("Cycle failed (%s); reconnecting in %.0fs", reason, backoff)
                    await link.drop()
                    # A command being followed up can't be read back now: let its schedule
                    # run out without the link, so its row settles instead of waiting out
                    # the outage. Nothing here logs in.
                    try:
                        await runner.run_followup_if_due(link_down=reason)
                    except Exception as e2:  # noqa: BLE001
                        log.warning("follow-up during the outage failed: %s: %s", type(e2).__name__, e2)
                    runner.sweep_if_due()
                    # A plain wait: not cut short by a NOTIFY or a due check, because every
                    # retry is a full cloud login and repeated logins lock the account.
                    await asyncio.sleep(backoff)
                    woke = "retry"
                    continue
                woke = await _sleep_until_woken(
                    wake, loop_sleep(time.monotonic(), tick=CMD_TICK_SECONDS, next_check=runner.next_check_at()))
    finally:
        listener.cancel()
        with contextlib.suppress(asyncio.CancelledError, Exception):
            await listener


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        sys.exit(130)
