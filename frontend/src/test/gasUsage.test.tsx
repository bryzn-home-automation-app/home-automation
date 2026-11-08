import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { CoservBill, GasLineItem } from '../types';
import { billMonth, cycleTemperature, gasCycles, gasPricing, nextGasBill, splitCharges } from '../utils/gasBills';

vi.mock('../api/coservBills', () => ({ fetchCoservBills: vi.fn(), fetchBillPdf: vi.fn() }));
vi.mock('../api/weather', () => ({ fetchWeatherForRange: vi.fn() }));
// jsdom has no IntersectionObserver; render the charts straight away.
vi.mock('../components/DeferredRender', () => ({ default: ({ children }: { children: React.ReactNode }) => children }));

import * as billsApi from '../api/coservBills';
import * as weatherApi from '../api/weather';
import GasUsage from '../pages/GasUsage';

const lines = (fixed: [string, number][], ccf: number, taxes: [string, number][]): GasLineItem[] => [
  ...fixed.map(([label, amount]) => ({ label, amount, kind: 'fixed' as const })),
  { label: 'Usage Charge', amount: Math.round(ccf * 0.1401 * 100) / 100, kind: 'usage', ccf, rate: 0.1401 },
  { label: 'Purchased Gas Factor', amount: Math.round(ccf * 1.33 * 100) / 100, kind: 'usage', ccf, rate: 1.33 },
  ...taxes.map(([label, amount]) => ({ label, amount, kind: 'taxes' as const })),
];

const bill = (id: number, start: string, end: string, billed: string, ccf: number, charge: number, items: GasLineItem[] | null): CoservBill => ({
  id, billingPeriodStart: start, billingPeriodEnd: end, billingDate: billed, dueDate: end,
  electricUsageKwh: 1000, electricCharge: 150, gasUsageCcf: ccf, gasCharge: charge, gasLineItems: items,
  totalDue: 150 + charge, source: 'CoServ SmartHub PDF', sourceProvider: 'coserv-smarthub-bill',
  ingestionBatchId: 'b', processingVersion: '1.1', createdAt: billed,
});

// The household's three real bills (2026), line for line.
const BILLS = [
  bill(2, '2026-07-24', '2026-08-06', '2026-08-13', 1, 31.88, lines(
    [['Customer Charge', 7.8], ['Interim Rate Adjustment', 0.95], ['Initial Gas Meter Read', 19]], 1,
    [['Municipal Franchise Fee', 1.57], ['Gross Receipts Tax', 0.63], ['Sales Tax', 0.46]])),
  bill(1, '2026-08-06', '2026-09-08', '2026-09-11', 4, 28.43, lines(
    [['Customer Charge', 18], ['Interim Rate Adjustment', 2.19]], 4,
    [['Municipal Franchise Fee', 1.4], ['Gross Receipts Tax', 0.56], ['Sales Tax', 0.4]])),
  bill(65, '2026-09-08', '2026-10-07', '2026-10-13', 12, 41.27, lines(
    [['Customer Charge', 18], ['Interim Rate Adjustment', 2.19]], 12,
    [['Municipal Franchise Fee', 2.03], ['Gross Receipts Tax', 0.81], ['Sales Tax', 0.6]])),
];

