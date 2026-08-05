#!/usr/bin/env node
/**
 * CoServ SmartHub → PostgreSQL Energy Usage Sync
 *
 * Sync modes (automatic):
 *   Daily (Mon-Sat):  sync just yesterday — fast append
 *   Weekly (Sunday):  sync full range from DATA_START_DATE — catches gaps
 *   Zero-guard:       if last 3 Electric days are all 0.00 kWh,
 *                     escalate to weekly sync. If still zeros → warn.
 *
 * Usage:
 *   node scripts/sync.js                    # auto (daily or weekly based on day)
 *   node scripts/sync.js --weekly           # force full-range sync
 *   node scripts/sync.js --date 08/03/2026  # sync a specific single date
 *   node scripts/sync.js --dry-run          # preview only, no DB writes
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
const COSERV = {
  loginUrl: 'https://coserv.smarthub.coop/ui/#/login',
  greenButtonPath: '#/usageManagement/greenButton',
};

const SERVICES = [
  { value: 'ELECTRIC', name: 'Electric', meterType: 'ELECTRIC' },
  { value: 'GAS', name: 'Natural Gas', meterType: 'GAS' },
];

const PROCESSING_VERSION = '1.0';
const SOURCE_LABEL = 'CoServ Green Button';
const ZERO_GUARD_DAYS = 3; // consecutive zero days triggers weekly sync

function getUsageTable(meterType) {
  return meterType === 'GAS' ? 'gas_usage' : 'electric_usage';
}

// ─── Helpers ───────────────────────────────────────────────────
const fmtDate = (d) => `${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}/${d.getFullYear()}`;
const parseDate = (str) => { const [m,d,y] = str.split('/').map(Number); return new Date(y, m-1, d); };

// ─── Secrets (.env or env vars) ────────────────────────────────
function loadSecrets() {
  const secrets = {};
  const envPath = path.join(__dirname, '..', '.env');
  if (fs.existsSync(envPath)) {
    fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
      const m = line.match(/^(COSERV_(?:USERNAME|PASSWORD|PORTAL_URL)|POSTGRES_(?:DB|USER|PASSWORD|HOST|PORT)|DATA_START_DATE)\s*=\s*(.+)/);
      if (m) secrets[m[1]] = m[2].trim();
    });
  }
  for (const k of ['COSERV_USERNAME','COSERV_PASSWORD','COSERV_PORTAL_URL',
                   'POSTGRES_DB','POSTGRES_USER','POSTGRES_PASSWORD',
                   'POSTGRES_HOST','POSTGRES_PORT','DATA_START_DATE']) {
    if (process.env[k]) secrets[k] = process.env[k];
  }
  return secrets;
}

// ─── Parse args ─────────────────────────────────────────────────
function parseArgs(argv) {
  const args = { dryRun: false, date: null, weekly: false };
  const a = argv || process.argv;
  for (let i = 2; i < a.length; i++) {
    if (a[i] === '--dry-run') args.dryRun = true;
    if (a[i] === '--weekly') args.weekly = true;
    if (a[i] === '--date' && a[i + 1]) {
      args.date = a[i + 1];
    }
  }
  return args;
}

// ─── Sync decision logic ────────────────────────────────────────

/** Is today Sunday? (0 = Sun, 1-6 = Mon-Sat). Accepts optional Date override for testing. */
function isSunday(now) { return (now || new Date()).getDay() === 0; }

/**
 * Decide what to sync and in what mode.
 * Returns { startDate, endDate, mode } where mode is 'daily' | 'weekly' | 'zero-guard'.
 * Accepts optional `now` Date for testing.
 */
