r"""
Roomba V4 probe #3 — fetch the actual MAP (rooms + geometry).

Probe #2 gave us only the map pointer (p2map_id). This pulls the real map:
active map versions, parsed map metadata (room names/types), and the downloaded
map bundle parsed into room features/polygons. Read-only — no edits/commands.

Credentials via env (IROBOT_EMAIL / IROBOT_PASSWORD / IROBOT_COUNTRY=US) or prompt.
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


def _to_plain(obj):
    if dataclasses.is_dataclass(obj) and not isinstance(obj, type):
        return dataclasses.asdict(obj)
    return getattr(obj, "payload", obj)


def _dump(obj, limit=4000):
    try:
        text = json.dumps(_to_plain(obj), indent=2, default=str)
    except Exception:
        text = repr(_to_plain(obj))
    return text if len(text) <= limit else text[:limit] + "\n  … (truncated)"


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

        # --- 1) map id/version from the live shadow ---
        p2map_id = None
        map_version = None
        try:
            cur = await robot.get_named_shadow("ro-currentstate", timeout=10.0)
            p2maps = _to_plain(cur).get("state", {}).get("reported", {}).get("p2maps", [])
            if p2maps:
                p2map_id = p2maps[0].get("p2map_id")
                map_version = p2maps[0].get("p2mapv_id")
            print(f"\n[shadow] p2map_id={p2map_id}  p2mapv_id={map_version}")
        except Exception as e:
            print(f"[shadow] could not read p2maps: {type(e).__name__}: {e}")

        # --- 2) list all saved map versions ---
        print("\n===== get_active_map_versions() =====")
        try:
            versions = await robot.get_active_map_versions()
            print(_dump(versions))
            # Authoritative source for both ids (the live shadow only carries p2maps
            # mid-mission). Prefer these over whatever the shadow gave us.
            if isinstance(versions, list) and versions:
                v0 = versions[0]
                p2map_id = v0.get("p2map_id") or v0.get("p2mapId") or p2map_id
                map_version = v0.get("active_p2mapv_id") or map_version
        except Exception as e:
            print(f"  FAILED: {type(e).__name__}: {e}")

        # --- 3) map metadata: room names/types ---
        print("\n===== get_map_metadata(p2map_id) — room list =====")
        if p2map_id:
            try:
                meta = await robot.get_map_metadata(p2map_id)
                plain = _to_plain(meta)
                rooms = plain.get("rooms_metadata") or plain.get("roomsMetadata") or []
                print(f"  map name: {plain.get('name')!r}   rooms: {len(rooms)}")
                for r in rooms:
                    if isinstance(r, dict):
                        print(f"    - {r.get('name')!r}  type={r.get('room_type') or r.get('type')}")
                print("  --- full metadata ---")
                print(_dump(meta))
            except Exception as e:
                print(f"  FAILED: {type(e).__name__}: {e}")
        else:
            print("  (no p2map_id available)")

        # --- 4) download + parse the map bundle (room polygons) ---
        print("\n===== map geojson bundle (geometry) =====")
        if p2map_id and map_version:
            try:
                link = await robot.get_map_geojson_link(p2map_id, map_version)
                url = link.get("map_url") if isinstance(link, dict) else None
                print(f"  geojson link keys: {list(link) if isinstance(link, dict) else type(link)}")
                if url:
                    raw = await robot.download_map_bundle(url)
                    print(f"  downloaded bundle: {len(raw)} bytes")
                    try:
                        from roombapy_prime.models.map_bundle import parse_map_bundle
                        parsed = parse_map_bundle(raw)
                        # Summarize rather than dump the whole thing.
                        keys = list(parsed) if isinstance(parsed, dict) else type(parsed)
                        print(f"  parsed keys: {keys}")
                        feats = None
                        if isinstance(parsed, dict):
                            for k in ("features", "rooms", "room_features"):
                                if isinstance(parsed.get(k), list):
                                    feats = parsed[k]
                                    break
                        if feats is not None:
                            print(f"  room/feature count: {len(feats)}")
                            if feats:
                                print("  sample feature (truncated):")
                                print("  " + json.dumps(feats[0], default=str)[:800])
                        else:
                            print(_dump(parsed, limit=1500))
                    except Exception as e:
                        print(f"  parse_map_bundle failed: {type(e).__name__}: {e}")
                        print(f"  (raw bundle first 200 bytes: {raw[:200]!r})")
            except Exception as e:
                print(f"  FAILED: {type(e).__name__}: {e}")
        else:
            print("  (need both p2map_id and map_version)")

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
