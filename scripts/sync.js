#!/usr/bin/env node
/**
 * CoServ SmartHub → PostgreSQL Usage Sync (Usage Explorer API)
 *
 * Supersedes the legacy Green Button daily sync and Average Usage hourly sync
 * (now in scripts/legacy/). Uses the Usage Explorer `utility-usage/poll`
 * endpoint, which is the same API the portal drives for its charts.
 *
 * Two granularities:
 *   daily  — 1 record/day (the day's total kWh)     → electric_usage
 *   hourly — 24 records/day; each hour is the sum of the four 15-min
 *            interval points returned by the API      → hourly_electric_usage
 *
 * Usage:
 *   node scripts/sync.js                              # both, yesterday
 *   node scripts/sync.js --granularity daily          # daily only
 *   node scripts/sync.js --granularity hourly         # hourly only
 *   node scripts/sync.js --date 08/01/2026            # single date, both
 *   node scripts/sync.js --start 07/24/2026 --end 08/10/2026
 *   node scripts/sync.js --dry-run                    # preview, no DB writes
 *
 * Exit: 0 = success, 1 = errors occurred
 */
'use strict';

const { chromium } = require('playwright');
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ─── Config ────────────────────────────────────────────────────
const LOGIN_URL = 'https://coserv.smarthub.coop/ui/#/login';
const USAGE_EXPLORER_HASH = '#/usageExplorer';
const POLL_URL = 'https://coserv.smarthub.coop/services/secured/utility-usage/poll';

const ACCOUNT_NUMBER = '9002001851';      // string — matches what the portal sends
const SERVICE_LOCATION = '1059153';       // string
const METER_ACCOUNT = '9002001851-ELECTRIC';
const METER_NUMBER = '9002001851-ELECTRIC-ELECTRIC';

const SOURCE_DAILY = 'CoServ Usage Explorer';
// Distinct from the daily source — the frontend identifies hourly rows by this
// label, and the energy_usage view unions both tables into one result set.
const SOURCE_HOURLY = 'CoServ Usage Explorer Hourly';
const SOURCE_PROVIDER = 'coserv';
const PROCESSING_VERSION = '2.0';

// ─── Secrets (.env or env vars) ────────────────────────────────
function loadSecrets() {
  const s = {};
  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
      const m = line.match(/^(COSERV_(?:USERNAME|PASSWORD)|POSTGRES_(?:DB|USER|PASSWORD|HOST|PORT)|KWH_RATE)\s*=\s*(.+)/);
      if (m) s[m[1]] = m[2].trim();
    });
  }
  for (const k of ['COSERV_USERNAME', 'COSERV_PASSWORD',
                   'POSTGRES_DB', 'POSTGRES_USER', 'POSTGRES_PASSWORD',
                   'POSTGRES_HOST', 'POSTGRES_PORT', 'KWH_RATE']) {
    if (process.env[k]) s[k] = process.env[k];
  }
  return s;
}

// ─── Args ───────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = { dryRun: false, date: null, startDate: null, endDate: null, granularity: 'both' };
  const a = argv || process.argv;
  for (let i = 2; i < a.length; i++) {
    if (a[i] === '--dry-run') args.dryRun = true;
    if (a[i] === '--daily') args.granularity = 'daily';
    if (a[i] === '--hourly') args.granularity = 'hourly';
    if (a[i] === '--granularity' && a[i + 1]) {
      const g = a[i + 1].toLowerCase();
      args.granularity = ['daily', 'hourly', 'both'].includes(g) ? g : 'both';
    }
    if (a[i] === '--date' && a[i + 1]) { args.date = a[i + 1]; args.startDate = a[i + 1]; args.endDate = a[i + 1]; }
    if (a[i] === '--start' && a[i + 1]) args.startDate = a[i + 1];
    if (a[i] === '--end' && a[i + 1]) args.endDate = a[i + 1];
  }
  return args;
}

