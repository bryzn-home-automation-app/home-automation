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
 * Captures usage and charge totals per service. The gas section's charge lines
 * are also kept (gasLineItems), because the Gas tab shows what each bill paid
 * for: at a few CCF a month most of the gas charge is flat. Electric lines
 * (PCRF/SCRF etc.) are not parsed.
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

// The gas block lists one charge per line between "Current Charges" and its
// "Total Current Charges$X", e.g. "Purchased Gas Factor4 CCF  @ $1.33$5.32".
const GAS_CHARGES_RE =
  /Gas Service\s+Rate:[\s\S]*?\nCurrent Charges\s*\r?\n([\s\S]*?)Total Current Charges\$([\d,.]+)/;
const CHARGE_LINE_RE = /^(.+?)(?:([\d,.]+)\s*CCF\s*@\s*\$([\d.]+))?(-)?\$([\d,.]+)(\s*CR)?$/;

/**
 * The gas section's charge lines, each tagged with what drives it:
 *   usage — priced per CCF (Usage Charge, Purchased Gas Factor)
 *   taxes — taxes and the city franchise fee, a share of the rest
 *   fixed — flat amounts (Customer Charge, rate adjustments, one-time fees)
 * Null when there is no gas section, a line doesn't read, or the lines don't
 * add up to the gas charge, so a template change can't show a wrong split.
 */
function parseGasLineItems(text, gasCharge) {
  const section = text.match(GAS_CHARGES_RE);
  if (!section) return null;
  const items = [];
  for (const raw of section[1].split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(CHARGE_LINE_RE);
    if (!m) return null;
    const [, label, ccf, rate, minus, amount, credit] = m;
    const item = {
      label: label.trim(),
      amount: (minus || credit ? -1 : 1) * num(amount),
      kind: ccf ? 'usage' : /tax|franchise/i.test(label) ? 'taxes' : 'fixed',
    };
    if (ccf) Object.assign(item, { ccf: num(ccf), rate: num(rate) });
    items.push(item);
  }
  const total = num(section[2]);
  const sum = items.reduce((s, i) => s + i.amount, 0);
  if (!items.length || Math.abs(sum - total) > 0.005 || Math.abs(total - gasCharge) > 0.005) return null;
  return items;
}

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
    gasLineItems: parseGasLineItems(text, num(gasCharge)),
    currentCharges: num(currentCharges),
    totalDue: num(totalDue),
  };
}

module.exports = { parseCoservBillText, parseGasLineItems, mmddyyyyToIso, monthNameToIso };
