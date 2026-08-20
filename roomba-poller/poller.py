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
import logging
import os
import sys
import uuid
from datetime import datetime, timezone

import aiohttp
import psycopg
from psycopg.types.json import Json
from roombapy_prime.models.map_bundle import parse_map_bundle
from roombapy_prime.prime_factory import PrimeFactory

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
        return datetime.utcfromtimestamp(int(epoch)).replace(tzinfo=timezone.utc)
    except (ValueError, TypeError, OverflowError):
        return None


def _runtime_minutes(rep):
    rs = rep.get("runtimeStats") or {}
    try:
        return int(rs.get("hr", 0)) * 60 + int(rs.get("min", 0))
    except (ValueError, TypeError):
        return None


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


def _snapshot(cms, rep):
    return {
        "mission_id": cms.get("missionId"),
        "started_at": _epoch_to_utc(cms.get("mssnStrtTm")),
        "sqft": cms.get("sqft"),
        "runtime_minutes": _runtime_minutes(rep),
        "error": cms.get("error", 0),
        "phase": cms.get("phase"),
    }


# ---------------------------------------------------------------------------
# DB writes (each opens its own short-lived autocommit connection — simplest
# robust option at a 60s cadence; a dead connection just fails this one cycle)
# ---------------------------------------------------------------------------
def upsert_status(conninfo, robot_id, name, rep, stats, map_version):
    cms = rep.get("cleanMissionStatus") or {}
    lifetime_missions = None
    lifetime_run_minutes = None
    if stats:
        bbmssn = stats.get("bbmssn") or {}
        bbsys = stats.get("bbsys") or {}
        lifetime_missions = bbmssn.get("nMssn")
        if bbsys:
            try:
                lifetime_run_minutes = int(bbsys.get("hr", 0)) * 60 + int(bbsys.get("min", 0))
            except (ValueError, TypeError):
                lifetime_run_minutes = None

    sql = """
        INSERT INTO roomba_status (
            robot_id, name, battery_pct, phase, cycle, error, bin_present,
            tank_present, current_mission_id, mission_start, sqft, runtime_minutes,
            dock_state, lifetime_missions, lifetime_run_minutes, map_version, raw,
            updated_at
        ) VALUES (
            %(robot_id)s, %(name)s, %(battery_pct)s, %(phase)s, %(cycle)s, %(error)s,
            %(bin_present)s, %(tank_present)s, %(current_mission_id)s, %(mission_start)s,
            %(sqft)s, %(runtime_minutes)s, %(dock_state)s, %(lifetime_missions)s,
            %(lifetime_run_minutes)s, %(map_version)s, %(raw)s, NOW()
        )
        ON CONFLICT (robot_id) DO UPDATE SET
            name = EXCLUDED.name,
            battery_pct = EXCLUDED.battery_pct,
            phase = EXCLUDED.phase,
            cycle = EXCLUDED.cycle,
            error = EXCLUDED.error,
            bin_present = EXCLUDED.bin_present,
            tank_present = EXCLUDED.tank_present,
            current_mission_id = EXCLUDED.current_mission_id,
            mission_start = EXCLUDED.mission_start,
            sqft = EXCLUDED.sqft,
            runtime_minutes = EXCLUDED.runtime_minutes,
            dock_state = EXCLUDED.dock_state,
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
        "bin_present": (rep.get("bin") or {}).get("present"),
        "tank_present": rep.get("tankPresent"),
        "current_mission_id": cms.get("missionId"),
        "mission_start": _epoch_to_utc(cms.get("mssnStrtTm")),
        "sqft": cms.get("sqft"),
        "runtime_minutes": _runtime_minutes(rep),
        "dock_state": (rep.get("dock") or {}).get("state"),
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
    duration = snap.get("runtime_minutes")
    started = snap.get("started_at")
    completed = datetime.now(timezone.utc)
    if not duration and started is not None:
        duration = max(0, int((completed - started).total_seconds() // 60))
    sql = """
        INSERT INTO roomba_runs (
            started_at, completed_at, duration_minutes, dirt_events, square_feet,
            status, source, source_provider, ingestion_batch_id
        ) VALUES (
            %s, %s, %s, NULL, %s, %s, 'roombapy-prime', 'irobot', %s
        )
    """
    with psycopg.connect(conninfo, autocommit=True) as conn:
        conn.execute(
            sql,
            (started, completed, duration, snap.get("sqft"), status, str(uuid.uuid4())),
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
            if cur_mid == prev["mission_id"]:
                if cms.get("sqft") is not None:
                    completed["sqft"] = cms.get("sqft")
                rt = _runtime_minutes(rep)
                if rt:
                    completed["runtime_minutes"] = rt
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

    # Refresh / set the active snapshot for the currently-running mission.
    if cur_running:
        state.active = _snapshot(cms, rep)
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

    if state.last_map_version is None:
        # Lazily learn what's already persisted so we don't refetch on restart.
        try:
            state.last_map_version = load_map_version(conninfo, robot_id)
        except Exception as e:  # noqa: BLE001
            log.warning("load_map_version failed: %s: %s", type(e).__name__, e)

    if map_version == state.last_map_version:
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
        state.last_map_version = map_version
        log.info("Updated map %s version=%s (%d bytes)", map_id, map_version, len(raw))
    except Exception as e:  # noqa: BLE001
        log.warning("Map refresh failed: %s: %s", type(e).__name__, e)


# ---------------------------------------------------------------------------
# Cloud connection + main loop
# ---------------------------------------------------------------------------
async def connect_robot(session, email, password, country, blid):
    robot = await PrimeFactory.create_prime_robot(
        session=session, username=email, password=password,
        country_code=country, blid=blid or None,
    )
    await robot.connect(timeout=15.0)
    log.info("Connected to Roomba (BLID %s)", robot.blid)
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
    name = getattr(robot, "name", None)
    robot_id = robot.blid

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

    log.info("Roomba poller starting (interval=%ss)", interval)

    async with aiohttp.ClientSession() as session:
        robot = None
        while True:
            try:
                if robot is None:
                    robot = await connect_robot(session, email, password, country, blid)
                await poll_once(robot, conninfo, state)
            except asyncio.CancelledError:
                raise
            except Exception as e:  # noqa: BLE001 — fail-open, reconnect next cycle
                log.warning("Cycle failed (%s: %s); will reconnect", type(e).__name__, e)
                if robot is not None:
                    try:
                        await robot.disconnect()
                    except Exception:
                        pass
                robot = None
            await asyncio.sleep(interval)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        sys.exit(130)
