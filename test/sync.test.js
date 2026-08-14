/**
 * Unit tests for scripts/sync.js — the Usage Explorer (poll API) sync.
 *
 * Covers the pure logic (arg parsing, date range, timezone day bounds, and
 * record mapping for daily + 15-min→hourly aggregation) without hitting
 * SmartHub, the DB, or the network.
 *
 * Usage:
 *   node --test test/sync.test.js
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const sync = require(path.join(__dirname, '..', 'scripts', 'sync.js'));

// ─── parseArgs ──────────────────────────────────────────────────

describe('parseArgs()', () => {
  it('returns defaults with no arguments', () => {
    assert.deepEqual(sync.parseArgs(['node', 'sync.js']), {
      dryRun: false, date: null, startDate: null, endDate: null, granularity: 'both',
    });
  });

  it('detects --dry-run', () => {
    assert.equal(sync.parseArgs(['node', 'sync.js', '--dry-run']).dryRun, true);
  });

  it('--granularity hourly', () => {
    assert.equal(sync.parseArgs(['node', 'sync.js', '--granularity', 'hourly']).granularity, 'hourly');
  });

  it('--granularity daily', () => {
    assert.equal(sync.parseArgs(['node', 'sync.js', '--granularity', 'daily']).granularity, 'daily');
  });

  it('--granularity both', () => {
    assert.equal(sync.parseArgs(['node', 'sync.js', '--granularity', 'both']).granularity, 'both');
  });

  it('--granularity falls back to both for unknown values', () => {
    assert.equal(sync.parseArgs(['node', 'sync.js', '--granularity', 'weekly']).granularity, 'both');
  });

  it('--daily and --hourly shorthands', () => {
    assert.equal(sync.parseArgs(['node', 'sync.js', '--daily']).granularity, 'daily');
    assert.equal(sync.parseArgs(['node', 'sync.js', '--hourly']).granularity, 'hourly');
  });

  it('--date sets start and end to the same day', () => {
    const r = sync.parseArgs(['node', 'sync.js', '--date', '08/01/2026']);
    assert.equal(r.date, '08/01/2026');
    assert.equal(r.startDate, '08/01/2026');
    assert.equal(r.endDate, '08/01/2026');
  });

  it('--start/--end custom range', () => {
    const r = sync.parseArgs(['node', 'sync.js', '--start', '07/24/2026', '--end', '08/01/2026']);
    assert.equal(r.startDate, '07/24/2026');
    assert.equal(r.endDate, '08/01/2026');
  });
});

// ─── resolveDateRange / fmtDate ─────────────────────────────────

describe('resolveDateRange()', () => {
  it('returns an explicit range unchanged', () => {
    assert.deepEqual(sync.resolveDateRange({ startDate: '08/01/2026', endDate: '08/02/2026' }), {
      startDate: '08/01/2026', endDate: '08/02/2026',
    });
  });

  it('defaults to yesterday', () => {
    // Aug 10, 2026 → yesterday = Aug 9
    assert.deepEqual(sync.resolveDateRange({ startDate: null, endDate: null }, new Date(2026, 7, 10)), {
      startDate: '08/09/2026', endDate: '08/09/2026',
    });
  });
});

describe('fmtDate()', () => {
  it('formats as MM/DD/YYYY with padding', () => {
    assert.equal(sync.fmtDate(new Date(2026, 7, 3)), '08/03/2026');
    assert.equal(sync.fmtDate(new Date(2026, 0, 5)), '01/05/2026');
    assert.equal(sync.fmtDate(new Date(2026, 11, 25)), '12/25/2026');
  });
});

// ─── tzOffsetMs / ctDayBounds ───────────────────────────────────

describe('tzOffsetMs()', () => {
  it('returns -5h (CDT) for a summer instant', () => {
    assert.equal(sync.tzOffsetMs(Date.UTC(2026, 7, 7, 12, 0, 0), 'America/Chicago'), -5 * 60 * 60 * 1000);
  });

  it('returns -6h (CST) for a winter instant', () => {
    assert.equal(sync.tzOffsetMs(Date.UTC(2026, 0, 15, 12, 0, 0), 'America/Chicago'), -6 * 60 * 60 * 1000);
  });
});

describe('ctDayBounds()', () => {
  it('maps a CDT day to UTC boundaries (05:00 → next 04:59)', () => {
    const { startMs, endMs } = sync.ctDayBounds(8, 7, 2026);
    assert.equal(startMs, Date.UTC(2026, 7, 7, 5, 0, 0));
    assert.equal(endMs, Date.UTC(2026, 7, 8, 5, 0, 0) - 1);
  });

  it('maps a CST day to UTC boundaries (06:00 → next 05:59)', () => {
    const { startMs, endMs } = sync.ctDayBounds(1, 15, 2026);
    assert.equal(startMs, Date.UTC(2026, 0, 15, 6, 0, 0));
    assert.equal(endMs, Date.UTC(2026, 0, 16, 6, 0, 0) - 1);
  });
});

// ─── recordsFromDailyData ───────────────────────────────────────

describe('recordsFromDailyData()', () => {
  const rate = 0.1171;

  it('maps a single daily point to one record', () => {
    // x = local Aug 1 00:00 encoded as UTC
    const records = sync.recordsFromDailyData([{ x: 1785542400000, y: 37.3, enableDrilldown: true }], rate);
    assert.equal(records.length, 1);
    assert.equal(records[0].timestamp, '2026-08-01 00:00:00');
    assert.equal(records[0].usageKwh, 37.3);
    assert.equal(records[0].cost, 4.37); // 37.3 * 0.1171 ≈ 4.3678 → 4.37
    assert.equal(records[0].sourceProvider, 'coserv');
  });

  it('skips null/missing points', () => {
    const records = sync.recordsFromDailyData(
      [{ x: 1785542400000, y: null }, { y: 1 }, { x: 1785542400000 }, null],
      rate
    );
    assert.equal(records.length, 0);
  });

  it('returns [] for empty input', () => {
    assert.deepEqual(sync.recordsFromDailyData([], rate), []);
    assert.deepEqual(sync.recordsFromDailyData(null, rate), []);
  });
});

// ─── recordsFromIntervalData (15-min → 1 hour) ──────────────────

describe('recordsFromIntervalData()', () => {
  const rate = 0.1171;
  const HOUR = 3600000;
  const Q = 15 * 60 * 1000; // 15 minutes

  it('sums the four 15-min points of an hour into one record', () => {
    const base = 1785542400000; // local Aug 1 00:00
    const points = [0, 1, 2, 3].map((i) => ({ x: base + i * Q, y: 0.1 * (i + 1) }));
    const records = sync.recordsFromIntervalData(points, rate);
    assert.equal(records.length, 1);
    assert.equal(records[0].timestamp, '2026-08-01 00:00:00');
    assert.equal(records[0].usageKwh, 1.0); // 0.1 + 0.2 + 0.3 + 0.4
  });

  it('maps 96 points to 24 hourly records', () => {
    const base = 1785542400000;
    const points = [];
    for (let i = 0; i < 96; i++) points.push({ x: base + i * Q, y: 1 });
    const records = sync.recordsFromIntervalData(points, rate);
    assert.equal(records.length, 24);
    assert.equal(records[0].timestamp, '2026-08-01 00:00:00');
    assert.equal(records[23].timestamp, '2026-08-01 23:00:00');
    assert.equal(records[0].usageKwh, 4); // 4 points × 1
    assert.equal(records.reduce((s, r) => s + r.usageKwh, 0), 96);
  });

  it('groups points into correct hour buckets across the day', () => {
    const base = 1785542400000;
    // one point at 00:45 and one point at 01:00 (different hours)
    const points = [
      { x: base + 3 * Q, y: 0.5 },       // 00:45
      { x: base + 4 * Q, y: 1.5 },       // 01:00
    ];
    const records = sync.recordsFromIntervalData(points, rate);
    assert.equal(records.length, 2);
    assert.equal(records[0].timestamp, '2026-08-01 00:00:00');
    assert.equal(records[0].usageKwh, 0.5);
    assert.equal(records[1].timestamp, '2026-08-01 01:00:00');
    assert.equal(records[1].usageKwh, 1.5);
  });

  it('skips null y but keeps explicit zero', () => {
    const base = 1785542400000;
    const points = [
      { x: base, y: 0 },        // explicit zero
      { x: base + Q, y: null }, // null → skip
      { x: base + 2 * Q, y: 0.5 },
    ];
    const records = sync.recordsFromIntervalData(points, rate);
    assert.equal(records.length, 1);
    assert.equal(records[0].usageKwh, 0.5);
  });

  it('returns [] for empty input', () => {
    assert.deepEqual(sync.recordsFromIntervalData([], rate), []);
    assert.deepEqual(sync.recordsFromIntervalData(null, rate), []);
  });
});

// ─── buildPayload ───────────────────────────────────────────────

describe('buildPayload()', () => {
  it('builds the HOURLY poll payload', () => {
    const p = sync.buildPayload('HOURLY', { COSERV_USERNAME: 'user@example.com' }, 1785560400000, 1785645900001);
    assert.deepEqual(p, {
      timeFrame: 'HOURLY',
      userId: 'user@example.com',
      screen: 'USAGE_EXPLORER',
      includeDemand: false,
      serviceLocationNumber: '1059153',
      accountNumber: '9002001851',
      industries: ['GAS', 'ELECTRIC'],
      startDateTime: 1785560400000,
      endDateTime: 1785645900001,
      selectedIndustry: 'ELECTRIC',
    });
  });

  it('builds the DAILY poll payload', () => {
    const p = sync.buildPayload('DAILY', { COSERV_USERNAME: 'user@example.com' }, 1, 2);
    assert.equal(p.timeFrame, 'DAILY');
  });
});
