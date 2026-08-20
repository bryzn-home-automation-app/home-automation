r"""
Probe #4 — do we have any clean zones / favorites to name? (read-only)

Zone naming (issue #75) only makes sense if zones exist. This reads saved favorites
(saved clean zones/regions) and the map's rooms. No writes.
"""
import asyncio
import dataclasses
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


def _cred(name, prompt, secret=False):
    return os.environ.get(name) or (getpass.getpass if secret else input)(prompt)


def _plain(o):
    if dataclasses.is_dataclass(o) and not isinstance(o, type):
        return dataclasses.asdict(o)
    return getattr(o, "payload", o)


def _dump(o, limit=4000):
    try:
        t = json.dumps([_plain(x) for x in o] if isinstance(o, list) else _plain(o),
                       indent=2, default=str)
    except Exception:
        t = repr(o)
    return t if len(t) <= limit else t[:limit] + "\n  … (truncated)"


async def main():
    email = _cred("IROBOT_EMAIL", "iRobot account email: ")
    password = _cred("IROBOT_PASSWORD", "iRobot account password: ", secret=True)
    country = os.environ.get("IROBOT_COUNTRY", "US")

    async with aiohttp.ClientSession() as session:
        robot = await PrimeFactory.create_prime_robot(
            session=session, username=email, password=password, country_code=country
        )
        print(f"Login OK — BLID {robot.blid}")
        await robot.connect(timeout=15.0)

        print("\n===== get_favorites() — saved clean zones/regions =====")
        try:
            favs = await robot.get_favorites()
            n = len(favs) if isinstance(favs, list) else "?"
            print(f"  favorites count: {n}")
            print(_dump(favs))
        except Exception as e:
            print(f"  FAILED: {type(e).__name__}: {e}")

        print("\n===== get_favorites_raw() =====")
        try:
            print(_dump(await robot.get_favorites_raw(), limit=2500))
        except Exception as e:
            print(f"  FAILED: {type(e).__name__}: {e}")

        try:
            await robot.disconnect()
        except Exception:
            pass

    print("\nDone. Paste output back.")


if __name__ == "__main__":
    try:
        sys.exit(asyncio.run(main()) or 0)
    except KeyboardInterrupt:
        sys.exit(130)