async function decideSyncMode(client, args, secrets, now) {
  const yesterday = now ? new Date(now) : new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = fmtDate(yesterday);

  // Explicit --date: single day range
  if (args.date) {
    return { startDate: args.date, endDate: args.date, mode: 'single' };
  }

  // Explicit --weekly or Sunday: last 7 days
  if (args.weekly || isSunday(now)) {
    const start = new Date(yesterday);
    start.setDate(start.getDate() - 6); // last 7 days
    return { startDate: fmtDate(start), endDate: yesterdayStr, mode: args.weekly ? 'weekly (forced)' : 'weekly (Sunday)' };
  }

  // Daily mode: check for zero gap
  if (client) {
    const zeroGap = await checkZeroGap(client);
    if (zeroGap) {
      console.log(`⚠  Last ${ZERO_GUARD_DAYS} Electric days all 0 kWh — retrying last 3 days`);
      const start = new Date(yesterday);
      start.setDate(start.getDate() - (ZERO_GUARD_DAYS - 1)); // just the last N days
      return { startDate: fmtDate(start), endDate: yesterdayStr, mode: 'zero-guard' };
    }
  }

  // Default: daily — just yesterday
  return { startDate: yesterdayStr, endDate: yesterdayStr, mode: 'daily' };
}

/**
 * Check if the last N Electric days in the DB are all 0.00 kWh.
 * Returns true if a zero gap is detected (trigger weekly sync).
 */
async function checkZeroGap(client) {
  try {
    const { rows } = await client.query(
      `SELECT usage_kwh, timestamp::date as d
       FROM electric_usage
       WHERE source_provider = 'coserv'
         AND timestamp::date < CURRENT_DATE
       ORDER BY timestamp::date DESC
       LIMIT $1`, [ZERO_GUARD_DAYS]
    );
    if (rows.length < ZERO_GUARD_DAYS) return false; // not enough data yet
    const allZero = rows.every(r => parseFloat(r.usage_kwh) === 0);
    if (allZero) {
      rows.forEach(r => {
        const d = r.d instanceof Date ? r.d.toISOString().substring(0,10) : String(r.d || '?');
        console.log(`   DB: ${d} = ${r.usage_kwh} kWh`);
      });
    }
    return allZero;
  } catch (e) {
    console.error('   Zero-gap check failed:', e.message);
    return false;
  }
}

/**
 * After a weekly/zero-guard sync, check if Electric still has 3+ zeros.
 * If so, CoServ may have an outage / portal issue — notify user.
 */
async function checkPostSyncZeros(client) {
  try {
    const { rows } = await client.query(
      `SELECT usage_kwh, timestamp::date as d
       FROM electric_usage
       WHERE source_provider = 'coserv'
         AND timestamp::date < CURRENT_DATE
       ORDER BY timestamp::date DESC
       LIMIT $1`, [ZERO_GUARD_DAYS]
    );
    if (rows.length >= ZERO_GUARD_DAYS && rows.every(r => parseFloat(r.usage_kwh) === 0)) {
      console.log('');
      console.log('┌─────────────────────────────────────────┐');
      console.log('│  ⚠  WARNING: Zero usage detected        │');
      console.log('│                                         │');
      console.log(`│  Last ${ZERO_GUARD_DAYS} Electric days are all 0.00 kWh. │`);
      console.log('│  CoServ portal may have changed or      │');
      console.log('│  there may be a data issue.             │');
      console.log('│                                         │');
      console.log('│  Run: npm run test:live                 │');
      console.log('│  to verify SmartHub selectors still work │');
      console.log('└─────────────────────────────────────────┘');
      console.log('');
    }
  } catch (e) { /* ignore */ }
}

