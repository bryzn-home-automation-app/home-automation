#!/usr/bin/env node
/**
 * CoServ SmartHub — Hourly Electric Usage Sync
 *
 * ⚠ DEPRECATED — moved to scripts/legacy/. Superseded by scripts/sync.js,
 * which uses the Usage Explorer `utility-usage/poll` API (timeFrame=HOURLY,
 * 4×15-min points aggregated to 1 hour). Kept for reference; do not extend.
 *
 * Logs into SmartHub, captures the API bearer token, then calls the
 * /services/secured/averageUsage endpoint directly for each date.
 *
 * Usage:
 *   node scripts/sync-hourly.js --date 08/07/2026       # single date
 *   node scripts/sync-hourly.js --start 07/24/2026 --end 08/08/2026
 *   node scripts/sync-hourly.js --dry-run
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
const API_URL = 'https://coserv.smarthub.coop/services/secured/averageUsage';

const SOURCE_LABEL = 'CoServ Average Usage';
const SOURCE_PROVIDER = 'coserv';
const PROCESSING_VERSION = '1.1';

// ─── Secrets ────────────────────────────────────────────────────
function loadSecrets() {
  const s = {};
  const envPath = path.join(__dirname, '..', '..', '.env');
  if (fs.existsSync(envPath)) {
    fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
      const m = line.match(/^(COSERV_(?:USERNAME|PASSWORD)|POSTGRES_(?:DB|USER|PASSWORD|HOST|PORT))\s*=\s*(.+)/);
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
  const args = { dryRun: false, startDate: null, endDate: null };
  const a = argv || process.argv;
  for (let i = 2; i < a.length; i++) {
    if (a[i] === '--dry-run') args.dryRun = true;
    if (a[i] === '--date' && a[i + 1]) { args.startDate = a[i + 1]; args.endDate = a[i + 1]; }
    if (a[i] === '--start' && a[i + 1]) args.startDate = a[i + 1];
    if (a[i] === '--end' && a[i + 1]) args.endDate = a[i + 1];
  }
  return args;
}

const fmtDate = (d) =>
  `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;

const pad = (n) => String(n).padStart(2, '0');
const tsForDateAndHour = (m, d, y, h) => `${y}-${pad(m)}-${pad(d)} ${pad(h)}:00:00`;

// ─── DB ─────────────────────────────────────────────────────────
async function getOrCreateMeter(client) {
  let p = (await client.query(`SELECT id FROM utility_providers WHERE name = 'CoServ'`)).rows[0];
  if (!p) p = (await client.query(`INSERT INTO utility_providers (name, type) VALUES ('CoServ', 'ELECTRIC') RETURNING id`)).rows[0];

  const acctNum = '9002001851-ELECTRIC';
  let a = (await client.query(`SELECT id FROM utility_accounts WHERE account_number = $1`, [acctNum])).rows[0];
  if (!a) a = (await client.query(`INSERT INTO utility_accounts (provider_id, account_number, status) VALUES ($1, $2, 'ACTIVE') RETURNING id`, [p.id, acctNum])).rows[0];

  const meterNum = `${acctNum}-ELECTRIC`;
  let m = (await client.query(`SELECT id FROM meters WHERE meter_number = $1`, [meterNum])).rows[0];
  if (!m) m = (await client.query(`INSERT INTO meters (account_id, meter_number, type) VALUES ($1, $2, 'ELECTRIC') RETURNING id`, [a.id, meterNum])).rows[0];
  return m.id;
}

// ─── Login + capture auth token ─────────────────────────────────
async function captureAuthToken(secrets) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ locale: 'en-US' });
  const page = await context.newPage();

  let bearerToken = null;
  let apiHeaders = {};

  // Intercept API calls to steal auth — attach BEFORE any navigation
  page.on('request', req => {
    if (req.url().includes('/services/secured/averageUsage') && !bearerToken) {
      const auth = req.headers()['authorization'];
      if (auth && auth.startsWith('Bearer ')) {
        bearerToken = auth;
        apiHeaders = {
          'authorization': bearerToken,
          'x-nisc-smarthub-username': req.headers()['x-nisc-smarthub-username'] || '',
          'content-type': 'application/json',
          'accept': 'application/json',
          'referer': 'https://coserv.smarthub.coop/ui/',
        };
        console.log('✓  Captured API auth token');
      }
    }
  });

  // Login
  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);
  await page.locator('input[aria-label="Email"]').fill(secrets.COSERV_USERNAME);
  await page.locator('input[aria-label="Password"]').fill(secrets.COSERV_PASSWORD);
  await page.locator('button:has-text("Sign In")').click();
  await page.waitForTimeout(6000);

  if (page.url().includes('/login') || page.url().includes('#/login')) {
    throw new Error('Login failed');
  }
  console.log('✓  Logged into SmartHub');

  // Navigate to average usage + switch to TIME_OF_DAY to trigger the hourly API call
  // Try up to 3 times to get the API call to fire
  for (let attempt = 0; attempt < 3 && !bearerToken; attempt++) {
    await page.evaluate(() => { window.location.hash = '#/home'; });
    await page.waitForTimeout(2000);
    await page.evaluate(() => { window.location.hash = '#/averageUsage'; });
    await page.waitForTimeout(6000);

    try {
      await page.locator('#mat-input-2').selectOption('TIME_OF_DAY', { timeout: 10000 });
      await page.waitForTimeout(5000);
    } catch {}

    if (!bearerToken) {
      // The MONTHLY API call happens during page load, before we even switch to TIME_OF_DAY
      // If the token wasn't captured, the API call may have been cached client-side.
      // Try a page reload to force a fresh API call.
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(6000);
    }
  }

  await browser.close();

  if (!bearerToken) {
    throw new Error('Could not capture API auth token — API call did not fire');
  }

  return { bearerToken, apiHeaders };
}

// ─── Timezone helpers ───────────────────────────────────────────

/** Offset (ms east of UTC) for a time zone at a given instant, e.g. -18000000 for CDT. */
function tzOffsetMs(instant, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'longOffset',
  });
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
 * Iterates a couple of times so the offset is correct across DST transitions.
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

