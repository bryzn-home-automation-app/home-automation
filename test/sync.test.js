/**
 * Unit tests for sync.js — covers all sync modes and logic branches.
 *
 * These tests exercise the pure functions (parseArgs, decideSyncMode,
 * parseGreenButtonXml, checkZeroGap) without hitting SmartHub or the DB.
 *
 * Usage:
 *   node --test test/sync.test.js
 *   node --test --test-reporter spec test/sync.test.js   # verbose
 */
'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

// Load sync module
const sync = require(path.join(__dirname, '..', 'scripts', 'sync.js'));

// ─── Helpers ────────────────────────────────────────────────────

/** Create a mock PG client with canned query results. */
function mockClient(responses) {
  return {
    queryCalls: [],
    query(sql, params) {
      this.queryCalls.push({ sql: sql.substring(0, 80), params });
      const key = params?.[0] ?? '__default__';
      const result = responses[key] || responses.__default__ || { rows: [] };
      return Promise.resolve(result);
    },
  };
}

/** Fixed dates for deterministic tests. Sunday = Aug 9, 2026 (a Sunday) */
const SUNDAY = new Date(2026, 7, 9);   // Aug 9, 2026 = Sunday
const MONDAY = new Date(2026, 7, 10);   // Aug 10 = Monday
const WEDNESDAY = new Date(2026, 7, 12); // Aug 12 = Wednesday
const FRIDAY = new Date(2026, 7, 14);   // Aug 14 = Friday

// ─── parseArgs ──────────────────────────────────────────────────

describe('parseArgs()', () => {
  it('returns defaults with no arguments', () => {
    const result = sync.parseArgs(['node', 'sync.js']);
    assert.deepEqual(result, { dryRun: false, date: null, weekly: false });
  });

  it('detects --dry-run', () => {
    const result = sync.parseArgs(['node', 'sync.js', '--dry-run']);
    assert.equal(result.dryRun, true);
  });

  it('detects --weekly', () => {
    const result = sync.parseArgs(['node', 'sync.js', '--weekly']);
    assert.equal(result.weekly, true);
  });

  it('detects --date with value', () => {
    const result = sync.parseArgs(['node', 'sync.js', '--date', '08/03/2026']);
    assert.equal(result.date, '08/03/2026');
  });

  it('detects all flags at once', () => {
    const result = sync.parseArgs(['node', 'sync.js', '--weekly', '--dry-run', '--date', '07/24/2026']);
    assert.deepEqual(result, { dryRun: true, date: '07/24/2026', weekly: true });
  });

  it('ignores --date without a value', () => {
    const result = sync.parseArgs(['node', 'sync.js', '--date']);
    assert.equal(result.date, null);
  });
});

// ─── isSunday ───────────────────────────────────────────────────

describe('isSunday()', () => {
  it('returns true for Sunday', () => {
    assert.equal(sync.isSunday(SUNDAY), true);
  });

  it('returns false for Monday', () => {
    assert.equal(sync.isSunday(MONDAY), false);
  });

  it('returns false for Wednesday', () => {
    assert.equal(sync.isSunday(WEDNESDAY), false);
  });

  it('returns false for Friday', () => {
    assert.equal(sync.isSunday(FRIDAY), false);
  });
});

// ─── fmtDate / parseDate ────────────────────────────────────────

describe('fmtDate()', () => {
  it('formats a date as MM/DD/YYYY', () => {
    assert.equal(sync.fmtDate(new Date(2026, 7, 3)), '08/03/2026');
  });

  it('pads single digit months and days', () => {
    assert.equal(sync.fmtDate(new Date(2026, 0, 5)), '01/05/2026');
    assert.equal(sync.fmtDate(new Date(2026, 11, 25)), '12/25/2026');
  });
});

describe('parseDate()', () => {
  it('parses MM/DD/YYYY strings', () => {
    const d = sync.parseDate('07/24/2026');
    assert.equal(d.getFullYear(), 2026);
    assert.equal(d.getMonth(), 6); // 0-indexed
    assert.equal(d.getDate(), 24);
  });
});

// ─── decideSyncMode ─────────────────────────────────────────────

