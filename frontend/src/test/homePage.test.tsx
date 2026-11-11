import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

// Home, rendered with its APIs mocked: role gating of the shortcuts, the alert rows' words,
// a failed weather load, the forecast's Week / 24 hours switch, and the forecast dialog.

// Recharts' ResponsiveContainer measures with ResizeObserver, which jsdom lacks.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const state = {
  role: 'USER' as 'ADMIN' | 'USER' | 'GUEST',
  unread: 1,
  weatherFails: false,
  outlookFails: false,
  outlookCalls: 0,
  calls: [] as string[],
};

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    user: { userId: 1, username: 'mai', displayName: 'Mai', role: state.role },
    isAdmin: state.role === 'ADMIN',
    isGuest: state.role === 'GUEST',
  }),
}));

vi.mock('../hooks/useUsageData', () => ({
  useUsageData: () => ({
    electricDaily: { data: [{ date: '2026-11-08', totalKwh: 27.4, readingCount: 24, sourceProvider: 'x' }], isError: false },
    config: { data: { kwhRate: 0.12 } },
  }),
}));

/** Home's calendar day `n` days from now, "YYYY-MM-DD" (the test runs in any zone). */
function homeDay(n: number): string {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const [y, m, d] = today.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

vi.mock('../api/weather', () => ({
  fetchWeatherOutlook: async () => {
    state.outlookCalls++;
    if (state.outlookFails) throw new Error('down');
    return {
      latitude: 33.2, longitude: -97.1,
      days: Array.from({ length: 7 }, (_, i) => ({
        date: homeDay(i), maxTemperature: 60 + i * 2, minTemperature: 40 + i, precipitationProbability: i === 2 ? 80 : 10,
        precipitation: i === 2 ? 0.5 : 0, weatherCode: i === 2 ? 63 : 2, sunrise: `${homeDay(i)}T06:58`, sunset: `${homeDay(i)}T17:26`, windSpeedMax: 12,
      })),
    };
  },
  fetchCurrentWeather: async () => {
    if (state.weatherFails) throw new Error('down');
    const hourly = Array.from({ length: 30 }, (_, i) => {
      const d = new Date(Date.now() + (i - 1) * 3_600_000);
      const p = (x: number) => String(x).padStart(2, '0');
      // Open-Meteo hours are home wall-clock; the test runs in any zone, so build them from the home clock.
      const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' })
        .formatToParts(d).reduce<Record<string, string>>((a, x) => ({ ...a, [x.type]: x.value }), {});
      return {
        time: `${parts.year}-${parts.month}-${parts.day}T${p(Number(parts.hour))}:00`,
        temperature: 60 + i, apparentTemperature: 59 + i, humidity: 50, precipitation: 0,
        precipitationProbability: 10, windSpeed: 5, weatherCode: 2,
      };
    });
    return {
      latitude: 33.2, longitude: -97.1,
      current: { temperature: 67, apparentTemperature: 66, humidity: 50, precipitation: 0, windSpeed: 7, weatherCode: 2 },
      daily: [], hourly, aggregation: null,
    };
  },
}));
vi.mock('../api/climate', () => ({ fetchThermostats: async () => [] }));
vi.mock('../api/maintenance', () => ({
  fetchMaintenanceAnalytics: async () => {
    state.calls.push('maintenance');
    return { openCount: 3, completedCount: 14, lastActivityDate: '2026-11-02' };
  },
}));
vi.mock('../api/notifications', () => ({
  fetchUnreadCount: async () => state.unread,
  fetchNotifications: async () => [
    { id: 1, userId: 1, category: 'ELECTRICAL', severity: 'INFO', title: 'Daily report', message: '', isRead: false, createdAt: '2026-11-09T14:05:00Z' },
  ],
}));
vi.mock('../api/auth', () => ({ fetchGuestSessionCount: async () => 0 }));
vi.mock('../api/roomba', () => ({ fetchRoombaStatus: async () => null, fetchRoombaRuns: async () => [] }));
vi.mock('../api/waterBills', () => ({ fetchWaterBills: async () => [] }));

async function renderHome() {
  const { default: HomeSummary } = await import('../pages/HomeSummary');
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <HomeSummary />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function shortcuts() {
  const panel = screen.getByRole('region', { name: 'Around the house' });
  return within(panel).getAllByRole('link').map((a) => a.querySelector('.fp-row-title')?.textContent);
}

// The page module is imported fresh by the first test; under a full parallel run that can be slow.
describe('Home page', { timeout: 20_000 }, () => {
  beforeEach(() => {
    state.role = 'USER';
    state.unread = 1;
    state.weatherFails = false;
    state.outlookFails = false;
    state.outlookCalls = 0;
    state.calls = [];
    localStorage.clear();
  });

  it("offers a member every page they can open, with words that fit them (B-063, B-064, B-066)", async () => {
    await renderHome();
    await screen.findByText('1 unread alert', { exact: false }, { timeout: 10_000 });
    const titles = shortcuts();
    expect(titles).toEqual(['Utilities', 'Climate', 'Cameras', 'Roomba', 'Reminders', 'Maintenance', 'Guest Wi-Fi', 'People', 'Alerts', 'Profile', "What's new"]);
    expect(screen.getByText('Household members')).toBeInTheDocument();
    expect(screen.queryByText('Admin pages')).toBeNull();
  });

  it("doesn't send a guest to pages that bounce them (B-064)", async () => {
    state.role = 'GUEST';
    await renderHome();
    await screen.findByRole('region', { name: 'Around the house' });
    const titles = shortcuts();
    expect(titles).not.toContain('Maintenance');
    expect(titles).not.toContain('Cameras');
    expect(state.calls).not.toContain('maintenance');
  });

  it('gives an admin the admin pages behind a disclosure', async () => {
    state.role = 'ADMIN';
    await renderHome();
    expect(await screen.findByText('Admin pages')).toBeInTheDocument();
    expect(screen.getByText('Members, roles and approvals')).toBeInTheDocument();
  });

  it('captions alerts in words with a time (B-068)', async () => {
    await renderHome();
    const alerts = await screen.findByRole('region', { name: 'Recent alerts' });
    expect(await within(alerts).findByText(/^Electric · /)).toBeInTheDocument();
    expect(within(alerts).queryByText('ELECTRICAL')).toBeNull();
  });

  it('says all caught up rather than "0 unread alerts"', async () => {
    state.unread = 0;
    await renderHome();
    expect(await screen.findAllByText('All caught up')).not.toHaveLength(0);
  });

  it('says the weather failed instead of dropping it (B-005)', async () => {
    state.weatherFails = true;
    await renderHome();
    expect(await screen.findByText("The weather isn't available right now.")).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('tab', { name: /24 hours/ }));
    expect(await screen.findByText("Couldn't load the forecast")).toBeInTheDocument();
  });

  it('shows the week by default: seven days from today, the summary above them', async () => {
    await renderHome();
    const forecast = await screen.findByRole('region', { name: 'Forecast' });
    expect(within(forecast).getByRole('tab', { name: /Week/ })).toHaveAttribute('aria-selected', 'true');
    expect(within(forecast).getByRole('tab', { name: /24 hours/ })).toHaveAttribute('aria-selected', 'false');
    const list = await within(forecast).findByRole('list', { name: 'Week forecast' });
    const days = within(list).getAllByRole('button');
    expect(days).toHaveLength(7);
    expect(days[0]).toHaveAttribute('aria-current', 'date');
    expect(days[0].textContent).toMatch(/^Today/);
    expect(within(forecast).getByText(/^Warmest .* at 72°, coldest today at 40°\. Rain likely .+\.$/)).toBeInTheDocument();
    expect(within(forecast).queryByRole('list', { name: 'Hourly forecast' })).toBeNull();
  });

  it("shows a day's detail when it is tapped, and hides it on a second tap", async () => {
    await renderHome();
    const list = await screen.findByRole('list', { name: 'Week forecast' });
    const wet = within(list).getAllByRole('button')[2];
    fireEvent.click(wet);
    expect(wet).toHaveAttribute('aria-pressed', 'true');
    const detail = document.getElementById(wet.getAttribute('aria-controls')!)!;
    expect(within(detail).getByText('Sunrise')).toBeInTheDocument();
    expect(within(detail).getByText(/6:58/)).toBeInTheDocument();
    expect(within(detail).getByText(/Up to 12/)).toBeInTheDocument();
    fireEvent.click(wet);
    expect(wet).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByText('Sunrise')).toBeNull();
  });

  it('remembers the 24 hours choice on this device', async () => {
    const first = await renderHome();
    fireEvent.click(await screen.findByRole('tab', { name: /24 hours/ }));
    expect(await screen.findByRole('list', { name: 'Hourly forecast' })).toBeInTheDocument();
    expect(localStorage.getItem('homeos:homeForecastView')).toBe('24h');
    first.unmount();

    await renderHome();
    expect(await screen.findByRole('tab', { name: /24 hours/ })).toHaveAttribute('aria-selected', 'true');
    expect(await screen.findByRole('list', { name: 'Hourly forecast' })).toBeInTheDocument();
  });

  it('falls back to the week for an unknown stored choice', async () => {
    localStorage.setItem('homeos:homeForecastView', 'month');
    await renderHome();
    expect(await screen.findByRole('tab', { name: /Week/ })).toHaveAttribute('aria-selected', 'true');
  });

  it("says the week's forecast failed, with Try again, and keeps the 24 hours working", async () => {
    state.outlookFails = true;
    await renderHome();
    expect(await screen.findByText("Couldn't load the week's forecast")).toBeInTheDocument();
    state.outlookFails = false;
    const calls = state.outlookCalls;
    fireEvent.click(screen.getByRole('button', { name: /Try again/ }));
    expect(await screen.findByRole('list', { name: 'Week forecast' })).toBeInTheDocument();
    expect(state.outlookCalls).toBe(calls + 1);
  });

  it('opens the 24-hour forecast as a dialog', async () => {
    await renderHome();
    fireEvent.click(await screen.findByRole('tab', { name: /24 hours/ }));
    fireEvent.click(await screen.findByRole('button', { name: /All 24 hours/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Next 24 hours' }, { timeout: 5000 });
    expect(within(dialog).getByRole('table', { name: 'Hour by hour' })).toBeInTheDocument();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