/**
 * Convert the averageUsage response payload [{y, name: "12am"}, …] into DB
 * records. Pure — no I/O — so it can be unit-tested. Skips null values and
 * unparsable hour labels; zero values are kept (a real hour can be 0 kWh).
 */
function recordsFromUsageData(data, m, d, y, kwhRate) {
  if (!Array.isArray(data) || !data.length) return [];
  const records = [];
  for (const pt of data) {
    const label = (pt && pt.name ? pt.name : '').trim();
    let hour = -1;
    const apMatch = label.match(/^(\d{1,2})(am|pm)/i);
    if (apMatch) {
      let h = parseInt(apMatch[1], 10);
      if (h === 12) h = 0;
      if (apMatch[2].toLowerCase() === 'pm') h += 12;
      hour = h;
    }

    if (hour < 0 || hour > 23 || pt == null || pt.y == null) continue;

    const usageKwh = Math.round(Number(pt.y) * 1000) / 1000;
    if (!Number.isFinite(usageKwh)) continue;

    records.push({
      timestamp: tsForDateAndHour(m, d, y, hour),
      usageKwh,
      cost: Math.round(usageKwh * kwhRate * 100) / 100,
      source: SOURCE_LABEL,
      sourceProvider: SOURCE_PROVIDER,
      processingVersion: PROCESSING_VERSION,
    });
  }
  return records;
}

// ─── Fetch usage for a date via API ─────────────────────────────
async function fetchUsageForDate(apiHeaders, dateStr, kwhRate = 0.1171) {
  const [m, d, y] = dateStr.split('/').map(Number);

  const { startMs, endMs } = ctDayBounds(m, d, y);

  const payload = {
    accountNumber: 9002001851,
    serviceLocationNumber: 1059153,
    industries: ['ELECTRIC'],
    startDateTime: startMs,
    endDateTime: endMs,
    reportType: 'TIME_OF_DAY',
    userId: 'bryzncode@gmail.com',
  };

  const resp = await fetch(API_URL, {
    method: 'POST',
    headers: apiHeaders,
    body: JSON.stringify(payload),
  });

  if (!resp.ok) {
    console.error(`   API error ${resp.status}: ${resp.statusText}`);
    return [];
  }

  const json = await resp.json();
  const electric = json && json.ELECTRIC;
  if (!electric || !electric.usageSeries || !electric.usageSeries.length) {
    return [];
  }

  return recordsFromUsageData(electric.usageSeries[0].data, m, d, y, kwhRate);
}