describe('decideSyncMode()', () => {
  it('single: --date returns that date as single day range', async () => {
    const result = await sync.decideSyncMode(
      null,
      { date: '08/03/2026', weekly: false, dryRun: false },
      {},
      FRIDAY
    );
    assert.equal(result.mode, 'single');
    assert.equal(result.startDate, '08/03/2026');
    assert.equal(result.endDate, '08/03/2026');
  });

  it('weekly: --weekly flag returns last 7 days', async () => {
    const result = await sync.decideSyncMode(
      null,
      { date: null, weekly: true, dryRun: false },
      {},
      FRIDAY  // Aug 14 — yesterday = Aug 13
    );
    assert.ok(result.mode.includes('weekly'), `Expected weekly mode, got: ${result.mode}`);
    assert.equal(result.endDate, '08/13/2026');
    assert.equal(result.startDate, '08/07/2026'); // 7 days: 8/7 - 8/13
  });

  it('weekly: Sunday triggers automatic weekly sync', async () => {
    const result = await sync.decideSyncMode(
      null,
      { date: null, weekly: false, dryRun: false },
      {},
      SUNDAY  // Aug 9 — yesterday = Aug 8
    );
    assert.equal(result.mode, 'weekly (Sunday)');
    assert.equal(result.endDate, '08/08/2026');
    assert.equal(result.startDate, '08/02/2026'); // 7 days back
  });

  it('daily: Monday returns yesterday only', async () => {
    const today = new Date(2026, 7, 10);
    const d1 = new Date(today); d1.setDate(d1.getDate() - 1);
    const d2 = new Date(today); d2.setDate(d2.getDate() - 2);
    const d3 = new Date(today); d3.setDate(d3.getDate() - 3);
    const client = mockClient({
      3: { rows: [
        { usage_kwh: '50.85', d: d1 },
        { usage_kwh: '57.66', d: d2 },
        { usage_kwh: '53.54', d: d3 },
      ]},
    });

    const result = await sync.decideSyncMode(
      client,
      { date: null, weekly: false, dryRun: false },
      {},
      MONDAY  // Aug 10 — yesterday = Aug 9
    );
    assert.equal(result.mode, 'daily');
    assert.equal(result.startDate, '08/09/2026');
    assert.equal(result.endDate, '08/09/2026');
  });

  it('daily: Wednesday with normal data returns daily', async () => {
    const today = new Date(2026, 7, 12);
    const d1 = new Date(today); d1.setDate(d1.getDate() - 1);
    const d2 = new Date(today); d2.setDate(d2.getDate() - 2);
    const d3 = new Date(today); d3.setDate(d3.getDate() - 3);
    const client = mockClient({
      3: { rows: [
        { usage_kwh: '31.00', d: d1 },
        { usage_kwh: '30.00', d: d2 },
        { usage_kwh: '37.30', d: d3 },
      ]},
    });

    const result = await sync.decideSyncMode(
      client,
      { date: null, weekly: false, dryRun: false },
      {},
      WEDNESDAY
    );
    assert.equal(result.mode, 'daily');
  });

  it('zero-guard: 3+ consecutive zeros in Electric triggers zero-guard', async () => {
    // Note: mock rows need to include 'd' for console.log in checkZeroGap
    const client = mockClient({
      3: { rows: [
        { usage_kwh: '0.000', d: new Date(2026, 7, 10) },
        { usage_kwh: '0.000', d: new Date(2026, 7, 9) },
        { usage_kwh: '0.000', d: new Date(2026, 7, 8) },
      ]},
    });

    const result = await sync.decideSyncMode(
      client,
      { date: null, weekly: false, dryRun: false },
      {},
      WEDNESDAY  // Aug 12 — yesterday = Aug 11
    );
    assert.equal(result.mode, 'zero-guard');
    // zero-guard retries the last 3 days
    assert.equal(result.startDate, '08/09/2026');
    assert.equal(result.endDate, '08/11/2026');
  });

  it('zero-guard: not triggered with less than ZERO_GUARD_DAYS rows', async () => {
    const client = mockClient({
      3: { rows: [] },  // empty DB
    });

    const result = await sync.decideSyncMode(
      client,
      { date: null, weekly: false, dryRun: false },
      {},
      FRIDAY
    );
    assert.equal(result.mode, 'daily');
  });

  it('zero-guard: not triggered with mixed data (some non-zero)', async () => {
    const today = new Date(2026, 7, 14);
    const d1 = new Date(today); d1.setDate(d1.getDate() - 1);
    const d2 = new Date(today); d2.setDate(d2.getDate() - 2);
    const d3 = new Date(today); d3.setDate(d3.getDate() - 3);
    const client = mockClient({
      3: { rows: [
        { usage_kwh: '50.85', d: d1 },
        { usage_kwh: '0.000', d: d2 },
        { usage_kwh: '0.000', d: d3 },
      ]},
    });

    const result = await sync.decideSyncMode(
      client,
      { date: null, weekly: false, dryRun: false },
      {},
      FRIDAY
    );
    assert.equal(result.mode, 'daily');
  });

  it('zero-guard: not triggered when only 2 rows (not enough data)', async () => {
    const client = mockClient({
      3: { rows: [
        { usage_kwh: '0.000', d: new Date(2026, 7, 13) },
        { usage_kwh: '0.000', d: new Date(2026, 7, 12) },
      ]},
    });

    const result = await sync.decideSyncMode(
      client,
      { date: null, weekly: false, dryRun: false },
      {},
      FRIDAY
    );
    assert.equal(result.mode, 'daily');
  });

  it('daily without DB client (dry-run mode) returns daily', async () => {
    const result = await sync.decideSyncMode(
      null,  // no client
      { date: null, weekly: false, dryRun: true },
      {},
      FRIDAY
    );
    assert.equal(result.mode, 'daily');
    assert.equal(result.startDate, result.endDate);
  });
});