describe('gas bill math', () => {
  const cycles = gasCycles([BILLS[2], BILLS[0], BILLS[1]]);

  it('turns bills into cycles, oldest first, with days and CCF a day', () => {
    expect(cycles.map((c) => [c.start, c.days, c.ccf])).toEqual([
      ['2026-07-24', 13, 1], ['2026-08-06', 33, 4], ['2026-09-08', 29, 12],
    ]);
    expect(cycles[2].perDay).toBeCloseTo(0.414, 3);
    expect(billMonth(cycles[2])).toBe('Oct ’26');
  });

  it('splits a gas charge into flat charges, gas used, and taxes', () => {
    expect(cycles[2].split).toEqual({ fixed: 20.19, usage: 17.64, taxes: 3.44 });
    expect(cycles[0].split?.fixed).toBe(27.75); // the move-in meter fee is a flat charge
    expect(splitCharges(null)).toBeNull();
  });

  it('works out what a CCF costs and what the bill would be with no gas', () => {
    const pricing = gasPricing(cycles[2])!;
    expect(pricing.perCcf).toBeCloseTo(1.60, 2);
    expect(pricing.withoutGas).toBeCloseTo(22.03, 2);
    expect(gasPricing({ ...cycles[2], split: null, items: null })).toBeNull();
  });

  it('expects the next read a typical cycle after the last, and the bill a typical wait after that', () => {
    // Full cycles average 31 days; reads come 7, 3 and 6 days before the bill.
    expect(nextGasBill(cycles)).toEqual({ read: '2026-11-07', bill: '2026-11-12' });
    expect(nextGasBill([])).toBeNull();
  });

  it("averages the outside temperature over a cycle's own days", () => {
    const day = (date: string, meanTemperature: number) => ({ date, meanTemperature, minTemperature: 0, maxTemperature: 0, precipitation: 0, weatherCode: 0 });
    const days = [day('2026-09-07', 99), day('2026-09-08', 80), day('2026-10-06', 70), day('2026-10-07', 10)];
    expect(cycleTemperature(cycles[2], days)).toBe(75);
    expect(cycleTemperature(cycles[2], [])).toBeNull();
  });

  it('skips bills without gas service', () => {
    expect(gasCycles([{ ...BILLS[0], gasUsageCcf: undefined, gasCharge: undefined }])).toEqual([]);
  });
});

describe('Gas tab', () => {
  beforeEach(() => {
    // jsdom has no matchMedia; the billing history asks whether the screen is wide.
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: false, media: query, onchange: null,
      addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {},
      dispatchEvent: () => false,
    }));
    // Nor ResizeObserver, which the charts' containers watch.
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-11-07T16:00:00Z'));
    vi.mocked(weatherApi.fetchWeatherForRange).mockResolvedValue({ latitude: 0, longitude: 0, current: null, daily: [], hourly: [], aggregation: null });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const renderTab = (bills: CoservBill[]) => {
    vi.mocked(billsApi.fetchCoservBills).mockResolvedValue(bills);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(<QueryClientProvider client={client}><GasUsage /></QueryClientProvider>);
  };
  /** A stat tile, by its label. */
  const tile = async (label: string) =>
    (await screen.findAllByText(label)).map((el) => el.closest('[class*="rounded-[20px]"]')).find(Boolean);

  it('leads with the last bill, the gas used, the flat share, and when the next bill comes', async () => {
    renderTab(BILLS);
    expect(await tile('Last gas bill')).toHaveTextContent('$41.27Sep 8 – Oct 7');
    expect(await tile('Gas used')).toHaveTextContent('12CCF0.41 CCF a day, up from 0.12');
    expect(await tile('Flat charges')).toHaveTextContent('$20.1949% of that bill, however much gas you use');
    expect(await tile('Next bill')).toHaveTextContent('Nov 12Meter read around Nov 7');
  });

  it("lists the last bill's lines and what gas really costs", async () => {
    renderTab(BILLS);
    const card = (await screen.findByRole('heading', { name: 'What the last gas bill paid for' })).closest('section')!;
    expect(within(card).getByText('Customer Charge')).toBeInTheDocument();
    expect(within(card).getByText(/12 CCF × \$1\.33/)).toBeInTheDocument();
    expect(within(card).getByText('$15.96')).toBeInTheDocument();
    expect(card).toHaveTextContent('would still have been about $22.03');
    expect(card).toHaveTextContent('Each CCF added about $1.60, taxes included.');
  });

  it('says the next bill is due any day once its usual date has passed', async () => {
    vi.setSystemTime(new Date('2026-11-14T16:00:00Z'));
    renderTab(BILLS);
    expect(await tile('Next bill')).toHaveTextContent('Any dayUsually here by Nov 12');
  });

  it('still shows totals for bills synced before their lines were kept', async () => {
    renderTab(BILLS.map((b) => ({ ...b, gasLineItems: null })));
    expect(await tile('Flat charges')).toHaveTextContent('—Itemized after the next bill sync');
    expect(await tile('Last gas bill')).toHaveTextContent('$41.27');
    expect(screen.queryByRole('heading', { name: 'What the last gas bill paid for' })).not.toBeInTheDocument();
  });

  it('explains an empty tab', async () => {
    renderTab([]);
    expect(await screen.findByText('No gas bills yet')).toBeInTheDocument();
  });
});
