#!/usr/bin/env node
/**
 * CoServ SmartHub → PostgreSQL Energy Usage Sync
 *
 * Standalone sync script. Reads credentials from .env, logs into SmartHub,
 * downloads Green Button data for Electric + Natural Gas, parses the XML,
 * and inserts records directly into PostgreSQL.
 *
 * Usage:
 *   node scripts/sync.js                    # sync yesterday
 *   node scripts/sync.js --date 08/03/2026  # sync a single date
 *   node scripts/sync.js --dry-run          # don't write to DB
 *
 * Every sync downloads a range: DATA_START_DATE → target date.
 * Green Button XML contains all readings in that interval.
 * Running daily (cron) just appends new data — no gaps.
 *
 * Exit: 0 = success, 1 = errors occurred
 */
'use strict';

const { chromium } = require('playwright');
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Writable } = require('stream');

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
function parseArgs() {
  const args = { dryRun: false, date: null };
  for (let i = 2; i < process.argv.length; i++) {
    if (process.argv[i] === '--dry-run') args.dryRun = true;
    if (process.argv[i] === '--date' && process.argv[i + 1]) {
      args.date = process.argv[i + 1];
    }
  }
  return args;
}

/** Return { startDate, endDate } as MM/DD/YYYY strings for the Green Button range. */
function buildDateRange(args, secrets) {
  const fmt = (d) => `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;

  const endDate = args.date ? parseDate(args.date) : (() => {
    const d = new Date(); d.setDate(d.getDate() - 1); return d;
  })();

  let startDate;
  if (secrets.DATA_START_DATE) {
    startDate = parseDate(secrets.DATA_START_DATE);
  } else {
    startDate = new Date(endDate); // default: same day
  }

  return { startDate: fmt(startDate), endDate: fmt(endDate) };
}

function parseDate(str) {
  const [m, d, y] = str.split('/').map(Number);
  return new Date(y, m - 1, d);
}

// ─── DB helpers ─────────────────────────────────────────────────
class DbWriter extends Writable {
  constructor(client, meterId, batchId, dryRun) {
    super({ objectMode: true });
    this.client = client;
    this.meterId = meterId;
    this.batchId = batchId;
    this.dryRun = dryRun;
    this.count = 0;
  }

  async _write(record, _enc, callback) {
    if (this.dryRun) {
      console.log(`  [dry-run] Would insert: ${record.timestamp} | ${record.usageKwh} kWh`);
      this.count++;
      return callback();
    }
    try {
      await this.client.query(
        `INSERT INTO energy_usage (meter_id, timestamp, usage_kwh, cost, source, source_provider, ingestion_batch_id, processing_version)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT DO NOTHING`,
        [this.meterId, record.timestamp, record.usageKwh, record.cost || 0,
         record.source, record.sourceProvider, this.batchId, record.processingVersion]
      );
      this.count++;
    } catch (e) {
      console.error(`  DB insert error for ${record.timestamp}:`, e.message);
    }
    callback();
  }
}

async function getOrCreateMeter(client, accountNumber, serviceName) {
  // Ensure provider
  let provider = (await client.query(
    `SELECT id FROM utility_providers WHERE name = 'CoServ'`
  )).rows[0];
  if (!provider) {
    provider = (await client.query(
      `INSERT INTO utility_providers (name, type) VALUES ('CoServ', 'ELECTRIC') RETURNING id`
    )).rows[0];
  }

  // Ensure account
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

  // Ensure meter
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

  // Extract timezone offset
  let tzOffset = -21600; // default CST (UTC-6)
  const ltpMatch = xmlText.match(/<LocalTimeParameters[^>]*>[\s\S]*?<\/LocalTimeParameters>/);
  if (ltpMatch) {
    const tzMatch = ltpMatch[0].match(/<tzOffset>(-?\d+)<\/tzOffset>/);
    if (tzMatch) tzOffset = parseInt(tzMatch[1]);
  }

  // Extract all IntervalBlocks
  const blockRegex = /<IntervalBlock[^>]*>([\s\S]*?)<\/IntervalBlock>/g;
  let blockMatch;
  while ((blockMatch = blockRegex.exec(xmlText)) !== null) {
    const block = blockMatch[1];

    // Get unit of measure from the interval element
    const uomMatch = block.match(/<uom>(\d+)<\/uom>/);
    const uom = uomMatch ? parseInt(uomMatch[1]) : null;
    // uom 38 = kW (demand), uom 72 = kWh (energy) — skip demand
    if (uom === 38) continue;

    // Extract each IntervalReading
    const readingRegex = /<IntervalReading>([\s\S]*?)<\/IntervalReading>/g;
    let readingMatch;
    while ((readingMatch = readingRegex.exec(block)) !== null) {
      const reading = readingMatch[1];

      const startMatch = reading.match(/<start>(\d+)<\/start>/);
      const durationMatch = reading.match(/<duration>(\d+)<\/duration>/);
      const valueMatch = reading.match(/<value>(\d+)<\/value>/);
      const multMatch = reading.match(/<powerOfTenMultiplier>(-?\d+)<\/powerOfTenMultiplier>/);

      if (!startMatch || !valueMatch) continue;

      const epoch = parseInt(startMatch[1]);
      const rawValue = parseInt(valueMatch[1]);
      const multiplier = multMatch ? parseInt(multMatch[1]) : 0;
      const usageKwh = rawValue / Math.pow(10, multiplier);

      // Green Button timestamps are UTC epoch seconds
      // tzOffset is in seconds (e.g. -21600 for CST = UTC-6)
      // We store in UTC: epoch + tzOffset gives local time, but we want UTC
      // Actually: the epoch IS UTC. Store as UTC timestamp.
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

// ─── SmartHub interaction helpers ──────────────────────────────
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
  // Wait for the page to have the download button
  await page.waitForTimeout(2000);

  // Try to find the button — debug what's on page if it fails
  let btnFound = false;
  for (let attempt = 0; attempt < 3; attempt++) {
    const btn = await page.evaluate(() => {
      for (const b of document.querySelectorAll('button')) {
        if (b.textContent?.includes('Green Button')) return true;
      }
      return false;
    });
    if (btn) { btnFound = true; break; }
    console.log(`   Retry ${attempt + 1}: button not found, waiting 3s...`);
    await page.waitForTimeout(3000);
  }
  if (!btnFound) {
    const allText = await page.evaluate(() => document.body.innerText.substring(0, 1500));
    console.error('   Page text:', allText);
    throw new Error('Green Button button not found on page');
  }

  // Click to open modal
  await page.evaluate(() => {
    for (const btn of document.querySelectorAll('button')) {
      if (btn.textContent?.includes('Green Button')) { btn.click(); return; }
    }
  });
  await page.waitForTimeout(4000);

  // Select service
  await page.selectOption('#mat-input-2', serviceValue);
  await page.waitForTimeout(200);
  // Select DAILY interval
  await page.selectOption('#mat-input-3', 'DAILY');
  await page.waitForTimeout(200);
  // Select Green Button XML format
  await page.selectOption('#mat-input-6', 'GREEN_BUTTON');
  await page.waitForTimeout(200);
  // Fill date range
  await fillDateInput(page, 'mat-input-4', startDate);
  await fillDateInput(page, 'mat-input-5', endDate);
  await page.waitForTimeout(300);

  // Set up download handler
  const downloadPromise = page.waitForEvent('download', { timeout: 30000 }).catch(() => null);

  // Click Download
  await page.evaluate(() => {
    const dialog = document.querySelector('.mat-dialog-container');
    for (const btn of dialog?.querySelectorAll('button') || []) {
      if (btn.textContent?.trim() === 'Download') { btn.click(); return; }
    }
  });

  const download = await downloadPromise;
  if (!download) {
    // Check for "No usage data" message
    const bodyText = await page.evaluate(() => document.body.innerText || '');
    if (bodyText.includes('No usage data')) return { noData: true };
    return null;
  }

  // Read the ZIP into memory
  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return { data: Buffer.concat(chunks), filename: download.suggestedFilename() };
}

// ─── Main ──────────────────────────────────────────────────────
async function main() {
  const secrets = loadSecrets();
  const args = parseArgs();
  const { startDate, endDate } = buildDateRange(args, secrets);
  const batchId = crypto.randomUUID();

  console.log('⚡  CoServ Sync');
  console.log(`   Range: ${startDate} → ${endDate}  |  Batch: ${batchId}`);
  if (args.dryRun) console.log('   Mode: DRY RUN (no DB writes)');
  console.log('');

  // Validate secrets
  if (!secrets.COSERV_USERNAME || !secrets.COSERV_PASSWORD) {
    console.error('❌  Missing COSERV_USERNAME or COSERV_PASSWORD in .env');
    process.exit(1);
  }

  // Connect to DB (unless dry-run)
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
    console.log('✓  PostgreSQL connected');
  } else {
    console.log('○  PostgreSQL skipped (dry-run)');
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ locale: 'en-US', acceptDownloads: true });
  const page = await context.newPage();

  let totalRecords = 0;
  let hadError = false;

  try {
    // ── Login ──
    console.log('\n── Login ──');
    await page.goto(COSERV.loginUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);

    await page.locator('input[aria-label="Email"]').fill(secrets.COSERV_USERNAME);
    await page.locator('input[aria-label="Password"]').fill(secrets.COSERV_PASSWORD);
    await page.waitForTimeout(200);
    await page.locator('button:has-text("Sign In")').click();
    await page.waitForTimeout(6000);

    if (page.url().includes('/login') || page.url().includes('#/login')) {
      const hasError = await page.locator('text=Invalid Login').count() > 0;
      if (hasError) {
        console.error('❌  Login failed: Invalid credentials');
      } else {
        console.error('❌  Login failed: still on login page');
      }
      process.exit(1);
    }
    console.log('✓  Logged into SmartHub');

    // Navigate to Green Button page — Angular SPA, use hash change
    await page.goto('https://coserv.smarthub.coop/ui/#/usageManagement/greenButton',
      { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(8000);
    console.log('✓  On Green Button page');

    // ── Download per service (single range covers all dates) ──
    for (const svc of SERVICES) {
      console.log(`\n── ${svc.name} ──`);

      const result = await downloadGreenButton(page, svc.value, startDate, endDate);

      if (!result) {
        console.log(`   ✗  Download failed`);
        hadError = true;
        continue;
      }

      if (result.noData) {
        console.log(`   ○  No usage data in range — storing 0 kWh for each day`);
        if (!args.dryRun) {
          const meterId = await getOrCreateMeter(client, '9002001851', svc.name);
          // Store 0 kWh for each day in the range
          const [sm, sd, sy] = startDate.split('/').map(Number);
          const [em, ed, ey] = endDate.split('/').map(Number);
          const cursor = new Date(sy, sm - 1, sd);
          const end = new Date(ey, em - 1, ed);
          while (cursor <= end) {
            const ds = `${cursor.getFullYear()}-${String(cursor.getMonth()+1).padStart(2,'0')}-${String(cursor.getDate()).padStart(2,'0')} 00:00:00`;
            await client.query(
              `INSERT INTO energy_usage (meter_id, timestamp, usage_kwh, cost, source, source_provider, ingestion_batch_id, processing_version)
               VALUES ($1, $2, 0, 0, $3, $4, $5, $6)
               ON CONFLICT DO NOTHING`,
              [meterId, ds, SOURCE_LABEL, 'coserv', batchId, PROCESSING_VERSION]
            );
            cursor.setDate(cursor.getDate() + 1);
            totalRecords++;
          }
        }
        continue;
      }

      console.log(`   ✓  Downloaded: ${result.filename} (${result.data.length} bytes)`);

      // Extract XML from ZIP
      const AdmZip = require('adm-zip');
      const zip = new AdmZip(result.data);
      const xmlEntries = zip.getEntries().filter(e => e.entryName.endsWith('.xml'));

      let svcRecords = 0;
      for (const entry of xmlEntries) {
        const xmlText = entry.getData().toString('utf8');
        const records = parseGreenButtonXml(xmlText);
        console.log(`   Parsed ${records.length} readings from ${entry.entryName}`);

        if (records.length > 0 && !args.dryRun) {
          const meterId = await getOrCreateMeter(client, '9002001851', svc.name);
          for (const rec of records) {
            await client.query(
              `INSERT INTO energy_usage (meter_id, timestamp, usage_kwh, cost, source, source_provider, ingestion_batch_id, processing_version)
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

      console.log(`   ${svc.name}: ${svcRecords} records ${args.dryRun ? '(dry-run)' : 'written'}`);
      totalRecords += svcRecords;
    }

  } catch (e) {
    console.error('\n❌  Fatal error:', e.message);
    hadError = true;
  } finally {
    await browser.close();
    if (client) await client.end();
  }

  // ── Summary ──
  console.log(`\n═══════════════════════════════════`);
  console.log(`  Total: ${totalRecords} records`);
  console.log(`  Batch: ${batchId}`);
  console.log(`  Status: ${hadError ? '⚠  Errors occurred' : '✅  Success'}`);
  console.log(`═══════════════════════════════════\n`);

  process.exit(hadError ? 1 : 0);
}

main();
