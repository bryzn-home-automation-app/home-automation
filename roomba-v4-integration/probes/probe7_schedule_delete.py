r"""
Native schedule DELETE probe -- cleans up a schedule created by
probe6_schedule_create.py (or any other schedule_id you point it at).

Usage:
    .venv\Scripts\python probes\probe7_schedule_delete.py <household_schedule_id>

CONFIRMED ON HARDWARE (2026-09-06): pass the OUTER id -- the
`household_schedule_id` field / the schedules-list entry's own top-level
`schedule_id` (e.g. "hh_irbt.hh...._QM897WZEP1Pz_s") -- NOT the nested
`options.schedule_id`, which carries a robot-suffixed variant of the same id
(e.g. "..._QM897WZEP1Pz_s_B138") and 500s the delete endpoint. Both look like
plausible "the id" at a glance; only the un-suffixed outer one works.

Prints get_schedules() before and after so the delete is visibly confirmed,
not just "no exception raised."

Prereq: stop roomba-poller first (single-connection constraint). Restart it
after.
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
    payload = getattr(obj, "__dict__", obj)
    try:
        text = json.dumps(payload, indent=2, default=str)
    except Exception:
        text = repr(payload)
    return text if len(text) <= limit else text[:limit] + "\n  … (truncated)"


async def main() -> int:
    if len(sys.argv) < 2:
        print("usage: probe7_schedule_delete.py <schedule_id>")
        return 1
    schedule_id = sys.argv[1]

    email = _cred("IROBOT_EMAIL", "iRobot account email: ")
    password = _cred("IROBOT_PASSWORD", "iRobot account password: ", secret=True)
    country = os.environ.get("IROBOT_COUNTRY", "US")

    async with aiohttp.ClientSession() as session:
        robot = await PrimeFactory.create_prime_robot(
            session=session, username=email, password=password, country_code=country,
        )
        await robot.connect(timeout=15.0)
        household_id = await robot.get_household_id()
        if not household_id:
            print("ABORT: no household_id")
            return 2

        before = await robot.get_schedules(household_id)
        print("Before delete:")
        print(_dump(before))

        try:
            result = await robot.delete_schedule(household_id, schedule_id)
            print(f"\ndelete_schedule({schedule_id}) response:")
            print(_dump(result))
        except Exception as e:
            print(f"\ndelete_schedule() FAILED: {type(e).__name__}: {e}")
            return 3

        after = await robot.get_schedules(household_id)
        print("\nAfter delete:")
        print(_dump(after))

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