// ─── DB helpers ─────────────────────────────────────────────────
async function getOrCreateMeter(client, accountNumber, serviceName) {
  let provider = (await client.query(
    `SELECT id FROM utility_providers WHERE name = 'CoServ'`
  )).rows[0];
  if (!provider) {
    provider = (await client.query(
      `INSERT INTO utility_providers (name, type) VALUES ('CoServ', 'ELECTRIC') RETURNING id`
    )).rows[0];
  }

  const fullAcct = `${accountNumber}-${serviceName.toUpperCase()}`;
  let account = (await client.query(
    `SELECT id FROM utility_accounts WHERE account_number = $1`, [fullAcct]
  )).rows[0];
  if (!account) {
    account = (await client.query(
      `INSERT INTO utility_accounts (provider_id, account_number, status) VALUES ($1, $2, 'ACTIVE') RETURNING id`,
      [provider.id, fullAcct]
    )).rows[0];
  }

  const meterNum = `${fullAcct}-${serviceName.toUpperCase()}`;
  let meter = (await client.query(
    `SELECT id FROM meters WHERE meter_number = $1`, [meterNum]
  )).rows[0];
  if (!meter) {
    meter = (await client.query(
      `INSERT INTO meters (account_id, meter_number, type) VALUES ($1, $2, $3) RETURNING id`,
      [account.id, meterNum, serviceName === 'Natural Gas' ? 'GAS' : 'ELECTRIC']
    )).rows[0];
  }

  return meter.id;
}

// ─── Green Button XML parser ────────────────────────────────────
function parseGreenButtonXml(xmlText) {
  const results = [];

  let tzOffset = -21600;
  const ltpMatch = xmlText.match(/<LocalTimeParameters[^>]*>[\s\S]*?<\/LocalTimeParameters>/);
  if (ltpMatch) {
    const tzMatch = ltpMatch[0].match(/<tzOffset>(-?\d+)<\/tzOffset>/);
    if (tzMatch) tzOffset = parseInt(tzMatch[1]);
  }

  const blockRegex = /<IntervalBlock[^>]*>([\s\S]*?)<\/IntervalBlock>/g;
  let blockMatch;
  while ((blockMatch = blockRegex.exec(xmlText)) !== null) {
    const block = blockMatch[1];

    const uomMatch = block.match(/<uom>(\d+)<\/uom>/);
    if (uomMatch && parseInt(uomMatch[1]) === 38) continue; // skip demand (kW)

    const readingRegex = /<IntervalReading>([\s\S]*?)<\/IntervalReading>/g;
    let readingMatch;
    while ((readingMatch = readingRegex.exec(block)) !== null) {
      const reading = readingMatch[1];
      const startMatch = reading.match(/<start>(\d+)<\/start>/);
      const valueMatch = reading.match(/<value>(\d+)<\/value>/);
      const multMatch = reading.match(/<powerOfTenMultiplier>(-?\d+)<\/powerOfTenMultiplier>/);
      if (!startMatch || !valueMatch) continue;

      const epoch = parseInt(startMatch[1]);
      const rawValue = parseInt(valueMatch[1]);
      const multiplier = multMatch ? parseInt(multMatch[1]) : 0;
      const usageKwh = rawValue / Math.pow(10, multiplier);

      const date = new Date(epoch * 1000);
      const timestamp = date.toISOString().replace('T', ' ').substring(0, 19);

      results.push({
        timestamp,
        usageKwh: Math.round(usageKwh * 1000) / 1000,
        cost: 0,
        source: SOURCE_LABEL,
        sourceProvider: 'coserv',
        processingVersion: PROCESSING_VERSION,
      });
    }
  }

  return results;
}

// ─── SmartHub interaction ──────────────────────────────────────
async function fillDateInput(page, inputId, dateStr) {
  await page.evaluate(({ inputId, dateStr }) => {
    const el = document.querySelector(`#${inputId}`);
    if (!el) return;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, dateStr);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  }, { inputId, dateStr });
  await page.waitForTimeout(200);
}

