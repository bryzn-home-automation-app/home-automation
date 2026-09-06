r"""
Recreates Bryan's two Roomba-tab (app-side, non-native) schedules as REAL
native schedules, now that probe6/probe7 confirmed create/delete work:

  Schedule A: Mon + Fri, 9:00 AM, vac+mop, every room except the office
  Schedule B: Tue/Wed/Thu, 9:00 AM, vac only, every room except the office

UNLIKE probe6, these are created with enabled=True -- they are meant to
actually run. Room selection is "every mapped room whose name does not
contain 'office' (case-insensitive)".

Usage:
    probe8_schedule_recreate.py --dry-run     # list rooms + print payloads only
    probe8_schedule_recreate.py --commit      # actually calls create_schedules

ALWAYS run --dry-run first and check the printed "INCLUDED ROOMS" /
"EXCLUDED ROOMS" lists name the right rooms before --commit -- there is no
undo once the robot starts using these to decide what "clean" means at 9am.

Prereq: stop roomba-poller first (single-connection constraint). Restart it
after.
"""
import asyncio
import getpass
import json
import os
import sys

import aiohttp
from roombapy_prime.models.map_bundle import parse_map_bundle
from roombapy_prime.models.mission_control import (
    CommandParams,
    MissionCommandType,
    Region,
    RegionType,
    RoutineCommand,
)
from roombapy_prime.models.schedules_dnd import ScheduleFrequency, ScheduleOptions, ScheduleTime
from roombapy_prime.prime_factory import PrimeFactory

try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

# Vendor operating-mode codec, confirmed in poller.py::_clean_command_params:
# 2 = vacuum, 4 = mop, 6 = vac+mop.
MODE_VACUUM = 2
MODE_VACMOP = 6
EXCLUDE_NAME_SUBSTRING = "office"


def _cred(name: str, prompt: str, secret: bool = False) -> str:
    val = os.environ.get(name)
    if val:
        return val
    return (getpass.getpass if secret else input)(prompt)


def _dump(obj, limit: int = 6000) -> str:
    payload = getattr(obj, "__dict__", obj)
    try:
        text = json.dumps(payload, indent=2, default=str)
    except Exception:
        text = repr(payload)
    return text if len(text) <= limit else text[:limit] + "\n  … (truncated)"


def _all_rooms(bundle: dict) -> list[tuple[str, str]]:
    """Every (id, name) pair for GeoJSON features that look like rooms,
    across every file in the parsed map bundle."""
    out = []
    seen_ids = set()
    for _key, content in bundle.items():
        if not isinstance(content, dict):
            continue
        features = content.get("features")
        if not isinstance(features, list):
            continue
        for feat in features:
            if not isinstance(feat, dict):
                continue
            fid = feat.get("id")
            props = feat.get("properties") or {}
            name = props.get("name") if isinstance(props, dict) else None
            if fid and isinstance(props, dict) and ("name" in props or "type" in props):
                if str(fid) not in seen_ids:
                    seen_ids.add(str(fid))
                    out.append((str(fid), name or f"(unnamed {fid})"))
    return out


def _build_command(robot_blid, map_id, room_ids, mode):
    regions = [
        Region(region_id=rid, region_type=RegionType.RID, params=CommandParams(operating_mode=mode))
        for rid in room_ids
    ]
    return RoutineCommand(
        command_type=MissionCommandType.START,
        asset_id=robot_blid,
        map_id=map_id,
        regions=regions,
        initiator="rmtApp",
    )


