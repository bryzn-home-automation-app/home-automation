/**
 * Unit tests for sync-hourly.js — the CoServ Average Usage hourly sync.
 *
 * These cover the pure logic (timezone day bounds, usage-series parsing)
 * without hitting SmartHub, the DB, or the network.
 *
 * Usage:
 *   node --test test/sync-hourly.test.js
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const hourly = require(path.join(__dirname, '..', 'scripts', 'sync-hourly.js'));

// ─── tzOffsetMs ──────────────────────────────────────────────────

describe('tzOffsetMs()', () => {
  it('returns -5h (CDT) for a summer instant in America/Chicago', () => {
    // Aug 7, 2026 is inside DST (UTC-5)
    const offset = hourly.tzOffsetMs(Date.UTC(2026, 7, 7, 12, 0, 0), 'America/Chicago');
    assert.equal(offset, -5 * 60 * 60 * 1000);
  });

  it('returns -6h (CST) for a winter instant in America/Chicago', () => {
    // Jan 15, 2026 is standard time (UTC-6)
    const offset = hourly.tzOffsetMs(Date.UTC(2026, 0, 15, 12, 0, 0), 'America/Chicago');
    assert.equal(offset, -6 * 60 * 60 * 1000);
  });
});

// ─── ctDayBounds ─────────────────────────────────────────────────

describe('ctDayBounds()', () => {
  it('maps a CDT day to its UTC-equivalent boundaries (05:00 → next 04:59)', () => {
    const { startMs, endMs } = hourly.ctDayBounds(8, 7, 2026); // Aug 7, 2026 (CDT)
    assert.equal(startMs, Date.UTC(2026, 7, 7, 5, 0, 0));
    assert.equal(endMs, Date.UTC(2026, 7, 8, 5, 0, 0) - 1);
  });

  it('maps a CST day to its UTC-equivalent boundaries (06:00 → next 05:59)', () => {
    const { startMs, endMs } = hourly.ctDayBounds(1, 15, 2026); // Jan 15, 2026 (CST)
    assert.equal(startMs, Date.UTC(2026, 0, 15, 6, 0, 0));
    assert.equal(endMs, Date.UTC(2026, 0, 16, 6, 0, 0) - 1);
  });
});

// ─── recordsFromUsageData ────────────────────────────────────────

describe('recordsFromUsageData()', () => {
  const rate = 0.1171;

  it('parses am/pm labels into 0-23 hour timestamps', () => {
    const records = hourly.recordsFromUsageData(
      [{ y: 1.31, name: '12am' }, { y: 2.5, name: '1pm' }],
      8, 7, 2026, rate
    );
    assert.equal(records.length, 2);
    assert.equal(records[0].timestamp, '2026-08-07 00:00:00');
    assert.equal(records[0].usageKwh, 1.31);
    assert.equal(records[1].timestamp, '2026-08-07 13:00:00');
    assert.equal(records[1].usageKwh, 2.5);
  });

  it('computes cost from the kWh rate', () => {
    const records = hourly.recordsFromUsageData([{ y: 1.31, name: '12am' }], 8, 7, 2026, rate);
    assert.equal(records[0].cost, 0.15); // 1.31 * 0.1171 ≈ 0.1534 → 0.15
  });

  it('skips null/missing values but keeps explicit zero hours', () => {
    const records = hourly.recordsFromUsageData(
      [
        { y: 1.0, name: '12am' },
        { y: null, name: '1am' },     // null → skip
        { name: '2am' },              // missing y → skip
        { y: 0, name: '3am' },        // explicit zero → keep
      ],
      8, 7, 2026, rate
    );
    assert.equal(records.length, 2);
    assert.equal(records[0].usageKwh, 1);
    assert.equal(records[1].usageKwh, 0);
    assert.equal(records[1].timestamp, '2026-08-07 03:00:00');
  });

  it('skips unparsable hour labels', () => {
    const records = hourly.recordsFromUsageData(
      [{ y: 1.0, name: 'nonsense' }, { y: 1.0, name: '25pm' }],
      8, 7, 2026, rate
    );
    assert.equal(records.length, 0);
  });

  it('returns [] for empty or non-array input', () => {
    assert.deepEqual(hourly.recordsFromUsageData([], 8, 7, 2026, rate), []);
    assert.deepEqual(hourly.recordsFromUsageData(null, 8, 7, 2026, rate), []);
  });
});
