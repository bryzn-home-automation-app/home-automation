r"""
Roomba 105 (V4/Prime) probe #2 — find where live battery/phase and run data live.

Probe #1 proved auth/connect/state/history calls succeed, but get_state() returned
only capabilities and get_mission_history() was empty. On these V4 robots the live
telemetry lives in NAMED shadows (ro-currentstate etc.), so this probe dumps those
plus a brief live watch. Still 100% read-only — sends no commands.

Credentials via env (IROBOT_EMAIL / IROBOT_PASSWORD / IROBOT_COUNTRY=US) or prompt.
Setup + run: see roomba-v4-integration/README.md. In short:
    .venv\Scripts\python probes\probe2_shadows.py
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


def _cred(name, prompt, secret=False):
    return os.environ.get(name) or (getpass.getpass if secret else input)(prompt)


def _payload(obj):
    return getattr(obj, "payload", obj)


def _dump(obj, limit=6000):
    try:
        text = json.dumps(_payload(obj), indent=2, default=str)
    except Exception:
        text = repr(_payload(obj))
    return text if len(text) <= limit else text[:limit] + "\n  … (truncated)"


def _find_keys(obj, keys):
    """Recursively search a nested dict/list for any of `keys`; return {key: value}."""
    found = {}

    def walk(o):
        if isinstance(o, dict):
            for k, v in o.items():
                if k in keys and k not in found:
                    found[k] = v
                walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)

    walk(_payload(obj))
    return found


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
        print("Connected.\n")

        interesting = {
            "batPct", "cleanMissionStatus", "phase", "cycle", "error",
            "mssnM", "sqft", "nMssn", "bin", "binFull", "bat", "batteryState",
            "charging", "chargingState", "bbrun", "bbmssn", "name",
        }

        # --- Named shadows: where V4 live telemetry actually lives ---
        for shadow in ("ro-currentstate", "ro-stats", "ro-services", "ro-configinfo"):
            print(f"===== named shadow: {shadow} =====")
            try:
                resp = await robot.get_named_shadow(shadow, timeout=10.0)
                hits = _find_keys(resp, interesting)
                if hits:
                    print("  KEY FIELDS FOUND:")
                    for k, v in hits.items():
                        print(f"    {k} = {json.dumps(v, default=str)[:200]}")
                else:
                    print("  (none of the target fields present)")
                print("  --- full payload ---")
                print(_dump(resp))
            except Exception as e:
                print(f"  FAILED: {type(e).__name__}: {e}")
            print()

        # --- Brief live watch: catch any real-time battery/phase deltas ---
        print("===== watch_state() for ~12s (live deltas) =====")
        count = 0
        try:
            async def _watch():
                nonlocal count
                async for delta in robot.watch_state():
                    count += 1
                    hits = _find_keys(delta, interesting)
                    print(f"  delta #{count}: "
                          + (json.dumps(hits, default=str)[:300] if hits else "(no target fields)"))
                    if count >= 5:
                        break
            await asyncio.wait_for(_watch(), timeout=12.0)
        except asyncio.TimeoutError:
            print(f"  (window closed; {count} delta(s) seen)")
        except Exception as e:
            print(f"  watch_state FAILED: {type(e).__name__}: {e}")

        # --- Mission history retry with a wide window ---
        print("\n===== get_mission_history (wide window) =====")
        try:
            hist = await robot.get_mission_history(
                robot.blid, max_reports=20, max_age=60 * 60 * 24 * 365
            )
            print(_dump(hist, limit=3000))
        except Exception as e:
            print(f"  FAILED: {type(e).__name__}: {e}")

        try:
            await robot.disconnect()
        except Exception:
            pass

    print("\nDone. Paste this whole output back.")


if __name__ == "__main__":
    try:
        sys.exit(asyncio.run(main()) or 0)
    except KeyboardInterrupt:
        sys.exit(130)