const fmtDate = (d) =>
  `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;

/**
 * Resolve the date range to sync. Defaults to yesterday (CoServ posts the
 * previous day's reading ~5 AM Central). Returns { startDate, endDate }.
 */
function resolveDateRange(args, now) {
  if (args.startDate && args.endDate) {
    return { startDate: args.startDate, endDate: args.endDate };
  }
  const y = now ? new Date(now) : new Date();
  y.setDate(y.getDate() - 1);
  const yesterday = fmtDate(y);
  return { startDate: yesterday, endDate: yesterday };
}

// ─── Timezone helpers (America/Chicago) ────────────────────────

/** Offset (ms east of UTC) for a time zone at a given instant, e.g. -18000000 for CDT. */
function tzOffsetMs(instant, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' });
  const name = dtf.formatToParts(instant).find((p) => p.type === 'timeZoneName').value;
  const m = name.match(/GMT([+-])(\d{2}):?(\d{2})?/);
  if (!m) return 0;
  const sign = m[1] === '-' ? -1 : 1;
  const hours = parseInt(m[2], 10);
  const minutes = parseInt(m[3] || '0', 10);
  return sign * (hours * 60 + minutes) * 60_000;
}

/**
 * Epoch-ms start/end of a calendar day in America/Chicago (CoServ's territory).
 * These are TRUE UTC instants — exactly what the poll endpoint expects for
 * startDateTime/endDateTime. Iterates so the offset is correct across DST.
 */
function ctDayBounds(m, d, y) {
  const utcMidnight = Date.UTC(y, m - 1, d, 0, 0, 0);
  let start = utcMidnight;
  for (let i = 0; i < 3; i++) start = utcMidnight - tzOffsetMs(start, 'America/Chicago');

  const nextUtcMidnight = Date.UTC(y, m - 1, d + 1, 0, 0, 0);
  let end = nextUtcMidnight;
  for (let i = 0; i < 3; i++) end = nextUtcMidnight - tzOffsetMs(end, 'America/Chicago');

  return { startMs: start, endMs: end - 1 };
}

// ─── Record mapping (pure, unit-tested) ─────────────────────────

/**
 * Map a DAILY poll series [{x, y}, …] (1 point per day) to DB records.
 * `x` is the local wall-clock day encoded as UTC midnight (e.g. local Aug 1
 * 00:00 → 2026-08-01T00:00:00Z), so formatting it as UTC yields the correct
 * local calendar-day timestamp.
 */
function recordsFromDailyData(data, kwhRate) {
  if (!Array.isArray(data) || !data.length) return [];
  const rate = parseFloat(kwhRate) || 0.1171;
  const records = [];
  for (const pt of data) {
    if (pt == null || pt.x == null || pt.y == null) continue;
    const usageKwh = Math.round(Number(pt.y) * 1000) / 1000;
    if (!Number.isFinite(usageKwh)) continue;
    const timestamp = new Date(pt.x).toISOString().replace('T', ' ').substring(0, 19);
    records.push({
      timestamp,
      usageKwh,
      cost: Math.round(usageKwh * rate * 100) / 100,
      source: SOURCE_DAILY,
      sourceProvider: SOURCE_PROVIDER,
      processingVersion: PROCESSING_VERSION,
    });
  }
  return records;
}

/**
 * Map a HOURLY ("Interval") poll series to DB records, aggregating the four
 * 15-minute points of each hour into a single hourly total. `x` is the local
 * wall-clock time encoded as UTC, so `Math.floor(x / 3600000)` yields the
 * local hour bucket. Null points are skipped; zero points are kept.
 */
function recordsFromIntervalData(data, kwhRate) {
  if (!Array.isArray(data) || !data.length) return [];
  const rate = parseFloat(kwhRate) || 0.1171;
  const buckets = new Map(); // hourMs -> { sum, n }
  for (const pt of data) {
    if (pt == null || pt.x == null || pt.y == null) continue;
    const y = Number(pt.y);
    if (!Number.isFinite(y)) continue;
    const hourMs = Math.floor(pt.x / 3600000) * 3600000;
    const b = buckets.get(hourMs) || { sum: 0, n: 0 };
    b.sum += y;
    b.n += 1;
    buckets.set(hourMs, b);
  }
  const records = [];
  for (const hourMs of [...buckets.keys()].sort((a, b) => a - b)) {
    const b = buckets.get(hourMs);
    const usageKwh = Math.round(b.sum * 1000) / 1000;
    const timestamp = new Date(hourMs).toISOString().replace('T', ' ').substring(0, 19);
    records.push({
      timestamp,
      usageKwh,
      cost: Math.round(usageKwh * rate * 100) / 100,
      source: SOURCE_HOURLY,
      sourceProvider: SOURCE_PROVIDER,
      processingVersion: PROCESSING_VERSION,
    });
  }
  return records;
}

// ─── DB helpers ─────────────────────────────────────────────────
async function getOrCreateMeter(client) {
  let p = (await client.query(`SELECT id FROM utility_providers WHERE name = 'CoServ'`)).rows[0];
  if (!p) p = (await client.query(`INSERT INTO utility_providers (name, type) VALUES ('CoServ', 'ELECTRIC') RETURNING id`)).rows[0];

  let a = (await client.query(`SELECT id FROM utility_accounts WHERE account_number = $1`, [METER_ACCOUNT])).rows[0];
  if (!a) a = (await client.query(`INSERT INTO utility_accounts (provider_id, account_number, status) VALUES ($1, $2, 'ACTIVE') RETURNING id`, [p.id, METER_ACCOUNT])).rows[0];

  let m = (await client.query(`SELECT id FROM meters WHERE meter_number = $1`, [METER_NUMBER])).rows[0];
  if (!m) m = (await client.query(`INSERT INTO meters (account_id, meter_number, type) VALUES ($1, $2, 'ELECTRIC') RETURNING id`, [a.id, METER_NUMBER])).rows[0];
  return m.id;
}

// ─── Login + capture auth token ─────────────────────────────────
async function captureAuthToken(secrets) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ locale: 'en-US' });
  const page = await context.newPage();

  let apiHeaders = null;

  // Capture the bearer token + x-nisc-* headers from the first secured call.
  // Attach BEFORE navigation.
  page.on('request', (req) => {
    if (apiHeaders) return;
    if (!req.url().includes('/services/secured/')) return;
    const auth = req.headers()['authorization'];
    if (!auth || !auth.startsWith('Bearer ')) return;
    apiHeaders = {
      authorization: auth,
      'x-nisc-smarthub-username': req.headers()['x-nisc-smarthub-username'] || '',
      'x-nisc-smarthub-customernumber': req.headers()['x-nisc-smarthub-customernumber'] || '',
      'content-type': 'application/json',
      accept: 'application/json',
      referer: 'https://coserv.smarthub.coop/ui/',
      cassandracacheable: 'USE_CACHE',
    };
  });

  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);
  await page.locator('input[aria-label="Email"]').fill(secrets.COSERV_USERNAME);
  await page.locator('input[aria-label="Password"]').fill(secrets.COSERV_PASSWORD);
  await page.locator('button:has-text("Sign In")').click();
  await page.waitForTimeout(6000);

  if (page.url().includes('/login') || page.url().includes('#/login')) {
    await browser.close();
    throw new Error('Login failed');
  }

  // Navigate to Usage Explorer to force secured requests (accounts/settings
  // fire immediately and carry the bearer token + x-nisc headers).
  await page.evaluate((h) => { window.location.hash = h; }, USAGE_EXPLORER_HASH);
  await page.waitForTimeout(8000);

  await browser.close();

  if (!apiHeaders) {
    throw new Error('Could not capture API auth token — no secured request fired');
  }
  return apiHeaders;
}

// ─── Fetch usage for a date via the poll API ─────────────────────
async function pollUntilComplete(apiHeaders, payload) {
  let json = null;
  for (let attempt = 1; attempt <= 6; attempt++) {
    const resp = await fetch(POLL_URL, {
      method: 'POST',
      headers: apiHeaders,
      body: JSON.stringify(payload),
    });
    if (!resp.ok) {
      throw new Error(`API error ${resp.status}: ${resp.statusText}`);
    }
    json = await resp.json();
    if (json.status === 'COMPLETE') return json;
    // PENDING — CoServ is computing; poll again (portal interval is ~5s).
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error('Poll did not reach COMPLETE within 6 attempts');
}

function electricSeries(json) {
  const electric = json && json.data && json.data.ELECTRIC;
  if (!electric || !electric.length) return [];
  return (electric[0].series && electric[0].series[0] && electric[0].series[0].data) || [];
}

function buildPayload(timeFrame, secrets, startMs, endMs) {
  return {
    timeFrame, // 'DAILY' | 'HOURLY'
    userId: secrets.COSERV_USERNAME,
    screen: 'USAGE_EXPLORER',
    includeDemand: false,
    serviceLocationNumber: SERVICE_LOCATION,
    accountNumber: ACCOUNT_NUMBER,
    industries: ['GAS', 'ELECTRIC'],
    startDateTime: startMs,
    endDateTime: endMs,
    selectedIndustry: 'ELECTRIC',
  };
}

// ─── Main ──────────────────────────────────────────────────────
async function main(cfg) {
  const secrets = loadSecrets();
  const args = { ...parseArgs(), ...(cfg || {}) };

  if (!secrets.COSERV_USERNAME || !secrets.COSERV_PASSWORD) {
    console.error('❌  Missing COSERV_USERNAME or COSERV_PASSWORD in .env');
    process.exit(1);
  }

  const { startDate, endDate } = resolveDateRange(args);
  const batchId = crypto.randomUUID();
  const kwhRate = secrets.KWH_RATE || '0.1171';

  const doDaily = args.granularity === 'both' || args.granularity === 'daily';
  const doHourly = args.granularity === 'both' || args.granularity === 'hourly';

  console.log('⚡  CoServ Sync (Usage Explorer API)');
  console.log(`   Granularity: ${args.granularity}  |  Range: ${startDate} → ${endDate}`);
  console.log(`   Batch: ${batchId}`);
  if (args.dryRun) console.log('   DRY RUN (no DB writes)');
  console.log('');

  let client;
  if (!args.dryRun) {
    client = new Client({
      host: secrets.POSTGRES_HOST || 'localhost',
      port: secrets.POSTGRES_PORT || 5432,
      database: secrets.POSTGRES_DB || 'homeplatform',
      user: secrets.POSTGRES_USER || 'homeplatform',
      password: secrets.POSTGRES_PASSWORD || 'changeme',
    });
    await client.connect();
  }

  let meterId = null;
  if (!args.dryRun && client) meterId = await getOrCreateMeter(client);

  // Step 1: capture auth token
  let apiHeaders;
  try {
    apiHeaders = await captureAuthToken(secrets);
    console.log('✓  Logged into SmartHub and captured auth token\n');
  } catch (e) {
    console.error('❌  Login/auth capture failed:', e.message);
    if (client) await client.end();
    process.exit(1);
  }

  // Step 2: iterate dates
  const [sm, sd, sy] = startDate.split('/').map(Number);
  const [em, ed, ey] = endDate.split('/').map(Number);
  const cursor = new Date(sy, sm - 1, sd);
  const end = new Date(ey, em - 1, ed);

  let totalRecords = 0;
  let hadError = false;

  while (cursor <= end) {
    const dateStr = fmtDate(cursor);
    const [m, d, y] = dateStr.split('/').map(Number);
    const { startMs, endMs } = ctDayBounds(m, d, y);

    // ── Daily ──
    if (doDaily) {
      try {
        const json = await pollUntilComplete(apiHeaders, buildPayload('DAILY', secrets, startMs, endMs));
        const records = recordsFromDailyData(electricSeries(json), kwhRate);
        if (args.dryRun) {
          console.log(`── ${dateStr} (daily) — ${records.length} record(s)`);
          for (const r of records) console.log(`   ${r.timestamp} | ${r.usageKwh} kWh`);
        } else if (records.length > 0 && client) {
          let inserted = 0;
          for (const r of records) {
            // ON CONFLICT DO NOTHING is a true no-op on a duplicate — check
            // rowCount rather than assuming the query wrote a row. Otherwise
            // a re-run against an already-populated day (e.g. a manual
            // Debug Dashboard trigger, which forces a sync with no
            // idempotency skip) logs "N written" when N rows were actually
            // silently skipped as duplicates.
            const result = await client.query(
              `INSERT INTO electric_usage (meter_id, timestamp, usage_kwh, cost, source, source_provider, ingestion_batch_id, processing_version)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
               ON CONFLICT DO NOTHING`,
              [meterId, r.timestamp, r.usageKwh, r.cost, r.source, r.sourceProvider, batchId, r.processingVersion]
            );
            if (result.rowCount > 0) inserted++;
          }
          const skipped = records.length - inserted;
          const dayTotal = records.reduce((s, r) => s + r.usageKwh, 0).toFixed(2);
          const skippedNote = skipped > 0 ? ` · ${skipped} already existed` : '';
          console.log(`── ${dateStr} (daily) — ${records.length} record(s) · ${dayTotal} kWh · ${inserted} written${skippedNote}`);
        } else {
          console.log(`── ${dateStr} (daily) — 0 records (no data posted yet)`);
        }
        totalRecords += records.length;
      } catch (e) {
        console.error(`── ${dateStr} (daily) — error: ${e.message}`);
        hadError = true;
      }
    }

    // ── Hourly (4×15-min → 1 hour) ──
    if (doHourly) {
      try {
        const json = await pollUntilComplete(apiHeaders, buildPayload('HOURLY', secrets, startMs, endMs));
        const records = recordsFromIntervalData(electricSeries(json), kwhRate);
        const dayTotal = records.reduce((s, r) => s + r.usageKwh, 0);
        const nonZero = records.filter((r) => r.usageKwh > 0).length;

        if (args.dryRun) {
          console.log(`── ${dateStr} (hourly) — ${records.length} hour(s) · ${nonZero} non-zero · ${dayTotal.toFixed(2)} kWh`);
          for (const r of records.slice(0, 3)) console.log(`   ${r.timestamp} | ${r.usageKwh} kWh`);
          if (records.length > 3) console.log(`   ... and ${records.length - 3} more`);
        } else if (records.length > 0 && client) {
          if (nonZero === 0) {
            // CoServ hasn't posted this day's interval data yet. Don't write
            // 0-kWh placeholders — a later retry fills the real values.
            console.log(`── ${dateStr} (hourly) — 0 kWh total · skipping (not posted yet)`);
          } else {
            let inserted = 0;
            for (const r of records) {
              await client.query(
                `INSERT INTO hourly_electric_usage (meter_id, timestamp, usage_kwh, cost, source, source_provider, ingestion_batch_id, processing_version)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                 ON CONFLICT (meter_id, timestamp, source_provider) DO UPDATE SET
                   usage_kwh = EXCLUDED.usage_kwh, cost = EXCLUDED.cost, source = EXCLUDED.source,
                   ingestion_batch_id = EXCLUDED.ingestion_batch_id, processing_version = EXCLUDED.processing_version`,
                [meterId, r.timestamp, r.usageKwh, r.cost, r.source, r.sourceProvider, batchId, r.processingVersion]
              );
              inserted++;
            }
            console.log(`── ${dateStr} (hourly) — ${records.length} hour(s) · ${dayTotal.toFixed(2)} kWh · ${inserted} written`);
          }
        } else {
          console.log(`── ${dateStr} (hourly) — 0 records (no data)`);
        }
        totalRecords += records.length;
      } catch (e) {
        console.error(`── ${dateStr} (hourly) — error: ${e.message}`);
        hadError = true;
      }
    }

    cursor.setDate(cursor.getDate() + 1);
  }

  if (client) await client.end();

  // ── Summary ──
  console.log('');
  console.log('╔═══════════════════════════════════╗');
  console.log(`║  Range: ${startDate} → ${endDate}${' '.repeat(Math.max(0, 26 - (startDate.length + 5 + endDate.length)))}║`);
  console.log(`║  Total: ${String(totalRecords).padStart(3)} records${' '.repeat(12)}║`);
  console.log(`║  Status: ${(hadError ? '⚠ Errors' : '✅ Success').padEnd(25)}║`);
  console.log('╚═══════════════════════════════════╝\n');

  return { hadError, totalRecords };
}

if (require.main === module) {
  (async () => {
    const result = await main();
    process.exit(result.hadError ? 1 : 0);
  })();
}

module.exports = {
  parseArgs,
  resolveDateRange,
  fmtDate,
  tzOffsetMs,
  ctDayBounds,
  recordsFromDailyData,
  recordsFromIntervalData,
  buildPayload,
};
