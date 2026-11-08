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

const { parseCoservBillText, parseGasLineItems, mmddyyyyToIso, monthNameToIso } =
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
      gasLineItems: [
        { label: 'Customer Charge', amount: 18, kind: 'fixed' },
        { label: 'Interim Rate Adjustment', amount: 2.19, kind: 'fixed' },
        { label: 'Usage Charge', amount: 0.56, kind: 'usage', ccf: 4, rate: 0.1401 },
        { label: 'Purchased Gas Factor', amount: 5.32, kind: 'usage', ccf: 4, rate: 1.33 },
        { label: 'Municipal Franchise Fee', amount: 1.4, kind: 'taxes' },
        { label: 'Gross Receipts Tax', amount: 0.56, kind: 'taxes' },
        { label: 'Sales Tax', amount: 0.4, kind: 'taxes' },
      ],
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

describe('parseGasLineItems()', () => {
  // Plain-text swap ($ in a replacement string has special meanings).
  const swap = (text, from, to) => text.split(from).join(to);
  // The first bill after moving in: a part-month customer charge plus a one-time meter fee.
  const moveIn = [
    ['Customer Charge$18.00', 'Customer Charge$7.80'],
    ['Interim Rate Adjustment$2.19', 'Interim Rate Adjustment$0.95\nInitial Gas Meter Read$19.00'],
    ['Total Current Charges$28.43', 'Total Current Charges$35.99'],
  ].reduce((t, [from, to]) => swap(t, from, to), fixtureText);

  it('counts a one-time fee as a flat charge', () => {
    const items = parseGasLineItems(moveIn, 35.99);
    assert.deepEqual(items.find((i) => i.label === 'Initial Gas Meter Read'), { label: 'Initial Gas Meter Read', amount: 19, kind: 'fixed' });
    assert.equal(items.filter((i) => i.kind === 'fixed').length, 3);
  });

  it('reads a credit as a negative amount', () => {
    const text = swap(
      swap(fixtureText, 'Sales Tax$0.40', 'Sales Tax$0.40\nBudget Billing Credit$1.00 CR'),
      'Total Current Charges$28.43', 'Total Current Charges$27.43');
    const items = parseGasLineItems(text, 27.43);
    assert.deepEqual(items.at(-1), { label: 'Budget Billing Credit', amount: -1, kind: 'fixed' });
  });

  it("gives up when the lines don't add up to the gas charge", () => {
    assert.equal(parseGasLineItems(swap(fixtureText, 'Sales Tax$0.40', 'Sales Tax$0.50'), 28.43), null);
    assert.equal(parseGasLineItems(fixtureText, 30), null);
  });

  it("gives up on a line it can't read, or a bill with no gas section", () => {
    assert.equal(parseGasLineItems(swap(fixtureText, 'Sales Tax$0.40', 'Sales Tax$0.40\nSee page 3 for details'), 28.43), null);
    assert.equal(parseGasLineItems(fixtureText.slice(0, fixtureText.indexOf('Gas Service  Rate:')), 28.43), null);
  });
});
