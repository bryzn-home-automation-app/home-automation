#!/usr/bin/env node
/**
 * Gmail → PDF → PostgreSQL — City of Lewisville water bill sync.
 *
 * The water bill arrives monthly as a PDF attachment on an email forwarded
 * (or filtered) into a Gmail label. This lists every labeled message with a
 * PDF attachment, downloads and parses each one (scripts/water-bill-parser.js),
 * and upserts into `water_bills` keyed on (account, billing period) — so
 * re-running against already-processed mail is a cheap no-op, and a full
 * mailbox search naturally backfills bill history on first run.
 *
 * Usage:
 *   node scripts/sync-water-bill.js                # sync all labeled bills
 *   node scripts/sync-water-bill.js --dry-run       # preview, no DB writes
 *
 * Exit: 0 = success, 1 = errors occurred
 */
'use strict';

const { google } = require('googleapis');
const pdf = require('pdf-parse');
const { Client } = require('pg');
const crypto = require('crypto');
const { loadSecrets } = require('./sync');
const { parseWaterBillText } = require('./water-bill-parser');

const SOURCE = 'Gmail Water Bill PDF';
const SOURCE_PROVIDER = 'gmail-water-bill';
const PROCESSING_VERSION = '1.0';
const PROVIDER_NAME = 'City of Lewisville';

// ─── Args ───────────────────────────────────────────────────────
function parseArgs(argv) {
  const args = { dryRun: false };
  const a = argv || process.argv;
  for (let i = 2; i < a.length; i++) {
    if (a[i] === '--dry-run') args.dryRun = true;
  }
  return args;
}

// ─── Gmail ──────────────────────────────────────────────────────
function buildGmailClient(secrets) {
  const oauth2Client = new google.auth.OAuth2(secrets.GMAIL_CLIENT_ID, secrets.GMAIL_CLIENT_SECRET);
  oauth2Client.setCredentials({ refresh_token: secrets.GMAIL_REFRESH_TOKEN });
  return google.gmail({ version: 'v1', auth: oauth2Client });
}

/** Flatten a Gmail message's MIME part tree to find PDF attachment parts. */
function findPdfAttachmentParts(payload) {
  const found = [];
  const walk = (part) => {
    if (!part) return;
    if (part.filename && part.filename.toLowerCase().endsWith('.pdf') && part.body && part.body.attachmentId) {
      found.push(part);
    }
    (part.parts || []).forEach(walk);
  };
  walk(payload);
  return found;
}

async function fetchBillPdfBuffers(gmail, label) {
  const buffers = [];
  let pageToken;
  do {
    const list = await gmail.users.messages.list({
      userId: 'me',
      q: `label:"${label}" has:attachment filename:pdf`,
      pageToken,
    });
    for (const { id } of list.data.messages || []) {
      const msg = await gmail.users.messages.get({ userId: 'me', id });
      for (const part of findPdfAttachmentParts(msg.data.payload)) {
        const attachment = await gmail.users.messages.attachments.get({
          userId: 'me',
          messageId: id,
          id: part.body.attachmentId,
        });
        buffers.push(Buffer.from(attachment.data.data, 'base64'));
      }
    }
    pageToken = list.data.nextPageToken;
  } while (pageToken);
  return buffers;
}

// ─── DB helpers ─────────────────────────────────────────────────
async function getOrCreateWaterAccount(client, accountNumber, serviceAddress) {
  let p = (await client.query(`SELECT id FROM utility_providers WHERE name = $1`, [PROVIDER_NAME])).rows[0];
  if (!p) {
    p = (await client.query(
      `INSERT INTO utility_providers (name, type, portal_url, is_active)
       VALUES ($1, 'WATER', 'https://payments.dentoncountyfwsd.com', TRUE) RETURNING id`,
      [PROVIDER_NAME]
    )).rows[0];
  }

  let a = (await client.query(`SELECT id FROM utility_accounts WHERE account_number = $1`, [accountNumber])).rows[0];
  if (!a) {
    a = (await client.query(
      `INSERT INTO utility_accounts (provider_id, account_number, service_address, status)
       VALUES ($1, $2, $3, 'ACTIVE') RETURNING id`,
      [p.id, accountNumber, serviceAddress || null]
    )).rows[0];
  }
  return a.id;
}

