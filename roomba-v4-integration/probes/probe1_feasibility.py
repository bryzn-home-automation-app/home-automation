r"""
Roomba 105 (V4/"Prime") feasibility probe — read-only.

Confirms whether roombapy-prime can pull the data our dashboard's Roomba tab needs
(live status + battery, and past cleaning-run history) from a 2025 x05 model.

Credentials are read from environment variables so they never live in this file or
in shell history. It prompts interactively if they're not set.

    IROBOT_EMAIL     your iRobot Home App account email
    IROBOT_PASSWORD  that account's password
    IROBOT_COUNTRY   two-letter country code (default: US)

Setup + run: see roomba-v4-integration/README.md. In short:
    python -m venv .venv && .venv\Scripts\pip install -r requirements.txt
    .venv\Scripts\python probes\probe1_feasibility.py

Nothing here sends any command to the robot — it only reads. Note: while this is
connected via the cloud it will NOT disrupt your iRobot app.
"""
import asyncio
import getpass
import json
import os
import sys

import aiohttp
from roombapy_prime.prime_factory import PrimeFactory

# Windows consoles default to cp1252, which can't encode the ✅/🟡/❌ verdict glyphs.
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


def _short(obj, limit: int = 2500) -> str:
    """Best-effort pretty JSON of a ShadowResponse/dict, capped in length."""
    payload = getattr(obj, "payload", obj)
    try:
        text = json.dumps(payload, indent=2, default=str)
    except Exception:
        text = repr(payload)
    return text if len(text) <= limit else text[:limit] + "\n  … (truncated)"


async def main() -> int:
    email = _cred("IROBOT_EMAIL", "iRobot account email: ")
    password = _cred("IROBOT_PASSWORD", "iRobot account password: ", secret=True)
    country = os.environ.get("IROBOT_COUNTRY", "US")

    results: dict[str, str] = {}

    print("\n=== Roomba 105 (V4/Prime) probe ===")
    print(f"Account: {email}   Country: {country}\n")

    async with aiohttp.ClientSession() as session:
        # --- Step 1: cloud login + robot discovery ---
        try:
            robot = await PrimeFactory.create_prime_robot(
                session=session,
                username=email,
                password=password,
                country_code=country,
            )
            print(f"[1/5] Login OK. Robot BLID: {getattr(robot, 'blid', '?')}")
            results["login"] = "OK"
        except Exception as e:
            print(f"[1/5] Login FAILED: {type(e).__name__}: {e}")
            print("\nVERDICT: cloud login failed — check email/password/country, "
                  "or the account may use a login method this beta doesn't support.")
            return 2

        # --- Step 2: identify the robot (confirms it sees the 105) ---
        try:
            serial = await robot.get_serial_number_data()
            print(f"[2/5] Robot identity: {serial}")
            results["identity"] = "OK"
        except Exception as e:
            print(f"[2/5] Identity read failed ({type(e).__name__}: {e}) — non-fatal")
            results["identity"] = f"skip ({type(e).__name__})"

        # --- Step 3: connect (MQTT-over-cloud session) ---
        try:
            await robot.connect(timeout=15.0)
            print("[3/5] Connect OK (cloud MQTT session established).")
            results["connect"] = "OK"
        except Exception as e:
            print(f"[3/5] Connect FAILED: {type(e).__name__}: {e}")
            print("\nVERDICT: authenticated but couldn't open the state channel — "
                  "the 105 may not be supported yet by this beta.")
            return 3

        # --- Step 4: live state (battery / phase) — the tab's status card ---
        try:
            state = await robot.get_state(timeout=12.0)
            print("[4/5] get_state() OK — live status payload:")
            print(_short(state))
            results["state"] = "OK"
        except Exception as e:
            print(f"[4/5] get_state() FAILED: {type(e).__name__}: {e}")
            results["state"] = f"FAIL ({type(e).__name__})"

        # --- Step 5: mission history — the tab's run table ---
        try:
            history = await robot.get_mission_history(robot.blid, max_reports=5)
            n = None
            if isinstance(history, dict):
                for k in ("history", "reports", "missions", "items", "data"):
                    if isinstance(history.get(k), list):
                        n = len(history[k])
                        break
            print(f"[5/5] get_mission_history() OK — "
                  f"{'~%d runs' % n if n is not None else 'returned data'}:")
            print(_short(history))
            results["history"] = "OK"
        except Exception as e:
            print(f"[5/5] get_mission_history() FAILED: {type(e).__name__}: {e}")
            results["history"] = f"FAIL ({type(e).__name__})"

        try:
            await robot.disconnect()
        except Exception:
            pass

    # --- Verdict ---
    print("\n=== VERDICT ===")
    for step in ("login", "identity", "connect", "state", "history"):
        print(f"  {step:9} {results.get(step, '—')}")

    can_build = results.get("state") == "OK" and results.get("history") == "OK"
    if can_build:
        print("\n✅ FEASIBLE: your 105 returns both live status and run history. "
              "We can build the real Roomba tab against roombapy-prime.")
        return 0
    if results.get("state") == "OK" or results.get("history") == "OK":
        print("\n🟡 PARTIAL: some data came back but not all. Worth a closer look "
              "before committing to a full integration.")
        return 1
    print("\n❌ NOT YET: connected but no usable telemetry — park it, revisit when "
          "the beta matures.")
    return 1


if __name__ == "__main__":
    try:
        sys.exit(asyncio.run(main()))
    except KeyboardInterrupt:
        sys.exit(130)