async function downloadGreenButton(page, serviceValue, startDate, endDate) {
  await page.waitForTimeout(2000);

  let btnFound = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    const btn = await page.evaluate(() => {
      for (const b of document.querySelectorAll('button')) {
        if (b.textContent?.includes('Green Button')) return true;
      }
      return false;
    });
    if (btn) { btnFound = true; break; }
    await page.waitForTimeout(3000);
  }
  if (!btnFound) {
    const pageText = await page.evaluate(() => document.body.innerText.substring(0, 1500));
    console.error('   Page text:', pageText);
    throw new Error('Green Button button not found on page');
  }

  await page.evaluate(() => {
    for (const btn of document.querySelectorAll('button')) {
      if (btn.textContent?.includes('Green Button')) { btn.click(); return; }
    }
  });
  await page.waitForTimeout(4000);

  await page.selectOption('#mat-input-2', serviceValue);
  await page.waitForTimeout(200);
  await page.selectOption('#mat-input-3', 'DAILY');
  await page.waitForTimeout(200);
  await page.selectOption('#mat-input-6', 'GREEN_BUTTON');
  await page.waitForTimeout(200);
  await fillDateInput(page, 'mat-input-4', startDate);
  await fillDateInput(page, 'mat-input-5', endDate);
  await page.waitForTimeout(300);

  const downloadPromise = page.waitForEvent('download', { timeout: 30000 }).catch(() => null);

  await page.evaluate(() => {
    const dialog = document.querySelector('.mat-dialog-container');
    for (const btn of dialog?.querySelectorAll('button') || []) {
      if (btn.textContent?.trim() === 'Download') { btn.click(); return; }
    }
  });

  const download = await downloadPromise;
  if (!download) {
    const bodyText = await page.evaluate(() => document.body.innerText || '');
    if (bodyText.includes('No usage data')) return { noData: true };
    return null;
  }

  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return { data: Buffer.concat(chunks), filename: download.suggestedFilename() };
}