async function upsertWaterBill(client, accountId, bill, batchId) {
  await client.query(
    `INSERT INTO water_bills (
       account_id, billing_period_start, billing_period_end, billing_date, due_date,
       usage_thousands, water_charge, sewer_charge, refuse_charge, tax_charge,
       stormwater_charge, ach_discount, total_due,
       source, source_provider, ingestion_batch_id, processing_version
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
     ON CONFLICT (account_id, billing_period_start, billing_period_end) DO UPDATE SET
       billing_date = EXCLUDED.billing_date,
       due_date = EXCLUDED.due_date,
       usage_thousands = EXCLUDED.usage_thousands,
       water_charge = EXCLUDED.water_charge,
       sewer_charge = EXCLUDED.sewer_charge,
       refuse_charge = EXCLUDED.refuse_charge,
       tax_charge = EXCLUDED.tax_charge,
       stormwater_charge = EXCLUDED.stormwater_charge,
       ach_discount = EXCLUDED.ach_discount,
       total_due = EXCLUDED.total_due,
       ingestion_batch_id = EXCLUDED.ingestion_batch_id,
       processing_version = EXCLUDED.processing_version`,
    [
      accountId, bill.billingPeriodStart, bill.billingPeriodEnd, bill.billingDate, bill.dueDate,
      bill.usageThousands, bill.waterCharge, bill.sewerCharge, bill.refuseCharge, bill.taxCharge,
      bill.stormwaterCharge, bill.achDiscount, bill.totalDue,
      SOURCE, SOURCE_PROVIDER, batchId, PROCESSING_VERSION,
    ]
  );
}

// ─── Main ──────────────────────────────────────────────────────
async function main(cfg) {
  const secrets = loadSecrets();
  const args = { ...parseArgs(), ...(cfg || {}) };
  const label = secrets.GMAIL_WATER_BILL_LABEL || 'Water Bill';

  if (!secrets.GMAIL_CLIENT_ID || !secrets.GMAIL_CLIENT_SECRET || !secrets.GMAIL_REFRESH_TOKEN) {
    console.error('❌  Missing GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET / GMAIL_REFRESH_TOKEN in .env');
    console.error('    Run `node scripts/gmail-authorize.js` once to obtain a refresh token.');
    process.exit(1);
  }

  const batchId = crypto.randomUUID();
  console.log('💧  Water Bill Sync (Gmail → PDF → water_bills)');
  console.log(`   Label: "${label}"`);
  console.log(`   Batch: ${batchId}`);
  if (args.dryRun) console.log('   DRY RUN (no DB writes)');
  console.log('');

  const gmail = buildGmailClient(secrets);

  let pdfBuffers;
  try {
    pdfBuffers = await fetchBillPdfBuffers(gmail, label);
  } catch (e) {
    console.error('❌  Gmail fetch failed:', e.message);
    process.exit(1);
  }
  console.log(`Found ${pdfBuffers.length} PDF attachment(s) under label "${label}"`);

  const bills = [];
  let parseErrors = 0;
  for (const buf of pdfBuffers) {
    try {
      const { text } = await pdf(buf);
      const bill = parseWaterBillText(text);
      if (bill) {
        bills.push(bill);
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
    for (const bill of bills) {
      if (args.dryRun) {
        console.log(`── ${bill.billingPeriodStart} → ${bill.billingPeriodEnd} | usage ${bill.usageThousands} | ` +
          `water $${bill.waterCharge} sewer $${bill.sewerCharge} refuse $${bill.refuseCharge} ` +
          `tax $${bill.taxCharge} stormwater $${bill.stormwaterCharge} ` +
          `ach ${bill.achDiscount ?? 'n/a'} | total due $${bill.totalDue} (due ${bill.dueDate})`);
        continue;
      }
      const accountId = await getOrCreateWaterAccount(
        client,
        bill.accountNumber || secrets.WATER_ACCOUNT_NUMBER,
        secrets.WATER_SERVICE_ADDRESS
      );
      await upsertWaterBill(client, accountId, bill, batchId);
      written++;
    }
  } catch (e) {
    console.error('── water bill sync — error:', e.message);
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
  findPdfAttachmentParts,
  getOrCreateWaterAccount,
  upsertWaterBill,
};