async def main() -> int:
    dry_run = "--commit" not in sys.argv
    print(f"\n=== Recreate schedules ({'DRY RUN' if dry_run else 'COMMIT'}) ===\n")

    email = _cred("IROBOT_EMAIL", "iRobot account email: ")
    password = _cred("IROBOT_PASSWORD", "iRobot account password: ", secret=True)
    country = os.environ.get("IROBOT_COUNTRY", "US")

    async with aiohttp.ClientSession() as session:
        robot = await PrimeFactory.create_prime_robot(
            session=session, username=email, password=password, country_code=country,
        )
        await robot.connect(timeout=15.0)
        print(f"Connected. BLID: {robot.blid}")

        household_id = await robot.get_household_id()
        print(f"household_id = {household_id}")
        if not household_id:
            print("ABORT: no household_id")
            return 2

        versions = await robot.get_active_map_versions()
        if not (isinstance(versions, list) and versions):
            print("ABORT: no active map")
            return 3
        v0 = versions[0]
        p2map_id = v0.get("p2map_id") or v0.get("p2mapId")
        map_version = v0.get("active_p2mapv_id")

        link = await robot.get_map_geojson_link(p2map_id, map_version)
        url = link.get("map_url") if isinstance(link, dict) else None
        if not url:
            print("ABORT: no map bundle URL")
            return 3
        raw = await robot.download_map_bundle(url)
        bundle = parse_map_bundle(raw)
        rooms = _all_rooms(bundle)

        included = [(rid, name) for rid, name in rooms if EXCLUDE_NAME_SUBSTRING not in name.lower()]
        excluded = [(rid, name) for rid, name in rooms if EXCLUDE_NAME_SUBSTRING in name.lower()]

        print(f"\nmap_id={p2map_id}\n")
        print("INCLUDED ROOMS (will be cleaned):")
        for rid, name in included:
            print(f"  {rid:>4}  {name}")
        print("\nEXCLUDED ROOMS (matched 'office'):")
        for rid, name in excluded:
            print(f"  {rid:>4}  {name}")
        if not excluded:
            print("  (none -- ABORT if you expected the office to be excluded here)")

        room_ids = [rid for rid, _ in included]
        if not room_ids:
            print("\nABORT: no rooms would be included -- refusing to create an empty schedule.")
            return 4

        cmd_vacmop = _build_command(robot.blid, p2map_id, room_ids, MODE_VACMOP)
        cmd_vacuum = _build_command(robot.blid, p2map_id, room_ids, MODE_VACUUM)

        schedule_a = ScheduleOptions(
            asset_id=robot.blid,
            name="Mon/Fri vac+mop (all but office)",
            frequency=ScheduleFrequency.WEEKLY,
            start=ScheduleTime(day=[1, 5], hour=9, min=0),  # Mon, Fri
            commands=[cmd_vacmop],
            enabled=True,
        )
        schedule_b = ScheduleOptions(
            asset_id=robot.blid,
            name="Tue-Thu vacuum (all but office)",
            frequency=ScheduleFrequency.WEEKLY,
            start=ScheduleTime(day=[2, 3, 4], hour=9, min=0),  # Tue, Wed, Thu
            commands=[cmd_vacuum],
            enabled=True,
        )

        print("\n--- Schedule A payload ---")
        print(_dump(schedule_a.to_json()))
        print("\n--- Schedule B payload ---")
        print(_dump(schedule_b.to_json()))

        if dry_run:
            print("\nDRY RUN ONLY -- nothing was written. Re-run with --commit once "
                  "the room lists above look right.")
            await robot.disconnect()
            return 0

        # CONFIRMED ON HARDWARE (2026-09-06): passing multiple ScheduleOptions in
        # one create_schedules() call does NOT create multiple schedules -- only
        # the LAST item in the list was persisted (get_schedules() afterward
        # showed just one household_schedule_id). The type signature
        # (schedules: list[ScheduleOptions]) suggests batch-create; it isn't one.
        # One create_schedules() call per schedule is the only way confirmed to
        # work -- exactly the "a confirmed send proves delivery, never intent"
        # trap this project's own control.md warns about, just for batching
        # rather than a single malformed command.
        only = None
        for arg in sys.argv:
            if arg.startswith("--only="):
                only = arg.split("=", 1)[1].strip().upper()
        candidates = [("A", schedule_a), ("B", schedule_b)]
        if only:
            candidates = [(l, s) for l, s in candidates if l == only]
            print(f"\n--only={only}: creating just schedule {only}.")

        for label, schedule in candidates:
            try:
                result = await robot.create_schedules(household_id, [schedule])
                print(f"\ncreate_schedules() response (schedule {label}):")
                print(_dump(result))
            except Exception as e:
                print(f"\ncreate_schedules() FAILED (schedule {label}): {type(e).__name__}: {e}")
                return 5

        readback = await robot.get_schedules(household_id)
        print("\nget_schedules() read-back:")
        print(_dump(readback))

        try:
            await robot.disconnect()
        except Exception:
            pass

    return 0


if __name__ == "__main__":
    try:
        sys.exit(asyncio.run(main()))
    except KeyboardInterrupt:
        sys.exit(130)
