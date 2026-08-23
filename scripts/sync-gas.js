#!/usr/bin/env node
/**
 * CoServ SmartHub → PostgreSQL — NATURAL GAS usage sync (monthly only).
 *
 * CoServ exposes gas usage ONLY as a monthly billing figure — there is no
 * daily/hourly interval gas data (verified against the live Usage Explorer API:
 * GAS at timeFrame DAILY/HOURLY returns empty; MONTHLY returns one point per
 * billing cycle). So this writes one row per billing month into `gas_usage`.
 *
 * It reuses the auth capture + async poll flow from scripts/sync.js; only the
 * timeFrame (MONTHLY), the response key (data.GAS), and the target meter/table
 * differ. Run daily — the monthly value is upserted, so re-running before the
 * next cycle is a cheap no-op until CoServ posts a new month.
 *
 * Usage:
 *   node scripts/sync-gas.js                       # current + previous month
 *   node scripts/sync-gas.js --start 07/01/2026 --end 08/31/2026
 *   node scripts/sync-gas.js --dry-run             # preview, no DB writes
 *
 * Exit: 0 = success, 1 = errors occurred
 */
'use strict';

const { Client } = require('pg');
const crypto = require('crypto');
const {
  ctDayBounds,
  fmtDate,
  loadSecrets,
  captureAuthToken,
  pollUntilComplete,
  buildPayload,
  SOURCE_PROVIDER,
  PROCESSING_VERSION,
} = require('./sync');

// Gas meter identity on the CoServ account (distinct account/meter from electric).
const METER_ACCOUNT_GAS = '9002001851-NATURAL GAS';
const METER_NUMBER_GAS = '9002001851-NATURAL GAS-NATURAL GAS';
// Distinct from the deprecated Green Button gas source so the two never collide
// in intent — and so a glance at `source` says which pipeline wrote the row.
const SOURCE_MONTHLY = 'CoServ Usage Explorer Monthly';

