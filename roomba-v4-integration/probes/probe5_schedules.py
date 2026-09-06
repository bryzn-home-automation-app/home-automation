r"""
Native schedule probe — read-only.

Context: the Roomba tab's existing scheduler (RoombaScheduleScheduler.java) is
app-side only -- it fires a plain "start cleaning" command at the right time,
and never touches the robot's own onboard/cloud schedule. That's why a schedule
made there never showed up in the iRobot app. This probe checks what it would
take to read (and, eventually, write) the robot's REAL native schedule via
roombapy-prime's cloud API, which is what the official app itself reads.

Confirms:
  1. get_household_id() resolves for this account/robot.
  2. get_schedules(household_id) returns your actual weekly schedule.
  3. The exact JSON shape of a real schedule entry -- required before any
     create_schedules()/update_schedules() write can be attempted safely
     (the server 500s on an incomplete schedule body; a new one must be
     derived from an existing one, per this project's own control.md notes).

SAFETY: read-only. Calls nothing but get_household_id() and get_schedules().
No send_simple_command, no create_schedules, no update_schedules.

SINGLE-CONNECTION WARNING: roombapy-prime's docs say two simultaneous
connections cause a reconnect storm. STOP the roomba-poller container before
running this, and restart it after:
    ssh nuc "cd <repo> && docker compose stop roomba-poller"
    ... run this probe ...
    ssh nuc "cd <repo> && docker compose start roomba-poller"

Credentials are read from environment variables (same ones poller.py uses),
so they never live in this file or in shell history:
    IROBOT_EMAIL     your iRobot Home App account email
    IROBOT_PASSWORD  that account's password
    IROBOT_COUNTRY   two-letter country code (default: US)

Run: .venv\Scripts\python probes\probe5_schedules.py
"""
import asyncio
import getpass
import json
import os
import sys

import aiohttp
from roombapy_prime.prime_factory import PrimeFactory

try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass


def _cred(name: str, prompt: str, secret: bool = False) -> str:
    val = os.environ.get(name)
    if val:
        return val
    return (getpass.getpass if secret else input)(prompt)


def _dump(obj, limit: int = 4000) -> str:
    """Best-effort pretty JSON of a parsed response or raw dict, capped in length."""
    payload = getattr(obj, "__dict__", obj)
    try:
        text = json.dumps(payload, indent=2, default=str)
    except Exception:
        text = repr(payload)
    return text if len(text) <= limit else text[:limit] + "\n  … (truncated)"


async def main() -> int:
    email = _cred("IROBOT_EMAIL", "iRobot account email: ")
    password = _cred("IROBOT_PASSWORD", "iRobot account password: ", secret=True)
    country = os.environ.get("IROBOT_COUNTRY", "US")

    print("\n=== Native schedule probe (read-only) ===")
    print(f"Account: {email}   Country: {country}\n")

    results: dict[str, str] = {}

    async with aiohttp.ClientSession() as session:
        try:
            robot = await PrimeFactory.create_prime_robot(
                session=session, username=email, password=password, country_code=country,
            )
            print(f"[1/4] Login OK. Robot BLID: {getattr(robot, 'blid', '?')}")
        except Exception as e:
            print(f"[1/4] Login FAILED: {type(e).__name__}: {e}")
            return 2

        try:
            await robot.connect(timeout=15.0)
            print("[2/4] Connect OK.")
        except Exception as e:
            print(f"[2/4] Connect FAILED: {type(e).__name__}: {e}")
            return 3

        household_id = None
        try:
            household_id = await robot.get_household_id()
            print(f"[3/4] get_household_id() OK -> {household_id}")
            results["household_id"] = "OK" if household_id else "returned None"
        except Exception as e:
            print(f"[3/4] get_household_id() FAILED: {type(e).__name__}: {e}")
            results["household_id"] = f"FAIL ({type(e).__name__})"

        if household_id:
            try:
                schedules = await robot.get_schedules(household_id)
                print("[4/4] get_schedules() OK -- raw shape:")
                print(_dump(schedules))
                results["schedules"] = "OK"
            except Exception as e:
                print(f"[4/4] get_schedules() FAILED: {type(e).__name__}: {e}")
                results["schedules"] = f"FAIL ({type(e).__name__})"
        else:
            print("[4/4] skipped -- no household_id")
            results["schedules"] = "skip"

        try:
            await robot.disconnect()
        except Exception:
            pass

    print("\n=== VERDICT ===")
    for step in ("household_id", "schedules"):
        print(f"  {step:13} {results.get(step, '—')}")

    if results.get("schedules") == "OK":
        print("\n✅ Native schedule read works. Compare the printed shape against "
              "what you set in the iRobot app to confirm the field names, then "
              "record findings before attempting any write.")
        return 0
    print("\n❌ Could not read the native schedule -- see the failure above.")
    return 1


if __name__ == "__main__":
    try:
        sys.exit(asyncio.run(main()))
    except KeyboardInterrupt:
        sys.exit(130)
