#!/usr/bin/env node
/**
 * CoServ SmartHub → PDF → PostgreSQL — combined electric+gas bill sync.
 *
 * CoServ issues one PDF statement per billing cycle covering both services.
 * This logs into SmartHub Billing History (reusing loginToSmartHub from
 * scripts/sync.js — the same login the usage syncs use), clicks each "View
 * Bill" link, captures the resulting download, parses the PDF text
 * (scripts/coserv-bill-parser.js), saves the PDF under uploads/bills/ so the
 * webapp can serve it back, and upserts into `coserv_bills` keyed on
 * (account, billing period) — so re-running against already-processed bills
 * is a cheap no-op.
 *
 * Usage:
 *   node scripts/sync-coserv-bill.js                # sync all bills on the Billing History page
 *   node scripts/sync-coserv-bill.js --dry-run       # preview, no DB writes or PDF saves
 *
 * Exit: 0 = success, 1 = errors occurred
 */
'use strict';

const { chromium } = require('playwright');
const { Client } = require('pg');
const pdf = require('pdf-parse');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { loadSecrets, loginToSmartHub, ACCOUNT_NUMBER } = require('./sync');
const { parseCoservBillText } = require('./coserv-bill-parser');

const BILLING_HISTORY_HASH = '#/billingHistory';
const SOURCE = 'CoServ SmartHub PDF';
const SOURCE_PROVIDER = 'coserv-smarthub-bill';
const PROCESSING_VERSION = '1.0';
const PROVIDER_NAME = 'CoServ';
const UPLOADS_BILLS_DIR = path.join(__dirname, '..', 'uploads', 'bills');

// ─── Args ───────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = { dryRun: false };
  const a = argv || process.argv;
  for (let i = 2; i < a.length; i++) {
    if (a[i] === '--dry-run') args.dryRun = true;
  }
  return args;
}

// ─── Portal: enumerate bills + capture each PDF download ─────────
async function fetchBillPdfBuffers(secrets) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ locale: 'en-US', acceptDownloads: true });
  const page = await context.newPage();

  const buffers = [];
  try {
    await loginToSmartHub(page, secrets);

    await page.evaluate((h) => { window.location.hash = h; }, BILLING_HISTORY_HASH);
    await page.waitForTimeout(6000);

    const viewBillLinks = await page.locator('text=/view bill/i').all();
    for (const link of viewBillLinks) {
      const [download] = await Promise.all([
        page.waitForEvent('download', { timeout: 15000 }),
        link.click(),
      ]);
      const tmpPath = await download.path();
      if (tmpPath) buffers.push(fs.readFileSync(tmpPath));
    }
  } finally {
    await browser.close();
  }
  return buffers;
}

// ─── PDF save (server-generated filename, never from page content) ────
function saveBillPdf(buffer, accountNumber, billingPeriodEnd) {
  fs.mkdirSync(UPLOADS_BILLS_DIR, { recursive: true });
  const filename = `${accountNumber}_${billingPeriodEnd}.pdf`;
  const target = path.join(UPLOADS_BILLS_DIR, filename);
  if (!target.startsWith(UPLOADS_BILLS_DIR)) {
    throw new Error('Refusing to write outside uploads/bills/');
  }
  fs.writeFileSync(target, buffer);
  return `bills/${filename}`; // relative path stored in DB, served at /uploads/bills/<filename>
}

// ─── DB helpers ─────────────────────────────────────────────────
async function getOrCreateCoservBillAccount(client, accountNumber) {
  let p = (await client.query(`SELECT id FROM utility_providers WHERE name = $1`, [PROVIDER_NAME])).rows[0];
  if (!p) {
    p = (await client.query(
      `INSERT INTO utility_providers (name, type, portal_url, is_active)
       VALUES ($1, 'ELECTRIC', 'https://myaccount.coserv.com', TRUE) RETURNING id`,
      [PROVIDER_NAME]
    )).rows[0];
  }

  let a = (await client.query(`SELECT id FROM utility_accounts WHERE account_number = $1`, [accountNumber])).rows[0];
  if (!a) {
    a = (await client.query(
      `INSERT INTO utility_accounts (provider_id, account_number, status)
       VALUES ($1, $2, 'ACTIVE') RETURNING id`,
      [p.id, accountNumber]
    )).rows[0];
  }
  return a.id;
}