// ─── Main ──────────────────────────────────────────────────────
async function main() {
  const secrets = loadSecrets();
  const args = parseArgs();

  if (!args.startDate) {
    const y = new Date();
    y.setDate(y.getDate() - 1);
    args.startDate = fmtDate(y);
    args.endDate = args.startDate;
  }
  if (!args.endDate) args.endDate = args.startDate;

  if (!secrets.COSERV_USERNAME || !secrets.COSERV_PASSWORD) {
    console.error('❌  Missing credentials');
    process.exit(1);
  }

  // Connect DB
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

  const batchId = crypto.randomUUID();
  console.log('⚡  CoServ Hourly Sync (API)');
  console.log(`   Date: ${args.startDate} → ${args.endDate}`);
  console.log(`   Batch: ${batchId}`);
  if (args.dryRun) console.log('   DRY RUN');
  console.log('');

  // Step 1: Capture auth token
  let apiHeaders;
  try {
    const auth = await captureAuthToken(secrets);
    apiHeaders = auth.apiHeaders;
  } catch (e) {
    console.error('❌  Login/auth capture failed:', e.message);
    process.exit(1);
  }

  // Step 2: Iterate dates and fetch via API
  const [sm, sd, sy] = args.startDate.split('/').map(Number);
  const [em, ed, ey] = args.endDate.split('/').map(Number);
  const cursor = new Date(sy, sm - 1, sd);
  const end = new Date(ey, em - 1, ed);

  let totalRecords = 0;

  while (cursor <= end) {
    const dateStr = fmtDate(cursor);
    const records = await fetchUsageForDate(apiHeaders, dateStr, secrets.KWH_RATE || '0.1171');
    const dailyTotal = records.reduce((s, r) => s + r.usageKwh, 0);
    const nonZero = records.filter((r) => r.usageKwh > 0).length;
    const dayLabel = `${records.length} records · ${nonZero} non-zero · ${dailyTotal.toFixed(2)} kWh`;

    if (args.dryRun) {
      console.log(`── ${dateStr} — ${dayLabel} total`);
      for (const r of records.slice(0, 3)) {
        console.log(`   ${r.timestamp} | ${r.usageKwh} kWh`);
      }
      if (records.length > 3) console.log(`   ... and ${records.length - 3} more`);
    } else if (records.length > 0 && client) {
      if (nonZero === 0) {
        // CoServ hasn't posted this day's hourly data yet. Don't write 0-kWh
        // placeholders — the 30-min scheduler retry fills the real values later.
        console.log(`── ${dateStr} — ${dayLabel} total · skipping (not posted yet)`);
      } else {
        const meterId = await getOrCreateMeter(client);
        let inserted = 0;
        // Upsert: one row per hour (unique on meter_id + timestamp + source_provider).
        // When CoServ later posts updated/corrected values, they overwrite in place —
        // so a day never exceeds 24 rows per meter.
        for (const r of records) {
          try {
            await client.query(
              `INSERT INTO hourly_electric_usage (meter_id, timestamp, usage_kwh, cost, source, source_provider, ingestion_batch_id, processing_version)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
               ON CONFLICT (meter_id, timestamp, source_provider) DO UPDATE SET
                 usage_kwh = EXCLUDED.usage_kwh, cost = EXCLUDED.cost, source = EXCLUDED.source,
                 ingestion_batch_id = EXCLUDED.ingestion_batch_id, processing_version = EXCLUDED.processing_version`,
              [meterId, r.timestamp, r.usageKwh, r.cost,
               r.source, r.sourceProvider, batchId, r.processingVersion]
            );
            inserted++;
          } catch (e) {
            console.error(`   DB error ${r.timestamp}: ${e.message}`);
          }
        }
        console.log(`── ${dateStr} — ${dayLabel} total · ${inserted} written`);
      }
    } else if (records.length === 0) {
      console.log(`── ${dateStr} — 0 records (no data)`);
    }

    totalRecords += records.length;
    cursor.setDate(cursor.getDate() + 1);
  }

  // Summary
  const rangeLabel = args.startDate === args.endDate
    ? args.startDate
    : `${args.startDate} → ${args.endDate}`;
  console.log('');
  console.log('╔═══════════════════════════════════╗');
  console.log(`║  Date: ${rangeLabel.padEnd(26)}║`);
  console.log(`║  Total: ${String(totalRecords).padStart(3)} records${' '.repeat(12)}║`);
  console.log(`║  Status: ✅ Success ${' '.repeat(16)}║`);
  console.log('╚═══════════════════════════════════╝\n');

  if (client) await client.end();
  return { totalRecords };
}

if (require.main === module) {
  (async () => {
    await main();
    process.exit(0);
  })();
}

module.exports = { parseArgs, fmtDate, recordsFromUsageData, ctDayBounds, tzOffsetMs };
