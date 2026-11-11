# Upstream: roombapy-prime

| | |
|---|---|
| Library | `roombapy-prime` — https://github.com/johnnyh1975/roombapy-prime (also on PyPI since 0.3.4) |
| Used by | `poller.py` (this dir); `roomba-v4-integration/probes/` pin the same tag |
| Related | https://github.com/johnnyh1975/ha_roomba_plus (the Home Assistant integration built on it; not used here). Its v4.5.3 pins `roombapy-prime[map]==0.8.3` |
| Pinned | tag **v0.8.3**, commit `ac1fd10bb24d2ef1905f22a218af8ecab3fc0782`, released 2026-11-08 |
| Previous | tag v0.3.1, commit `6c6b1c89a3d2c0ccd992dcbe30315b49a9c043a4`, released 2026-08-29 |
| Bumped | 2026-11-11 (working tree) |
| How it's installed | `pip install` from the git tag in `requirements.txt` at image build time. Nothing is vendored or copied into this repo |
| Python | `>=3.11`; the image uses `python:3.12-slim` |
| Deps it pulls | `aiohttp>=3.9`, `aiomqtt>=2.5,<3` (new in 0.5.0), `paho-mqtt>=2,<3`, `certifi` |

## Local patches

None. We don't vendor the library or patch it. Everything we need is done
in `poller.py` through the public API. A bump is just a tag change plus the
checks below.

## How to bump

1. List the stable releases: `gh api repos/johnnyh1975/roombapy-prime/releases --jq '.[] | select(.prerelease|not) | .tag_name + "  " + .published_at'`
   Skip any tag marked `prerelease` (bN/rcN).
2. Read `CHANGELOG.md` and the `release-notes/` folder upstream, from our tag to the new one. Look for **Breaking** sections.
3. Change the tag in `roomba-poller/requirements.txt` and `roomba-v4-integration/requirements.txt`, then update the table above.
4. Before you deploy, check every library call in `poller.py`: imports from `roombapy_prime.auth`,
   `.prime_factory`, `.vendor_errors`, `.models.{livemap,map_bundle,robot_info,mission_control,map_editing,enums_common}`.
   Also check the `PrimeRobot` methods it calls: `connect`, `disconnect`, `get_named_shadow`, `get_serial_number_data`,
   `get_robot_parts`, `get_active_map_versions`, `get_map_geojson_link`, `download_map_bundle`,
   `edit_map_checked`, `get_mission_history`, `get_household_id`, `get_schedules`,
   `send_simple_command`, `send_routine_command_via_cmd_topic` and `watch_live_map`.
   Check the factory too: `PrimeFactory.create_prime_robot(..., login_result=, auto_refresh=True)`.
   `CloudLink.facts()` also reads three internals of `robot._mqtt` (PrimeMqttClient) to decide
   whether a command can go out without a test read: `.connected`, `.generation` and
   `.seconds_until_token_refresh_due()`. If a bump renames them, nothing breaks: the poller just
   does one shadow read before every command. Re-run `python -m unittest discover -s tests` too.

## 0.3.1 -> 0.8.3: what mattered to us

- **0.5.0, transport:** MQTT now runs on `aiomqtt` on the event loop. Before,
  it was paho on its own thread. The wire format is unchanged, and so is the
  `PrimeRobot` API. Reconnects of `watch_live_map()` are much more reliable now.
  `disconnect()` closes for good: watchers wait, and nothing reconnects until
  `connect()`. The poller already cancels the live task before it disconnects
  and builds a new robot to reconnect, so this needs no change.
- **0.6.0, breaking:** `reset_robot_parts()` now needs part ids. The poller
  never calls it, so this doesn't affect us.
- **0.6.0, error texts:** they come from iRobot app 3.2.0, so some
  `vendor_error()` titles changed. Example: 1010/18 is now "@val could not
  reach its dock", 234 is "Mop not in place", 4003/4004 is "Dock software is
  updating". This only changes the text in `roomba_runs.error_text` for runs
  written from now on.
- **0.4.0:** REST calls time out after 30 s by default, and all errors are
  `CloudError` subclasses. The poller catches broad `Exception`, so nothing
  changes.
- **0.8.3:** the MQTT topic prefix now follows each robot's own deployment
  (`svcDeplId`). Before, it followed the account's deployment. Commands to a
  robot on another deployment were acknowledged and then ignored. On our
  robot it should be a no-op unless iRobot moves it to another deployment.
- **0.8.2:** robot ids in warnings are masked to their last 4 characters.