// ─── Main ──────────────────────────────────────────────────────
async function main() {
  const secrets = loadSecrets();
  const args = parseArgs();

  // Validate secrets before DB connect
  if (!secrets.COSERV_USERNAME || !secrets.COSERV_PASSWORD) {
    console.error('❌  Missing COSERV_USERNAME or COSERV_PASSWORD in .env');
    process.exit(1);
  }

  // Connect to DB (unless dry-run) — needed for sync decision
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

  // Decide sync mode
  const { startDate, endDate, mode } = await decideSyncMode(client, args, secrets);
  const batchId = crypto.randomUUID();

  console.log('⚡  CoServ Sync');
  console.log(`   Mode: ${mode}  |  Range: ${startDate} → ${endDate}`);
  console.log(`   Batch: ${batchId}`);
  if (args.dryRun) console.log('   Mode: DRY RUN (no DB writes)');
  if (!client) console.log('   DB: skipped (dry-run)');
  console.log('');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ locale: 'en-US', acceptDownloads: true });
  const page = await context.newPage();

  let totalRecords = 0;
  let hadError = false;

  try {
    // ── Login ──
    console.log('── Login ──');
    await page.goto(COSERV.loginUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    await page.locator('input[aria-label="Email"]').fill(secrets.COSERV_USERNAME);
    await page.locator('input[aria-label="Password"]').fill(secrets.COSERV_PASSWORD);
    await page.waitForTimeout(200);
    await page.locator('button:has-text("Sign In")').click();
    await page.waitForTimeout(6000);

    if (page.url().includes('/login') || page.url().includes('#/login')) {
      const hasError = await page.locator('text=Invalid Login').count() > 0;
      console.error(hasError ? '❌  Login failed: Invalid credentials' : '❌  Login failed: still on login page');
      process.exit(1);
    }
    console.log('✓  Logged into SmartHub');

    // Navigate to Green Button page — use hash change to keep session
    await page.evaluate(() => { window.location.hash = '#/usageManagement/greenButton'; });
    await page.waitForTimeout(8000);
    console.log('✓  On Green Button page\n');

    // ── Download per service ──
    for (const svc of SERVICES) {
      console.log(`── ${svc.name} ──`);

      const result = await downloadGreenButton(page, svc.value, startDate, endDate);

      if (!result) {
        console.log(`   ✗  Download failed\n`);
        hadError = true;
        continue;
      }

      if (result.noData) {
        console.log(`   ○  No usage data in range — storing 0 kWh for each day`);
        if (client) {
          const meterId = await getOrCreateMeter(client, '9002001851', svc.name);
          const usageTable = getUsageTable(svc.meterType);
          const [sm, sd, sy] = startDate.split('/').map(Number);
          const [em, ed, ey] = endDate.split('/').map(Number);
          const cursor = new Date(sy, sm - 1, sd);
          const end = new Date(ey, em - 1, ed);
          while (cursor <= end) {
            const ds = `${cursor.getFullYear()}-${String(cursor.getMonth()+1).padStart(2,'0')}-${String(cursor.getDate()).padStart(2,'0')} 00:00:00`;
            await client.query(
              `INSERT INTO ${usageTable} (meter_id, timestamp, usage_kwh, cost, source, source_provider, ingestion_batch_id, processing_version)
               VALUES ($1, $2, 0, 0, $3, $4, $5, $6)
               ON CONFLICT DO NOTHING`,
              [meterId, ds, SOURCE_LABEL, 'coserv', batchId, PROCESSING_VERSION]
            );
            cursor.setDate(cursor.getDate() + 1);
            totalRecords++;
          }
        }
        console.log('');
        continue;
      }

      console.log(`   ✓  Downloaded: ${result.filename} (${result.data.length} bytes)`);

      const AdmZip = require('adm-zip');
      const zip = new AdmZip(result.data);
      const xmlEntries = zip.getEntries().filter(e => e.entryName.endsWith('.xml'));

      let svcRecords = 0;
      for (const entry of xmlEntries) {
        const xmlText = entry.getData().toString('utf8');
        const records = parseGreenButtonXml(xmlText);
        console.log(`   Parsed ${records.length} readings from ${entry.entryName}`);

        if (records.length > 0 && client) {
          const meterId = await getOrCreateMeter(client, '9002001851', svc.name);
          const usageTable = getUsageTable(svc.meterType);
          for (const rec of records) {
            await client.query(
              `INSERT INTO ${usageTable} (meter_id, timestamp, usage_kwh, cost, source, source_provider, ingestion_batch_id, processing_version)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
               ON CONFLICT DO NOTHING`,
              [meterId, rec.timestamp, rec.usageKwh, rec.cost || 0,
               rec.source, rec.sourceProvider, batchId, rec.processingVersion]
            );
          }
        } else if (records.length > 0 && args.dryRun) {
          for (const rec of records) {
            console.log(`      [dry-run] ${rec.timestamp} | ${rec.usageKwh} kWh`);
          }
        }
        svcRecords += records.length;
      }

      console.log(`   ${svc.name}: ${svcRecords} records ${args.dryRun ? '(dry-run)' : 'written'}\n`);
      totalRecords += svcRecords;
    }

    // Post-sync: if zero-guard still has zeros → warn the user
    if (client && mode === 'zero-guard') {
      await checkPostSyncZeros(client);
    }

  } catch (e) {
    console.error('\n❌  Fatal error:', e.message);
    hadError = true;
  } finally {
    await browser.close();
    if (client) await client.end();
  }

  // ── Summary ──
  console.log(`╔═══════════════════════════════════╗`);
  console.log(`║  Mode: ${mode.padEnd(26)}║`);
  console.log(`║  Total: ${String(totalRecords).padStart(3)} records${' '.repeat(12)}║`);
  console.log(`║  Status: ${(hadError ? '⚠ Errors' : '✅ Success').padEnd(25)}║`);
  console.log(`╚═══════════════════════════════════╝\n`);

  process.exit(hadError ? 1 : 0);
}

// Run main() only when invoked directly (not when required as module for tests)
if (require.main === module) {
  main();
}

// Export testable functions
module.exports = {
  parseArgs,
  decideSyncMode,
  checkZeroGap,
  checkPostSyncZeros,
  parseGreenButtonXml,
  fmtDate,
  parseDate,
  isSunday,
  SERVICES,
  ZERO_GUARD_DAYS,
};
