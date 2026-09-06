r"""
Native schedule CREATE probe -- weekday recurrence test, DISABLED by default.

Context: probe5_schedules.py confirmed get_household_id()/get_schedules() work
and that this account has ZERO native schedules today (the Roomba tab's
existing scheduler never wrote one -- see that probe's docstring). This probe
attempts the write side: create_schedules(), which control.md flags as
"Untested / deliberately not built ... Highest 'surprise activity' risk of
anything here" because a wrong write could make the robot start cleaning when
nobody expects it.

SAFETY DESIGN, in order of how much risk each one removes:

  1. The created schedule is written with enabled=False. A disabled schedule
     cannot fire, period -- this is the load-bearing safety property of this
     whole probe. Nothing here can make the robot start cleaning by itself.
  2. It targets weekdays only (ISO 1-5, Mon-Fri) at a fixed test time, purely
     so the printed/app-visible result is easy to eyeball against "did the
     right 5 boxes get checked."
  3. commands=[<single-room clean>], reusing the EXACT RoutineCommand shape
     already confirmed working on hardware for the manual "clean this room"
     button (poller.py::_clean_room: command_type=START, real map_id, one RID
     region, initiator="rmtApp") -- not a hand-guessed whole-house schedule
     shape, which is separately unconfirmed. The room used is just whatever
     the live map reports first; which room doesn't matter since the
     schedule never fires.
  4. Prints the created schedule_id up front and the full read-back after, so
     it can be deleted (via probe7_schedule_delete.py, or by hand in the
     iRobot app) with certainty about which one it is.

What this does NOT do: it does not enable the schedule, and it does not
delete anything from get_schedules()'s existing list (there is nothing to
delete -- probe5 found it empty).

Run: .venv\Scripts\python probes\probe6_schedule_create.py
Prereq: stop roomba-poller first (single-connection constraint), same as
probe5. Restart it after.
"""
import asyncio
import getpass
import json
import os
import sys

import aiohttp
from roombapy_prime.models.map_bundle import parse_map_bundle
from roombapy_prime.models.mission_control import MissionCommandType, Region, RegionType, RoutineCommand
from roombapy_prime.models.schedules_dnd import ScheduleFrequency, ScheduleOptions, ScheduleTime
from roombapy_prime.prime_factory import PrimeFactory

try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

# ISO weekday numbers are what our own app already uses (RoombaScheduleService),
# but ScheduleTime.day's numbering base for THIS API is unconfirmed on this
# account (no existing schedule to read the convention off of -- see probe5).
# Printing the read-back after create is how we find out: compare which boxes
# are actually checked in the iRobot app against this list.
WEEKDAY_GUESS = [1, 2, 3, 4, 5]
TEST_HOUR = 10
TEST_MINUTE = 0


def _cred(name: str, prompt: str, secret: bool = False) -> str:
    val = os.environ.get(name)
    if val:
        return val
    return (getpass.getpass if secret else input)(prompt)


def _dump(obj, limit: int = 4000) -> str:
    payload = getattr(obj, "__dict__", obj)
    try:
        text = json.dumps(payload, indent=2, default=str)
    except Exception:
        text = repr(payload)
    return text if len(text) <= limit else text[:limit] + "\n  … (truncated)"


def _find_first_room_id(bundle: dict) -> str | None:
    """Best-effort: scan every file in the parsed map bundle for the first
    GeoJSON Feature that looks like a room (has an 'id' and Room-ish
    properties). Deliberately generic since the bundle's exact file/key
    layout isn't something this repo has documented yet -- this is
    exploratory, only used to get ANY valid region id for the disabled test
    schedule."""
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
            if fid and isinstance(props, dict) and ("name" in props or "type" in props):
                return str(fid)
    return None


async def main() -> int:
    email = _cred("IROBOT_EMAIL", "iRobot account email: ")
    password = _cred("IROBOT_PASSWORD", "iRobot account password: ", secret=True)
    country = os.environ.get("IROBOT_COUNTRY", "US")

    print("\n=== Native schedule CREATE probe (disabled, weekdays) ===")
    print(f"Account: {email}   Country: {country}\n")

    async with aiohttp.ClientSession() as session:
        robot = await PrimeFactory.create_prime_robot(
            session=session, username=email, password=password, country_code=country,
        )
        print(f"[1/6] Login OK. Robot BLID: {getattr(robot, 'blid', '?')}")

        await robot.connect(timeout=15.0)
        print("[2/6] Connect OK.")

        household_id = await robot.get_household_id()
        print(f"[3/6] household_id = {household_id}")
        if not household_id:
            print("ABORT: no household_id, cannot create a schedule.")
            return 2

        # --- find a real room id to target (schedule never fires, so which
        # room is irrelevant -- just need something valid-shaped) ---
        versions = await robot.get_active_map_versions()
        if not (isinstance(versions, list) and versions):
            print("ABORT: no active map -- cannot get a map_id/room_id for the command.")
            return 3
        v0 = versions[0]
        p2map_id = v0.get("p2map_id") or v0.get("p2mapId")
        map_version = v0.get("active_p2mapv_id")
        link = await robot.get_map_geojson_link(p2map_id, map_version)
        url = link.get("map_url") if isinstance(link, dict) else None
        if not url:
            print("ABORT: could not get a map bundle download URL.")
            return 3
        raw = await robot.download_map_bundle(url)
        bundle = parse_map_bundle(raw)
        room_id = _find_first_room_id(bundle)
        print(f"[4/6] map_id={p2map_id}  room_id (test target)={room_id}")
        if not room_id:
            print("ABORT: could not find any room id in the map bundle -- "
                  "printing bundle keys for manual inspection:")
            print(list(bundle.keys()))
            return 4

        region = Region(region_id=room_id, region_type=RegionType.RID, params=None)
        command = RoutineCommand(
            command_type=MissionCommandType.START,
            asset_id=robot.blid,
            map_id=p2map_id,
            regions=[region],
            initiator="rmtApp",
        )
        options = ScheduleOptions(
            asset_id=robot.blid,
            name="TEST - weekday probe (safe to delete)",
            frequency=ScheduleFrequency.WEEKLY,
            start=ScheduleTime(day=WEEKDAY_GUESS, hour=TEST_HOUR, min=TEST_MINUTE),
            commands=[command],
            enabled=False,  # <-- load-bearing: cannot fire while False
        )

        print("\n[5/6] Creating schedule (enabled=False) with body:")
        print(_dump(options.to_json()))
        try:
            result = await robot.create_schedules(household_id, [options])
            print("\ncreate_schedules() response:")
            print(_dump(result))
        except Exception as e:
            print(f"\n[5/6] create_schedules() FAILED: {type(e).__name__}: {e}")
            return 5

        try:
            readback = await robot.get_schedules(household_id)
            print("\n[6/6] get_schedules() read-back:")
            print(_dump(readback))
        except Exception as e:
            print(f"[6/6] read-back FAILED: {type(e).__name__}: {e}")

        try:
            await robot.disconnect()
        except Exception:
            pass

    print("\n=== NEXT STEPS ===")
    print("1. Open the iRobot app and check whether 'TEST - weekday probe' now")
    print("   appears (disabled/off) with Mon-Fri checked.")
    print("2. Note the schedule_id from the read-back above.")
    print("3. Delete it via probe7_schedule_delete.py, or from the app directly.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(asyncio.run(main()))
    except KeyboardInterrupt:
        sys.exit(130)
