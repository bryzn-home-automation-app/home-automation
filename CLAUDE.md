# Home Automation — Project Memory

## Deploy
- Deploy via the **`deploy-nuc`** alias (a bash script at `~/deploy-nuc` on the dev
  machine). It: (1) checks for uncommitted changes, (2) pushes `origin master`,
  (3) SSHs to the `nuc` host and runs `git pull origin master`, (4) triggers the
  `HomeAutomationDeploy` Windows scheduled task (`schtasks /run`) which runs the
  Docker build in the desktop session.
- **The working tree must be clean before running `deploy-nuc`** — it prompts to
  stage/commit dirty files, and a non-interactive run aborts on that prompt.
  Commit + push first, then deploy.
- Docker runs on the **NUC**, not the dev machine.

## CoServ sync
- Single entry point: `scripts/sync.js`. It drives the Usage Explorer endpoint:
  `POST https://coserv.smarthub.coop/services/secured/utility-usage/poll`
- Granularities (`--granularity daily|hourly|both`, default `both`):
  - `daily`  → `timeFrame: "DAILY"`  → 1 record/day  → `electric_usage`
  - `hourly` → `timeFrame: "HOURLY"` → 96 fifteen-min points/day, aggregated
    4×15-min → 1 hour → `hourly_electric_usage` (24 records/day)
- Legacy scripts (Green Button daily + averageUsage hourly) are in
  `scripts/legacy/`. Superseded — do not extend.

## Auth
- Log in once (headless Playwright) and capture the Bearer token plus the
  `x-nisc-smarthub-username` / `x-nisc-smarthub-customernumber` headers from any
  `/services/secured/` request. `x-nisc-smarthub-username` ≠ the login email —
  capture it, don't hardcode.
- The poll endpoint is async: the first POST returns `{"status":"PENDING"}`;
  re-POST the same payload after ~5s for `{"status":"COMPLETE","data":{...}}`.

## Timezone gotcha (easy to get wrong)
- Request `startDateTime` / `endDateTime` are **true-UTC** epoch ms. Use
  `ctDayBounds()` (America/Chicago) — exported from `scripts/sync.js`.
- Response `data.ELECTRIC[0].series[0].data[].x` is the **local wall-clock time
  naively encoded as UTC**. Recover the local timestamp by formatting `x` AS UTC
  (`new Date(x).toISOString()`). Never run `x` through an America/Chicago
  formatter and never hardcode a 5h/6h offset.

## Manual triggers
- Debug Dashboard (`/admin/debug`) "Manual Triggers": **"Daily Sync"** → POST
  `/admin/sync/daily`, **"Hourly Sync"** → POST `/admin/sync/hourly`.
- Backend schedulers call `node /scripts/sync.js --granularity daily|hourly
  --date <MM/dd/yyyy>` (scripts are mounted read-only at `/scripts`; the backend
  image installs node + playwright + pg globally).

## Tests
- `npm test` runs `test/sync.test.js` + `test/legacy/*.test.js` (pure logic, no
  network/DB).
- `npm run test:live` runs the live SmartHub smoke test.
