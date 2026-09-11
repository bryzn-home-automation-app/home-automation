/**
 * Unit tests for scripts/water-bill-parser.js — pure text parsing, no network/DB.
 * Fixture is the real pdf-parse output for a sample City of Lewisville water bill
 * (test/fixtures/water-bill-sample.txt), captured via `pdf-parse` against the
 * actual PDF so the regexes are validated against real extraction quirks
 * (labels and values are NOT adjacent in the extracted text).
 *
 * Usage:
 *   node --test test/sync-water-bill.test.js
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { parseWaterBillText, mmddyyyyToIso } = require(path.join(__dirname, '..', 'scripts', 'water-bill-parser.js'));

const fixtureText = fs.readFileSync(
  path.join(__dirname, 'fixtures', 'water-bill-sample.txt'),
  'utf8'
);

describe('mmddyyyyToIso()', () => {
  it('converts MM/DD/YYYY to YYYY-MM-DD', () => {
    assert.equal(mmddyyyyToIso('08/31/2026'), '2026-08-31');
  });
});

describe('parseWaterBillText()', () => {
  it('returns null for text with no matching bill fields', () => {
    assert.equal(parseWaterBillText('not a bill'), null);
  });

  it('returns null for empty/missing text', () => {
    assert.equal(parseWaterBillText(''), null);
    assert.equal(parseWaterBillText(null), null);
  });

  it('parses every field from the sample bill', () => {
    const bill = parseWaterBillText(fixtureText);
    assert.ok(bill, 'expected a parsed bill');
    assert.deepEqual(bill, {
      accountNumber: '060-0003116-003',
      billingPeriodStart: '2026-07-24',
      billingPeriodEnd: '2026-08-19',
      billingDate: '2026-08-31',
      dueDate: '2026-09-25',
      usageThousands: 14700,
      waterCharge: 81.94,
      sewerCharge: 29.29,
      refuseCharge: 14.18,
      taxCharge: 1.17,
      achDiscount: -1.50,
      stormwaterCharge: 6.30,
      totalCurrentCharge: 131.38,
      totalDue: 131.38,
    });
  });

  it('handles a bill with no ACH discount line', () => {
    const noDiscountText = fixtureText.replace('$1.50 ACH Discount(1.50)\n', '');
    const bill = parseWaterBillText(noDiscountText);
    assert.ok(bill, 'expected a parsed bill');
    assert.equal(bill.achDiscount, null);
    assert.equal(bill.stormwaterCharge, 6.30);
    assert.equal(bill.totalDue, 131.38);
  });
});
