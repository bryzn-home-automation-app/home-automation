/**
 * Unit tests for scripts/sync-gas.js — the CoServ monthly NATURAL GAS sync.
 *
 * Covers the pure logic (arg parsing, monthly range bounds, gas series
 * extraction, and monthly record mapping) without hitting SmartHub, the DB,
 * or the network.
 *
 * Usage:
 *   node --test test/sync-gas.test.js
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const gas = require(path.join(__dirname, '..', 'scripts', 'sync-gas.js'));

// ─── parseGasArgs ───────────────────────────────────────────────

describe('parseGasArgs()', () => {
  it('returns defaults with no arguments', () => {
    assert.deepEqual(gas.parseGasArgs(['node', 'sync-gas.js']), {
      dryRun: false, startDate: null, endDate: null,
    });
  });

  it('detects --dry-run', () => {
    assert.equal(gas.parseGasArgs(['node', 'sync-gas.js', '--dry-run']).dryRun, true);
  });

  it('reads --start/--end and --date', () => {
    assert.deepEqual(gas.parseGasArgs(['node', 'x', '--start', '07/01/2026', '--end', '08/31/2026']),
      { dryRun: false, startDate: '07/01/2026', endDate: '08/31/2026' });
    assert.deepEqual(gas.parseGasArgs(['node', 'x', '--date', '08/01/2026']),
      { dryRun: false, startDate: '08/01/2026', endDate: '08/01/2026' });
  });
});

// ─── gasSeries ──────────────────────────────────────────────────

describe('gasSeries()', () => {
  it('extracts data.GAS[0].series[0].data', () => {
    const json = { data: { GAS: [{ series: [{ data: [{ x: 1, y: 2 }] }] }] } };
    assert.deepEqual(gas.gasSeries(json), [{ x: 1, y: 2 }]);
  });

  it('returns [] when GAS is missing or empty', () => {
    assert.deepEqual(gas.gasSeries({ data: { ELECTRIC: [{}] } }), []);
    assert.deepEqual(gas.gasSeries({ data: { GAS: [] } }), []);
    assert.deepEqual(gas.gasSeries(null), []);
  });
});

// ─── recordsFromMonthlyGas ──────────────────────────────────────

describe('recordsFromMonthlyGas()', () => {
  it('maps a month bucket to one record, formatting x AS UTC', () => {
    const x = Date.UTC(2026, 7, 1); // local Aug 1 encoded as UTC midnight
    const recs = gas.recordsFromMonthlyGas([{ x, y: 4 }], '1.47');
    assert.equal(recs.length, 1);
    assert.equal(recs[0].timestamp, '2026-08-01 00:00:00');
    assert.equal(recs[0].usageUnits, 4);
    assert.equal(recs[0].cost, 5.88); // 4 * 1.47
    assert.equal(recs[0].source, 'CoServ Usage Explorer Monthly');
    assert.equal(recs[0].sourceProvider, 'coserv');
  });

  it('skips null, zero, and negative usage (no empty placeholder rows)', () => {
    const x = Date.UTC(2026, 7, 1);
    assert.deepEqual(gas.recordsFromMonthlyGas([{ x, y: 0 }], '1.47'), []);
    assert.deepEqual(gas.recordsFromMonthlyGas([{ x, y: -3 }], '1.47'), []);
    assert.deepEqual(gas.recordsFromMonthlyGas([{ x, y: null }], '1.47'), []);
    assert.deepEqual(gas.recordsFromMonthlyGas([null], '1.47'), []);
    assert.deepEqual(gas.recordsFromMonthlyGas([], '1.47'), []);
  });

  it('falls back to the default gas rate on a bad rate', () => {
    const x = Date.UTC(2026, 7, 1);
    const recs = gas.recordsFromMonthlyGas([{ x, y: 2 }], 'not-a-number');
    assert.equal(recs[0].cost, 2.94); // 2 * 1.47 default
  });
});

// ─── resolveMonthlyRange ────────────────────────────────────────

describe('resolveMonthlyRange()', () => {
  it('honors explicit --start/--end as CT day bounds', () => {
    const { startMs, endMs } = gas.resolveMonthlyRange({ startDate: '07/01/2026', endDate: '08/31/2026' });
    assert.ok(startMs < endMs);
    // Start is at/near local Jul 1 00:00 CT (encoded as a true-UTC instant).
    assert.ok(new Date(startMs).toISOString().startsWith('2026-07-01'));
  });

  it('defaults to first-of-last-month → today when no dates given', () => {
    const now = new Date(2026, 7, 15); // Aug 15, 2026 local
    const { startMs, endMs } = gas.resolveMonthlyRange({}, now);
    assert.ok(startMs < endMs);
    assert.ok(new Date(startMs).toISOString().startsWith('2026-07-01'));
  });
});
