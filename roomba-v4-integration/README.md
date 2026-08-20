# Roomba V4 ("Prime") integration — field testing

Working folder for integrating a **2025 x05-series Roomba** (V4 / "Prime" cloud
protocol) into this home-automation dashboard's Roomba tab, and for producing clean
field-test reports we can share upstream with the
[`roombapy-prime`](https://github.com/johnnyh1975/roombapy-prime) maintainer to help
add support for this model line.

## Why this exists

The classic local-MQTT tooling (`dorita980`, `rest980`, Home Assistant's core `roomba`
integration) **does not work on the 2025 x05 models** — the robot refuses the local
MQTT connection. The only viable path today is `roombapy-prime`, a beta async Python
library that speaks iRobot's **cloud** protocol (Gigya login + AWS IoT shadows).

Our robot is a **Roomba Combo, series G2, SKU `G284020`** (marketed as the Roomba 105
Combo). `roombapy-prime` lists a sibling **Roomba Plus 505 Combo** as tested, but not
this exact SKU — so our probes double as a field test for the maintainer.

## Status

- ✅ **Feasible.** Cloud login, MQTT-over-cloud connect, shadow reads, and the mission-
  history call all succeed against our G284020. See `FINDINGS.md`.
- 🔎 Pinning down exactly which shadow/field carries live battery + mission status
  (probe #2) so we can map it to the `roomba_runs` table.

See `FINDINGS.md` for the running log of what works and the exact field shapes.

## Setup

Requires **Python 3.11+** (tested on 3.14). From this folder:

```powershell
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
```

Provide iRobot **Home App** account credentials via environment variables (preferred)
or let the scripts prompt interactively (password input is hidden):

```powershell
copy .env.example .env   # then edit — NEVER commit .env
```

The probes read `IROBOT_EMAIL`, `IROBOT_PASSWORD`, `IROBOT_COUNTRY` (default `US`).

## Probes (all read-only — they never command the robot)

| Script | What it does |
|---|---|
| `probes/probe1_feasibility.py` | Login → identify robot → connect → `get_state()` + `get_mission_history()`. Prints a FEASIBLE / PARTIAL / NOT-YET verdict. |
| `probes/probe2_shadows.py` | Dumps the four named shadows (`ro-currentstate`, `ro-stats`, `ro-services`, `ro-configinfo`), watches live state ~12s, retries mission history with a wide window. Finds where `batPct` / `cleanMissionStatus` live. |

```powershell
.venv\Scripts\python probes\probe1_feasibility.py
.venv\Scripts\python probes\probe2_shadows.py
```

Put raw outputs in `captures/` (git-ignored). **Redact BLID + serial number before
sharing any capture upstream** — the model-identifying bits the maintainer needs are
`sku` / `series` / `family`, not the per-unit serial.

## Safety / privacy

- Credentials are read from env or an interactive prompt — **never** hardcode them, and
  `.env` is git-ignored.
- The probes are strictly read-only (no `send_*` / `create_*` / `edit_*` / `delete_*`).
- Raw shadow dumps contain device identifiers (BLID, serial); `captures/` is git-ignored
  and tracked docs use redacted values.

## Upstream

Library: https://github.com/johnnyh1975/roombapy-prime (v0.3.0b7 as tested).
When we have a clean probe #2 result, open a field-tester report on that repo with the
redacted `FINDINGS.md` summary + a redacted capture.
