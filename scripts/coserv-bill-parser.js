/**
 * Pure text parser for CoServ SmartHub combined electric+gas bill PDFs.
 *
 * Unlike the water bill's pdf-parse output (see water-bill-parser.js), this
 * bill's text extracts in reading order with labels and values adjacent, so
 * this matches "LABEL...value" pairs directly rather than positional-only
 * matching. The one exception is each service's meter table row, where
 * pdf-parse concatenates the meter number directly against the following
 * date with no separator (e.g. "34675608/06/2026..." for meter 346756 from
 * 08/06/2026) — handled with a non-greedy skip to the first date pattern
 * rather than trying to bound the meter number's digit count.
 *
 * Captures the same category-total granularity as water_bills — usage and
 * charge totals per service, not every individual line item (PCRF/SCRF/PGF
 * etc. are not parsed).
 */
'use strict';

const MONTHS = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

const ACCOUNT_RE = /Account Number(\d+)/;
const BILL_DATE_RE = /Bill Date:\s*([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/;
const SUMMARY_RE =
  /Electric Service\$([\d,.]+)\s+Gas Service\$([\d,.]+)\s+Current Charges\$([\d,.]+)\s+Total Amount Due by (\d{2}\/\d{2}\/\d{4})\$([\d,.]+)/;
const ELECTRIC_USAGE_RE = /Energy Charge([\d,]+)\s*kWh/;
const GAS_USAGE_RE = /Usage Charge([\d,]+)\s*CCF/;
const ELECTRIC_PERIOD_RE =
  /Meter #FromToDaysLast ReadCurrentMult\.kWh\s*\n[\s\S]*?(\d{2}\/\d{2}\/\d{4})(\d{2}\/\d{2}\/\d{4})/;
const GAS_PERIOD_RE =
  /Meter #FromToDaysLast ReadCurrentMult\.CCF\s*\n[\s\S]*?(\d{2}\/\d{2}\/\d{4})(\d{2}\/\d{2}\/\d{4})/;

function mmddyyyyToIso(mmddyyyy) {
  const [m, d, y] = mmddyyyy.split('/');
  return `${y}-${m}-${d}`;
}

function monthNameToIso(monthName, day, year) {
  const m = MONTHS[monthName.toLowerCase()];
  if (!m) return null;
  return `${year}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

const num = (s) => (s == null ? null : parseFloat(s.replace(/,/g, '')));

/**
 * Parse the extracted text of one CoServ combined bill PDF.
 * Returns null if the bill doesn't match the expected template (so the
 * caller can skip/report it instead of writing garbage data).
 */
function parseCoservBillText(text) {
  if (!text) return null;

  const accountMatch = text.match(ACCOUNT_RE);
  const billDateMatch = text.match(BILL_DATE_RE);
  const summaryMatch = text.match(SUMMARY_RE);
  if (!accountMatch || !billDateMatch || !summaryMatch) return null;

  const electricUsageMatch = text.match(ELECTRIC_USAGE_RE);
  const gasUsageMatch = text.match(GAS_USAGE_RE);
  const electricPeriodMatch = text.match(ELECTRIC_PERIOD_RE);
  const gasPeriodMatch = text.match(GAS_PERIOD_RE);

  // Billing period comes from whichever meter table is present; on a
  // combined bill both meters share the same cycle, so either works.
  const periodMatch = electricPeriodMatch || gasPeriodMatch;
  if (!periodMatch) return null;

  const [, electricCharge, gasCharge, currentCharges, dueDate, totalDue] = summaryMatch;
  const [, billMonth, billDay, billYear] = billDateMatch;

  return {
    accountNumber: accountMatch[1],
    billingPeriodStart: mmddyyyyToIso(periodMatch[1]),
    billingPeriodEnd: mmddyyyyToIso(periodMatch[2]),
    billingDate: monthNameToIso(billMonth, billDay, billYear),
    dueDate: mmddyyyyToIso(dueDate),
    electricUsageKwh: electricUsageMatch ? num(electricUsageMatch[1]) : null,
    electricCharge: num(electricCharge),
    gasUsageCcf: gasUsageMatch ? num(gasUsageMatch[1]) : null,
    gasCharge: num(gasCharge),
    currentCharges: num(currentCharges),
    totalDue: num(totalDue),
  };
}

module.exports = { parseCoservBillText, mmddyyyyToIso, monthNameToIso };