// ─── Args ───────────────────────────────────────────────────────
function parseGasArgs(argv) {
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

/**
 * Default window: first of LAST month → today, so the latest posted billing
 * bucket is always inside the range (a cycle can straddle a month boundary).
 * Returns true-UTC epoch bounds via ctDayBounds (DST-correct).
 */
function resolveMonthlyRange(args, now) {
  const n = now ? new Date(now) : new Date();
  let start;
  let end;
  if (args.startDate && args.endDate) {
    const [sm, sd, sy] = args.startDate.split('/').map(Number);
    const [em, ed, ey] = args.endDate.split('/').map(Number);
    start = ctDayBounds(sm, sd, sy);
    end = ctDayBounds(em, ed, ey);
  } else {
    const first = new Date(n.getFullYear(), n.getMonth() - 1, 1);
    start = ctDayBounds(first.getMonth() + 1, first.getDate(), first.getFullYear());
    end = ctDayBounds(n.getMonth() + 1, n.getDate(), n.getFullYear());
  }
  return { startMs: start.startMs, endMs: end.endMs };
}

// ─── Record mapping (pure, unit-tested) ─────────────────────────

function gasSeries(json) {
  const gas = json && json.data && json.data.GAS;
  if (!gas || !gas.length) return [];
  return (gas[0].series && gas[0].series[0] && gas[0].series[0].data) || [];
}

/**
 * Map a MONTHLY gas series [{x, y}, …] (1 point per billing month) to DB
 * records. `x` is the month bucket as local wall-clock encoded as UTC (e.g.
 * local Aug 1 → 2026-08-01T00:00:00Z), so formatting it AS UTC yields the
 * correct billing-month timestamp. `y` is usage in CoServ's generic "units"
 * (stored in gas_usage.usage_kwh, priced by the gas $/unit rate). Zero-usage
 * months are skipped so we don't recreate empty placeholder rows.
 */
function recordsFromMonthlyGas(data, gasUnitRate) {
  if (!Array.isArray(data) || !data.length) return [];
  const rate = parseFloat(gasUnitRate) || 1.47;
  const records = [];
  for (const pt of data) {
    if (pt == null || pt.x == null || pt.y == null) continue;
    const usage = Math.round(Number(pt.y) * 1000) / 1000;
    if (!Number.isFinite(usage) || usage <= 0) continue;
    const timestamp = new Date(pt.x).toISOString().replace('T', ' ').substring(0, 19);
    records.push({
      timestamp,
      usageUnits: usage,
      cost: Math.round(usage * rate * 100) / 100,
      source: SOURCE_MONTHLY,
      sourceProvider: SOURCE_PROVIDER,
      processingVersion: PROCESSING_VERSION,
    });
  }
  return records;
}

// ─── DB helpers ─────────────────────────────────────────────────
async function getOrCreateGasMeter(client) {
  let p = (await client.query(`SELECT id FROM utility_providers WHERE name = 'CoServ'`)).rows[0];
  if (!p) p = (await client.query(`INSERT INTO utility_providers (name, type) VALUES ('CoServ', 'ELECTRIC') RETURNING id`)).rows[0];

  let a = (await client.query(`SELECT id FROM utility_accounts WHERE account_number = $1`, [METER_ACCOUNT_GAS])).rows[0];
  if (!a) a = (await client.query(`INSERT INTO utility_accounts (provider_id, account_number, status) VALUES ($1, $2, 'ACTIVE') RETURNING id`, [p.id, METER_ACCOUNT_GAS])).rows[0];

  let m = (await client.query(`SELECT id FROM meters WHERE meter_number = $1`, [METER_NUMBER_GAS])).rows[0];
  if (!m) m = (await client.query(`INSERT INTO meters (account_id, meter_number, type) VALUES ($1, $2, 'GAS') RETURNING id`, [a.id, METER_NUMBER_GAS])).rows[0];
  return m.id;
}

// ─── Main ──────────────────────────────────────────────────────
async function main(cfg) {
  const secrets = loadSecrets();
  const args = { ...parseGasArgs(), ...(cfg || {}) };

  if (!secrets.COSERV_USERNAME || !secrets.COSERV_PASSWORD) {
    console.error('❌  Missing COSERV_USERNAME or COSERV_PASSWORD in .env');
    process.exit(1);
  }

  const { startMs, endMs } = resolveMonthlyRange(args);
  const batchId = crypto.randomUUID();
  const gasUnitRate = process.env.GAS_UNIT_RATE || '1.47';

  console.log('🔥  CoServ Gas Sync (Usage Explorer API — MONTHLY)');
  console.log(`   Range: ${new Date(startMs).toISOString().substring(0, 10)} → ${new Date(endMs).toISOString().substring(0, 10)}`);
  console.log(`   Batch: ${batchId}`);
  if (args.dryRun) console.log('   DRY RUN (no DB writes)');
  console.log('');

  let client = null;
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
  if (client) meterId = await getOrCreateGasMeter(client);

  let apiHeaders;
  try {
    apiHeaders = await captureAuthToken(secrets);
    console.log('✓  Logged into SmartHub and captured auth token\n');
  } catch (e) {
    console.error('❌  Login/auth capture failed:', e.message);
    if (client) await client.end();
    process.exit(1);
  }

  let written = 0;
  let hadError = false;
  try {
    const json = await pollUntilComplete(apiHeaders, buildPayload('MONTHLY', secrets, startMs, endMs));
    const records = recordsFromMonthlyGas(gasSeries(json), gasUnitRate);

    if (args.dryRun) {
      console.log(`── gas (monthly) — ${records.length} record(s)`);
      for (const r of records) console.log(`   ${r.timestamp} | ${r.usageUnits} units · $${r.cost}`);
    } else if (records.length > 0 && client) {
      for (const r of records) {
        await client.query(
          `INSERT INTO gas_usage (meter_id, timestamp, usage_kwh, cost, source, source_provider, ingestion_batch_id, processing_version)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (meter_id, timestamp, source_provider) DO UPDATE SET
             usage_kwh = EXCLUDED.usage_kwh, cost = EXCLUDED.cost, source = EXCLUDED.source,
             ingestion_batch_id = EXCLUDED.ingestion_batch_id, processing_version = EXCLUDED.processing_version`,
          [meterId, r.timestamp, r.usageUnits, r.cost, r.source, r.sourceProvider, batchId, r.processingVersion]
        );
        written++;
      }
      console.log(`── gas (monthly) — ${records.length} billing month(s) · ${written} written`);
    } else {
      console.log('── gas (monthly) — 0 records (no gas usage posted yet)');
    }
  } catch (e) {
    console.error(`── gas (monthly) — error: ${e.message}`);
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
  parseGasArgs,
  resolveMonthlyRange,
  gasSeries,
  recordsFromMonthlyGas,
};
