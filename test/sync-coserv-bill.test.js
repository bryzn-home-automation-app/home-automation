/**
 * Unit tests for scripts/coserv-bill-parser.js — pure text parsing, no network/DB.
 * Fixture is the real pdf-parse output for a sample CoServ combined electric+gas
 * bill (test/fixtures/coserv-bill-sample.txt), captured via `pdf-parse` against
 * the actual PDF so the regexes are validated against real extraction output.
 *
 * Usage:
 *   node --test test/sync-coserv-bill.test.js
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { parseCoservBillText, mmddyyyyToIso, monthNameToIso } =
  require(path.join(__dirname, '..', 'scripts', 'coserv-bill-parser.js'));

const fixtureText = fs.readFileSync(
  path.join(__dirname, 'fixtures', 'coserv-bill-sample.txt'),
  'utf8'
);

describe('mmddyyyyToIso()', () => {
  it('converts MM/DD/YYYY to YYYY-MM-DD', () => {
    assert.equal(mmddyyyyToIso('09/28/2026'), '2026-09-28');
  });
});

describe('monthNameToIso()', () => {
  it('converts a full month name + day + year to YYYY-MM-DD', () => {
    assert.equal(monthNameToIso('September', '11', '2026'), '2026-09-11');
  });

  it('pads single-digit days', () => {
    assert.equal(monthNameToIso('March', '5', '2026'), '2026-03-05');
  });

  it('returns null for an unrecognized month name', () => {
    assert.equal(monthNameToIso('Smarch', '5', '2026'), null);
  });
});

describe('parseCoservBillText()', () => {
  it('returns null for text with no matching bill fields', () => {
    assert.equal(parseCoservBillText('not a bill'), null);
  });

  it('returns null for empty/missing text', () => {
    assert.equal(parseCoservBillText(''), null);
    assert.equal(parseCoservBillText(null), null);
  });

  it('parses every field from the sample bill', () => {
    const bill = parseCoservBillText(fixtureText);
    assert.ok(bill, 'expected a parsed bill');
    assert.deepEqual(bill, {
      accountNumber: '9002001851',
      billingPeriodStart: '2026-08-06',
      billingPeriodEnd: '2026-09-08',
      billingDate: '2026-09-11',
      dueDate: '2026-09-28',
      electricUsageKwh: 2087,
      electricCharge: 277.57,
      gasUsageCcf: 4,
      gasCharge: 28.43,
      currentCharges: 306,
      totalDue: 306,
    });
  });

  it('still parses electric/gas charges if the gas meter table is missing (electric-only bill)', () => {
    const gasTableStart = fixtureText.indexOf('Gas Service  Rate:');
    const pageEnd = fixtureText.indexOf('Other Ways to Pay Your Bill');
    const withoutGasTable = fixtureText.slice(0, gasTableStart) + fixtureText.slice(pageEnd);
    const bill = parseCoservBillText(withoutGasTable);
    assert.ok(bill, 'expected a parsed bill');
    assert.equal(bill.billingPeriodStart, '2026-08-06');
    assert.equal(bill.gasUsageCcf, null);
  });
});