async function upsertCoservBill(client, accountId, bill, batchId, pdfPath) {
  await client.query(
    `INSERT INTO coserv_bills (
       account_id, billing_period_start, billing_period_end, billing_date, due_date,
       electric_usage_kwh, electric_charge, gas_usage_ccf, gas_charge, current_charges, total_due,
       pdf_path, source, source_provider, ingestion_batch_id, processing_version, created_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,NOW())
     ON CONFLICT (account_id, billing_period_start, billing_period_end) DO UPDATE SET
       billing_date = EXCLUDED.billing_date,
       due_date = EXCLUDED.due_date,
       electric_usage_kwh = EXCLUDED.electric_usage_kwh,
       electric_charge = EXCLUDED.electric_charge,
       gas_usage_ccf = EXCLUDED.gas_usage_ccf,
       gas_charge = EXCLUDED.gas_charge,
       current_charges = EXCLUDED.current_charges,
       total_due = EXCLUDED.total_due,
       pdf_path = EXCLUDED.pdf_path,
       ingestion_batch_id = EXCLUDED.ingestion_batch_id,
       processing_version = EXCLUDED.processing_version`,
    [
      accountId, bill.billingPeriodStart, bill.billingPeriodEnd, bill.billingDate, bill.dueDate,
      bill.electricUsageKwh, bill.electricCharge, bill.gasUsageCcf, bill.gasCharge,
      bill.currentCharges, bill.totalDue, pdfPath,
      SOURCE, SOURCE_PROVIDER, batchId, PROCESSING_VERSION,
    ]
  );
}

// ─── Main ──────────────────────────────────────────────────────
async function main(cfg) {
  const secrets = loadSecrets();
  const args = { ...parseArgs(), ...(cfg || {}) };

  if (!secrets.COSERV_USERNAME || !secrets.COSERV_PASSWORD) {
    console.error('❌  Missing COSERV_USERNAME / COSERV_PASSWORD in .env');
    process.exit(1);
  }

  const batchId = crypto.randomUUID();
  console.log('🧾  CoServ Bill Sync (SmartHub Billing History → PDF → coserv_bills)');
  console.log(`   Batch: ${batchId}`);
  if (args.dryRun) console.log('   DRY RUN (no DB writes or PDF saves)');
  console.log('');

  let pdfBuffers;
  try {
    pdfBuffers = await fetchBillPdfBuffers(secrets);
  } catch (e) {
    console.error('❌  SmartHub fetch failed:', e.message);
    process.exit(1);
  }
  console.log(`Found ${pdfBuffers.length} bill PDF(s) on Billing History`);

  const bills = [];
  let parseErrors = 0;
  for (const buf of pdfBuffers) {
    try {
      const { text } = await pdf(buf);
      const bill = parseCoservBillText(text);
      if (bill) {
        bills.push({ bill, buf });
      } else {
        parseErrors++;
        console.warn('⚠️  A PDF did not match the expected bill template — skipped');
      }
    } catch (e) {
      parseErrors++;
      console.warn('⚠️  Failed to parse a PDF:', e.message);
    }
  }

  let client = null;
  if (!args.dryRun && bills.length > 0) {
    client = new Client({
      host: secrets.POSTGRES_HOST || 'localhost',
      port: secrets.POSTGRES_PORT || 5432,
      database: secrets.POSTGRES_DB || 'homeplatform',
      user: secrets.POSTGRES_USER || 'homeplatform',
      password: secrets.POSTGRES_PASSWORD || 'changeme',
    });
    await client.connect();
  }

  let written = 0;
  let hadError = parseErrors > 0;
  try {
    for (const { bill, buf } of bills) {
      if (args.dryRun) {
        console.log(`── ${bill.billingPeriodStart} → ${bill.billingPeriodEnd} | ` +
          `electric ${bill.electricUsageKwh ?? 'n/a'} kWh $${bill.electricCharge} | ` +
          `gas ${bill.gasUsageCcf ?? 'n/a'} CCF $${bill.gasCharge} | ` +
          `total due $${bill.totalDue} (due ${bill.dueDate})`);
        continue;
      }
      const accountId = await getOrCreateCoservBillAccount(client, bill.accountNumber || ACCOUNT_NUMBER);
      const pdfPath = saveBillPdf(buf, bill.accountNumber || ACCOUNT_NUMBER, bill.billingPeriodEnd);
      await upsertCoservBill(client, accountId, bill, batchId, pdfPath);
      written++;
    }
  } catch (e) {
    console.error('── coserv bill sync — error:', e.message);
    hadError = true;
  }

  if (client) await client.end();

  console.log('');
  console.log(`Status: ${hadError ? '⚠ Errors' : '✅ Success'} · ${written} row(s) written\n`);
  return { hadError, written };
}

if (require.main === module) {
  (async () => {
    const result = await main();
    process.exit(result.hadError ? 1 : 0);
  })();
}

module.exports = {
  parseArgs,
  saveBillPdf,
  getOrCreateCoservBillAccount,
  upsertCoservBill,
};