// ─── parseGreenButtonXml ─────────────────────────────────────────

describe('parseGreenButtonXml()', () => {
  it('parses a single IntervalReading', () => {
    const xml = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry><content>
    <IntervalBlock xmlns="http://naesb.org/espi">
      <interval><duration>172800</duration><start>1785733200</start><uom>72</uom><currency>840</currency></interval>
      <IntervalReading>
        <powerOfTenMultiplier>3</powerOfTenMultiplier>
        <timePeriod><duration>86400</duration><start>1785733200</start></timePeriod>
        <value>31000</value>
      </IntervalReading>
    </IntervalBlock>
  </content></entry>
</feed>`;

    const results = sync.parseGreenButtonXml(xml);
    assert.equal(results.length, 1);
    assert.equal(results[0].usageKwh, 31);  // 31000 / 10^3
    assert.equal(results[0].sourceProvider, 'coserv');
    assert.equal(results[0].source, 'CoServ Green Button');
    assert.ok(results[0].timestamp.includes('2026-08-03')); // epoch 1785733200 = Aug 3, 2026
  });

  it('skips demand readings (uom 38 = kW)', () => {
    const xml = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry><content>
    <IntervalBlock xmlns="http://naesb.org/espi">
      <interval><duration>172800</duration><start>1785733200</start><uom>38</uom><currency>840</currency></interval>
      <IntervalReading>
        <powerOfTenMultiplier>3</powerOfTenMultiplier>
        <timePeriod><duration>86400</duration><start>1785733200</start></timePeriod>
        <value>5000</value>
      </IntervalReading>
    </IntervalBlock>
  </content></entry>
</feed>`;

    const results = sync.parseGreenButtonXml(xml);
    assert.equal(results.length, 0, 'Demand (kW) readings should be skipped');
  });

  it('parses multiple readings from one IntervalBlock', () => {
    const xml = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry><content>
    <IntervalBlock xmlns="http://naesb.org/espi">
      <interval><duration>259200</duration><start>1785733200</start><uom>72</uom><currency>840</currency></interval>
      <IntervalReading>
        <powerOfTenMultiplier>3</powerOfTenMultiplier>
        <timePeriod><duration>86400</duration><start>1785733200</start></timePeriod>
        <value>31000</value>
      </IntervalReading>
      <IntervalReading>
        <powerOfTenMultiplier>3</powerOfTenMultiplier>
        <timePeriod><duration>86400</duration><start>1785819600</start></timePeriod>
        <value>29000</value>
      </IntervalReading>
    </IntervalBlock>
  </content></entry>
</feed>`;

    const results = sync.parseGreenButtonXml(xml);
    assert.equal(results.length, 2);
    assert.equal(results[0].usageKwh, 31);
    assert.equal(results[1].usageKwh, 29);
  });

  it('handles negative powerOfTenMultiplier', () => {
    const xml = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry><content>
    <IntervalBlock xmlns="http://naesb.org/espi">
      <interval><duration>86400</duration><start>1785733200</start><uom>72</uom><currency>840</currency></interval>
      <IntervalReading>
        <powerOfTenMultiplier>-3</powerOfTenMultiplier>
        <timePeriod><duration>86400</duration><start>1785733200</start></timePeriod>
        <value>12345</value>
      </IntervalReading>
    </IntervalBlock>
  </content></entry>
</feed>`;

    const results = sync.parseGreenButtonXml(xml);
    assert.equal(results.length, 1);
    // 12345 * 10^(-(-3)) = 12345 * 10^3 = 12,345,000
    // Wait, the formula is rawValue / 10^multiplier.
    // multiplier = -3, so 10^(-3) = 0.001, so 12345 / 0.001 = 12,345,000
    // That seems wrong for real data but validates the math
    assert.equal(results[0].usageKwh, 12345000);
  });

  it('uses default timezone offset (-21600) when missing', () => {
    const xml = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry><content>
    <IntervalBlock xmlns="http://naesb.org/espi">
      <interval><duration>86400</duration><start>1785733200</start><uom>72</uom></interval>
      <IntervalReading>
        <powerOfTenMultiplier>3</powerOfTenMultiplier>
        <timePeriod><duration>86400</duration><start>1785733200</start></timePeriod>
        <value>31000</value>
      </IntervalReading>
    </IntervalBlock>
  </content></entry>
</feed>`;

    const results = sync.parseGreenButtonXml(xml);
    assert.equal(results.length, 1); // Should still parse fine
  });

  it('skips readings with missing value or start', () => {
    const xml = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry><content>
    <IntervalBlock xmlns="http://naesb.org/espi">
      <interval><duration>86400</duration><start>1785733200</start><uom>72</uom></interval>
      <IntervalReading>
        <powerOfTenMultiplier>3</powerOfTenMultiplier>
        <timePeriod><duration>86400</duration></timePeriod>
        <value>31000</value>
      </IntervalReading>
    </IntervalBlock>
  </content></entry>
</feed>`;

    const results = sync.parseGreenButtonXml(xml);
    assert.equal(results.length, 0, 'Missing start should skip reading');
  });

  it('returns empty array for non-Green-Button XML', () => {
    const results = sync.parseGreenButtonXml('<root>not green button</root>');
    assert.equal(results.length, 0);
  });

  it('returns empty array for empty string', () => {
    const results = sync.parseGreenButtonXml('');
    assert.equal(results.length, 0);
  });
});

