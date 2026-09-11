/**
 * Pure text parser for City of Lewisville / Denton County FWSD water bill PDFs.
 *
 * The bill is a fixed template (same labels every month), but pdf-parse's text
 * extraction interleaves the static labels (drawn once) with the per-bill values
 * (inserted separately) — labels and values do NOT sit adjacent in the extracted
 * text. So this does NOT match "LABEL: value" pairs; it matches the values in the
 * fixed positional order they appear in, validated against a real bill via
 * `node --test test/sync-water-bill.test.js`.
 *
 * Known real pdf-parse output shape (see test fixture for the full string):
 *   "...89183501\n3116 HEREFORD DR\n07/24/2026 TO: 08/19/2026\n08/31/2026\n
 *    09/25/2026\nBRYAN NGUYEN...WT160300160300\nWT16030017500014,700\n
 *    Water81.94\nSewer29.29\nRefuse14.18\nTax1.17\n$1.50 ACH Discount(1.50)\n
 *    Stormwater6.30\nTotal Current Charge131.38\nTotal Due131.38\n..."
 */
'use strict';

const ACCOUNT_RE = /(\d{3}-\d{7}-\d{3})/;

// Service period, billing date, and due date appear as 4 consecutive dates in
// that fixed order (no reliable label immediately precedes each one).
const DATES_RE = /(\d{2}\/\d{2}\/\d{4})\s+TO:\s+(\d{2}\/\d{2}\/\d{4})\s*\n(\d{2}\/\d{2}\/\d{4})\s*\n(\d{2}\/\d{2}\/\d{4})/;

// Meter row is "WT" + 6-digit previous read + 6-digit current read + usage
// (comma-grouped), immediately followed by the itemized charges in fixed order.
// The ACH discount line is optional — it only appears on bills that have one.
const CHARGES_RE = /WT\d{12}([\d,]+)\nWater([\d.]+)\nSewer([\d.]+)\nRefuse([\d.]+)\nTax([\d.]+)\n(?:\$[\d.]+ ACH Discount\(([\d.]+)\)\n)?Stormwater([\d.]+)\nTotal Current Charge([\d.]+)\nTotal Due([\d.]+)/;

function mmddyyyyToIso(mmddyyyy) {
  const [m, d, y] = mmddyyyy.split('/');
  return `${y}-${m}-${d}`;
}

const num = (s) => (s == null ? null : parseFloat(s.replace(/,/g, '')));

/**
 * Parse the extracted text of one water bill PDF.
 * Returns null if the bill doesn't match the expected template (so the caller
 * can skip/report it instead of writing garbage data).
 */
function parseWaterBillText(text) {
  if (!text) return null;

  const accountMatch = text.match(ACCOUNT_RE);
  const datesMatch = text.match(DATES_RE);
  const chargesMatch = text.match(CHARGES_RE);
  if (!accountMatch || !datesMatch || !chargesMatch) return null;

  const [, periodStart, periodEnd, billingDate, dueDate] = datesMatch;
  const [
    , usage, water, sewer, refuse, tax, achDiscount, stormwater,
    totalCurrentCharge, totalDue,
  ] = chargesMatch;

  return {
    accountNumber: accountMatch[1],
    billingPeriodStart: mmddyyyyToIso(periodStart),
    billingPeriodEnd: mmddyyyyToIso(periodEnd),
    billingDate: mmddyyyyToIso(billingDate),
    dueDate: mmddyyyyToIso(dueDate),
    usageThousands: num(usage),
    waterCharge: num(water),
    sewerCharge: num(sewer),
    refuseCharge: num(refuse),
    taxCharge: num(tax),
    // Stored negative — it's a discount, not a charge.
    achDiscount: achDiscount == null ? null : -num(achDiscount),
    stormwaterCharge: num(stormwater),
    totalCurrentCharge: num(totalCurrentCharge),
    totalDue: num(totalDue),
  };
}

module.exports = { parseWaterBillText, mmddyyyyToIso };