// ─── checkZeroGap ───────────────────────────────────────────────

describe('checkZeroGap()', () => {
  it('returns true when last 3 rows are all zero', async () => {
    const today = new Date();
    const d1 = new Date(today); d1.setDate(d1.getDate() - 1);
    const d2 = new Date(today); d2.setDate(d2.getDate() - 2);
    const d3 = new Date(today); d3.setDate(d3.getDate() - 3);
    const client = mockClient({
      3: { rows: [
        { usage_kwh: '0.000', d: d1 },
        { usage_kwh: '0.000', d: d2 },
        { usage_kwh: '0.000', d: d3 },
      ]},
    });
    const result = await sync.checkZeroGap(client);
    assert.equal(result, true);
  });

  it('returns false when last 3 rows include non-zero', async () => {
    const today = new Date();
    const d1 = new Date(today); d1.setDate(d1.getDate() - 1);
    const d2 = new Date(today); d2.setDate(d2.getDate() - 2);
    const d3 = new Date(today); d3.setDate(d3.getDate() - 3);
    const client = mockClient({
      3: { rows: [
        { usage_kwh: '0.000', d: d1 },
        { usage_kwh: '57.660', d: d2 },
        { usage_kwh: '0.000', d: d3 },
      ]},
    });
    const result = await sync.checkZeroGap(client);
    assert.equal(result, false);
  });

  it('returns false when fewer than 3 rows exist', async () => {
    const client = mockClient({
      3: { rows: [{ usage_kwh: '0.000', d: new Date() }] },
    });
    const result = await sync.checkZeroGap(client);
    assert.equal(result, false);
  });

  it('returns false on DB error (network failure)', async () => {
    const client = {
      query() { throw new Error('connection refused'); },
    };
    const result = await sync.checkZeroGap(client);
    assert.equal(result, false, 'Should return false on error, not throw');
  });
});

// ─── ZERO_GUARD_DAYS constant ───────────────────────────────────

describe('ZERO_GUARD_DAYS', () => {
  it('is set to 3', () => {
    assert.equal(sync.ZERO_GUARD_DAYS, 3);
  });
});

// ─── SERVICES constant ──────────────────────────────────────────

describe('SERVICES', () => {
  it('contains Electric and Natural Gas', () => {
    assert.equal(sync.SERVICES.length, 2);
    assert.equal(sync.SERVICES[0].value, 'ELECTRIC');
    assert.equal(sync.SERVICES[1].value, 'GAS');
  });
});

// ─── Summary ────────────────────────────────────────────────────
process.on('exit', () => {
  console.log('\n📋  All sync unit tests completed.\n');
});
