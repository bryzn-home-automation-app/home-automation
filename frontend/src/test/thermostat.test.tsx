import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { Thermostat, ThermostatChange, ThermostatReading } from '../types';
import {
  activityText,
  attributionText,
  clampSetpoint,
  currentSetpoint,
  formatWhen,
  isHold,
  modeLabel,
  normalizeRange,
  presetLabel,
  recentChangeByOther,
  selectablePresets,
  sortedModes,
  statusChip,
} from '../utils/thermostat';
import { buildSeries, mergeSeries } from '../components/ThermostatHistoryChart';
import { isStale, limits, STALE_AFTER_MS } from '../utils/thermostat';

vi.mock('../api/climate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/climate')>();
  return {
    ...actual,
    setThermostatTemperature: vi.fn().mockResolvedValue({}),
    setThermostatMode: vi.fn().mockResolvedValue({}),
    holdThermostat: vi.fn().mockResolvedValue({}),
    resumeThermostat: vi.fn().mockResolvedValue({}),
    fetchThermostats: vi.fn(),
    fetchThermostatHistory: vi.fn(),
    discoverHomeDevices: vi.fn().mockResolvedValue({}),
  };
});

// The Climate page reads the signed-in person; the card itself does not.
const authState = { role: 'USER' as 'ADMIN' | 'USER' | 'GUEST' };
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    user: { userId: 42, username: 'bryan', displayName: 'Bryan', role: authState.role },
    isAdmin: authState.role === 'ADMIN',
    isGuest: authState.role === 'GUEST',
  }),
}));

// Recharts' ResponsiveContainer measures with ResizeObserver, which jsdom lacks.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

import * as climate from '../api/climate';
import ThermostatCard from '../components/ThermostatCard';

// Shaped like the real Upstairs ecobee as Home Assistant reports it.
const upstairs: Thermostat = {
  id: 'a1b2',
  name: 'Upstairs',
  available: true,
  temperature: 72.4,
  humidity: 53,
  targetTemperature: 72,
  heatSetpoint: null,
  coolSetpoint: 72,
  hvacMode: 'cool',
  hvacAction: 'idle',
  presetMode: 'sleep',
  temperatureUnit: '°F',
  minTemp: 44.6,
  maxTemp: 95,
  hvacModes: ['heat_cool', 'heat', 'cool', 'off'],
  presetModes: ['home', 'sleep', 'away', 'away_indefinitely'],
  updatedAt: new Date().toISOString(),
  lastChange: null,
};

const auto: Thermostat = { ...upstairs, hvacMode: 'heat_cool', targetTemperature: null, heatSetpoint: 70, coolSetpoint: 75 };

const change = (over: Partial<ThermostatChange> = {}): ThermostatChange => ({
  at: new Date().toISOString(),
  actor: 'app',
  by: 'Bryan',
  byUserId: 42,
  fields: ['setpoint'],
  hvacMode: 'cool',
  presetMode: 'temp',
  targetTemperature: 72,
  heatSetpoint: null,
  coolSetpoint: 72,
  ...over,
});

function renderCard(t: Thermostat, canControl = true, currentUserId: number | null = 42) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ThermostatCard thermostat={t} canControl={canControl} currentUserId={currentUserId} />
    </QueryClientProvider>,
  );
}

describe('thermostat helpers', () => {
  it('labels modes, presets and holds the way ecobee users expect', () => {
    expect(modeLabel('heat_cool')).toBe('Auto');
    expect(presetLabel('temp')).toBe('Manual hold');
    expect(presetLabel('away_indefinitely')).toBe('Away until resumed');
    expect(presetLabel('some_new_one')).toBe('Some New One');
    expect(isHold('temp')).toBe(true);
    expect(isHold('sleep')).toBe(false);
    expect(selectablePresets(['home', 'temp', 'away'])).toEqual(['home', 'away']);
    expect(sortedModes(['off', 'cool', 'heat_cool', 'heat'])).toEqual(['heat_cool', 'heat', 'cool', 'off']);
  });

  it('picks the setpoint for the current mode', () => {
    expect(currentSetpoint(upstairs)).toEqual({ kind: 'single', value: 72 });
    expect(currentSetpoint(auto)).toEqual({ kind: 'range', low: 70, high: 75 });
    expect(currentSetpoint({ ...upstairs, hvacMode: 'off' })).toEqual({ kind: 'none' });
  });

  it('clamps setpoints to whole degrees inside the limits', () => {
    expect(clampSetpoint(96, upstairs)).toBe(95);
    expect(clampSetpoint(40, upstairs)).toBe(45);
  });

  it('pushes the other side of an Auto range to keep the gap', () => {
    const lim = { min: 45, max: 95 };
    expect(normalizeRange(70, 75, 'low', 1, 3, lim)).toEqual({ low: 71, high: 75, pushed: null, blocked: false });
    expect(normalizeRange(72, 75, 'low', 1, 3, lim)).toEqual({ low: 73, high: 76, pushed: 'high', blocked: false });
    expect(normalizeRange(70, 73, 'high', -1, 3, lim)).toEqual({ low: 69, high: 72, pushed: 'low', blocked: false });
    // other side can't move past the limit → blocked, unchanged
    expect(normalizeRange(92, 95, 'low', 1, 3, lim)).toEqual({ low: 92, high: 95, pushed: null, blocked: true });
    expect(normalizeRange(45, 48, 'high', -1, 3, lim)).toEqual({ low: 45, high: 48, pushed: null, blocked: true });
    // at its own limit → blocked
    expect(normalizeRange(60, 95, 'high', 1, 3, lim).blocked).toBe(true);
  });

  it('says what the system is doing and toward what', () => {
    expect(statusChip(upstairs)).toEqual({ text: 'Idle · holding 72°', tone: 'neutral' });
    expect(statusChip({ ...upstairs, hvacAction: 'cooling' })).toEqual({ text: 'Cooling to 72°', tone: 'cool' });
    expect(statusChip({ ...auto, hvacAction: 'heating' })).toEqual({ text: 'Heating to 70°', tone: 'heat' });
    expect(statusChip(auto).text).toBe('Idle · 70–75°');
    expect(statusChip({ ...upstairs, hvacMode: 'off' }).text).toBe('System off');
    expect(statusChip({ ...upstairs, available: false })).toEqual({ text: 'Offline', tone: 'warn' });
  });

  it('attributes changes to you, another user, ecobee, or Home Assistant', () => {
    const now = new Date('2026-10-20T15:00:00');
    const at = new Date('2026-10-20T14:14:00').toISOString();
    const time = new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    expect(attributionText(change({ at }), 42, now)).toBe(`Set by you · ${time}`);
    expect(attributionText(change({ at }), 7, now)).toBe(`Set by Bryan · ${time}`);
    expect(attributionText(change({ at, actor: 'ecobee', by: 'ecobee', byUserId: null }), 42, now)).toBe(`Set at ecobee · ${time}`);
    expect(attributionText(change({ at, actor: 'home_assistant', by: 'Home Assistant', byUserId: null }), 42, now))
      .toBe(`Set by Home Assistant · ${time}`);
    expect(attributionText(change({ at, actor: 'schedule', by: 'ecobee schedule', byUserId: null }), 42, now))
      .toBe(`Set by schedule · ${time}`);
  });

  it('says who changed which thermostat to what, for the activity log', () => {
    const log = (over: Partial<ThermostatChange>, thermostat = 'Downstairs') =>
      activityText({ thermostatId: 't1', thermostat, change: change(over) });
    expect(log({ actor: 'ecobee', by: 'ecobee', byUserId: null, fields: ['setpoint', 'preset'], targetTemperature: 71 }))
      .toBe('Downstairs set to 71° at the thermostat');
    expect(log({ fields: ['mode', 'setpoint'], hvacMode: 'heat', presetMode: 'home', targetTemperature: 68 }, 'Upstairs'))
      .toBe('Upstairs switched to Heat, 68° by Bryan');
    expect(log({ actor: 'ecobee', by: 'ecobee', fields: ['mode'], hvacMode: 'off', targetTemperature: null }))
      .toBe('Downstairs turned off at the thermostat');
    expect(log({
      actor: 'home_assistant', by: 'Home Assistant', fields: ['preset', 'setpoint'], presetMode: 'away_indefinitely', targetTemperature: 78,
    })).toBe('Downstairs switched to Away until resumed, 78° in Home Assistant');
    expect(log({ fields: ['setpoint'], hvacMode: 'heat_cool', targetTemperature: null, heatSetpoint: 68, coolSetpoint: 75 }))
      .toBe('Downstairs set to 68–75° by Bryan');
  });

  it('formats when: time today, Yesterday, weekday, then date', () => {
    const now = new Date('2026-10-20T15:00:00');
    expect(formatWhen(new Date('2026-10-19T21:02:00').toISOString(), now)).toMatch(/^Yesterday /);
    expect(formatWhen(new Date('2026-10-01T09:00:00').toISOString(), now)).not.toMatch(/:/);
  });
});

describe('buildSeries', () => {
  const reading = (iso: string, over: Partial<ThermostatReading>): ThermostatReading => ({
    recordedAt: iso,
    temperature: 71,
    humidity: 50,
    targetTemperature: null,
    heatSetpoint: null,
    coolSetpoint: null,
    hvacMode: 'cool',
    hvacAction: 'idle',
    presetMode: null,
    source: 'ha_websocket',
    ...over,
  });

  it('splits setpoints into heat and cool sides and extends to now', () => {
    const now = Date.parse('2026-10-20T05:00:00Z');
    const pts = buildSeries(
      [
        reading('2026-10-20T03:00:00Z', { targetTemperature: 72, coolSetpoint: 72 }),
        reading('2026-10-20T04:00:00Z', { hvacMode: 'heat_cool', heatSetpoint: 68, coolSetpoint: 75 }),
      ],
      auto,
      now,
    );
    expect(pts).toEqual([
      { t: Date.parse('2026-10-20T03:00:00Z'), temp: 71, heat: null, cool: 72 },
      { t: Date.parse('2026-10-20T04:00:00Z'), temp: 71, heat: 68, cool: 75 },
      { t: now, temp: 72.4, heat: 70, cool: 75 },
    ]);
  });

  it('adds no live point for an unavailable thermostat', () => {
    expect(buildSeries([], { ...upstairs, available: false })).toEqual([]);
  });
});

describe('mergeSeries', () => {
  it('puts every thermostat on one time axis: temperatures interpolated, setpoints held', () => {
    const a = [
      { t: 0, temp: 70, heat: 68, cool: 75 },
      { t: 100, temp: 72, heat: 69, cool: 75 },
    ];
    const b = [
      { t: 50, temp: 65, heat: 66, cool: null },
      { t: 150, temp: 66, heat: 66, cool: null },
    ];
    expect(mergeSeries([a, b])).toEqual([
      { t: 0, temp0: 70, heat0: 68, cool0: 75, temp1: null, heat1: null, cool1: null },
      { t: 50, temp0: 71, heat0: 68, cool0: 75, temp1: 65, heat1: 66, cool1: null },
      { t: 100, temp0: 72, heat0: 69, cool0: 75, temp1: 65.5, heat1: 66, cool1: null },
      { t: 150, temp0: null, heat0: null, cool0: null, temp1: 66, heat1: 66, cool1: null },
    ]);
  });

  it('leaves a thermostat with no readings empty', () => {
    expect(mergeSeries([[{ t: 5, temp: 70, heat: null, cool: null }], []])).toEqual([
      { t: 5, temp0: 70, heat0: null, cool0: null, temp1: null, heat1: null, cool1: null },
    ]);
  });
});

describe('ThermostatCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });
  afterEach(() => vi.useRealTimers());

  it('shows the live reading, status chip and attribution', () => {
    renderCard({ ...upstairs, lastChange: change({ actor: 'ecobee', by: 'ecobee', byUserId: null }) });
    expect(screen.getByText('Upstairs')).toBeTruthy();
    expect(screen.getByRole('img', { name: /^Upstairs is 72\.4 degrees/ })).toBeTruthy();
    expect(screen.getByText('Idle · holding 72°')).toBeTruthy();
    expect(screen.getByText('72° and holding.')).toBeTruthy();
    expect(screen.getByText('Cool to')).toBeTruthy();
    expect(screen.getByText('Set at the thermostat')).toBeTruthy();
  });

  it('is view-only for guests', () => {
    renderCard({ ...upstairs, lastChange: change() }, false, null);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('View only')).toBeTruthy();
    expect(screen.getByText('Set by Bryan')).toBeTruthy();
  });

  it('batches setpoint taps into one command', async () => {
    vi.useFakeTimers();
    renderCard(upstairs);
    const raise = screen.getByRole('button', { name: 'Raise Upstairs cool-to temperature' });
    fireEvent.click(raise);
    fireEvent.click(raise);
    expect(screen.getByText('74')).toBeTruthy();
    expect(screen.getByText('Sending in a moment…')).toBeTruthy();
    expect(climate.setThermostatTemperature).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(1300);
    });
    expect(climate.setThermostatTemperature).toHaveBeenCalledTimes(1);
    expect(climate.setThermostatTemperature).toHaveBeenCalledWith('a1b2', { temperature: 74 });
  });

  it('sends a queued setpoint immediately when the card unmounts', async () => {
    vi.useFakeTimers();
    const { unmount } = renderCard(upstairs);
    fireEvent.click(screen.getByRole('button', { name: 'Raise Upstairs cool-to temperature' }));
    expect(climate.setThermostatTemperature).not.toHaveBeenCalled();
    unmount();
    expect(climate.setThermostatTemperature).toHaveBeenCalledTimes(1);
    expect(climate.setThermostatTemperature).toHaveBeenCalledWith('a1b2', { temperature: 73 });
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(climate.setThermostatTemperature).toHaveBeenCalledTimes(1); // the timer did not send it twice
  });

  it('pushes cool-to up in Auto and sends both setpoints together', async () => {
    vi.useFakeTimers();
    renderCard({ ...auto, heatSetpoint: 72, coolSetpoint: 75 });
    fireEvent.click(screen.getByRole('button', { name: 'Raise Upstairs heat-to temperature' }));
    expect(screen.getByText('Cool to moved to 76° to keep a 3° gap.')).toBeTruthy();
    await act(async () => {
      vi.advanceTimersByTime(1300);
    });
    expect(climate.setThermostatTemperature).toHaveBeenCalledWith('a1b2', { low: 73, high: 76 });
  });

  it('asks for a second tap before turning the system off', async () => {
    renderCard(upstairs);
    fireEvent.click(screen.getByRole('radio', { name: 'Off' }));
    expect(climate.setThermostatMode).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('radio', { name: 'Tap to turn off' }));
    await waitFor(() => expect(climate.setThermostatMode).toHaveBeenCalledWith('a1b2', 'off'));
  });

  it('changes mode with one tap otherwise', async () => {
    renderCard(upstairs);
    expect(screen.getByRole('radio', { name: 'Cool' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByRole('radio', { name: 'Heat' }));
    await waitFor(() => expect(climate.setThermostatMode).toHaveBeenCalledWith('a1b2', 'heat'));
  });

  it('offers Resume schedule during a manual hold', async () => {
    renderCard({ ...upstairs, presetMode: 'temp' });
    expect(screen.getByText(/Manual hold · schedule paused/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Resume schedule' }));
    await waitFor(() => expect(climate.resumeThermostat).toHaveBeenCalledWith('a1b2'));
  });

  it('shows the error with a Retry that resends', async () => {
    vi.mocked(climate.setThermostatMode).mockRejectedValueOnce(new Error('nope'));
    renderCard(upstairs);
    fireEvent.click(screen.getByRole('radio', { name: 'Heat' }));
    const retry = await screen.findByRole('button', { name: 'Retry' });
    expect(screen.getByText('The thermostat did not accept that change')).toBeTruthy();
    fireEvent.click(retry);
    await waitFor(() => expect(climate.setThermostatMode).toHaveBeenCalledTimes(2));
  });

  it('marks controls unavailable when the thermostat is offline', () => {
    renderCard({ ...upstairs, available: false });
    expect(screen.getByText('Offline')).toBeTruthy();
    expect(screen.getByText("Upstairs isn't answering.")).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Raise Upstairs cool-to temperature' }).getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(screen.getByRole('radio', { name: 'Heat' }));
    expect(climate.setThermostatMode).not.toHaveBeenCalled();
  });

  it('marks the key at a limit unavailable on the side that is there (B-105)', () => {
    vi.useFakeTimers();
    // Heat to at the 45° floor: − is marked unavailable and says nothing misleading.
    renderCard({ ...auto, heatSetpoint: 45, coolSetpoint: 75, lastChange: change({ actor: 'schedule', by: 'schedule', byUserId: null }) });
    expect(screen.getByRole('button', { name: 'Lower Upstairs heat-to temperature' }).getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByRole('button', { name: 'Raise Upstairs cool-to temperature' }).getAttribute('aria-disabled')).toBe('false');
  });

  it('a blocked push says which side is at its limit, then clears (B-104, B-105)', async () => {
    vi.useFakeTimers();
    renderCard({ ...auto, heatSetpoint: 90, coolSetpoint: 93, maxTemp: 93 });
    fireEvent.click(screen.getByRole('button', { name: 'Raise Upstairs heat-to temperature' }));
    expect(screen.getByText("Can't go higher: cool to is at the 93° limit.")).toBeTruthy();
    await act(async () => {
      vi.advanceTimersByTime(4_100);
    });
    expect(screen.queryByText(/Can't go higher/)).toBeNull();
  });

  it('holds the mode keys while a temperature is waiting to go out (B-107)', async () => {
    vi.useFakeTimers();
    renderCard(upstairs);
    fireEvent.click(screen.getByRole('button', { name: 'Raise Upstairs cool-to temperature' }));
    const heat = screen.getByRole('radio', { name: 'Heat' }) as HTMLButtonElement;
    expect(heat.disabled).toBe(true);
    fireEvent.click(heat);
    expect(climate.setThermostatMode).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(1300);
    });
    expect(climate.setThermostatTemperature).toHaveBeenCalledWith('a1b2', { temperature: 73 });
  });

  it('the current mode is checked, not dimmed, and the arrow keys move the choice (B-108)', () => {
    renderCard(upstairs);
    const cool = screen.getByRole('radio', { name: 'Cool' });
    expect(cool.getAttribute('aria-disabled')).toBeNull();
    expect(cool.getAttribute('tabindex')).toBe('0');
    expect(screen.getByRole('radio', { name: 'Heat' }).getAttribute('tabindex')).toBe('-1');
  });
});

describe('recent change by someone else', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  // Optional fixed `now`: the pure-function test must measure from the same instant
  // it built the changes at, or a millisecond tick turns "4 minutes" into 3.
  const minsAgo = (m: number, now = Date.now()) => new Date(now - m * 60_000).toISOString();
  const byKim = (m: number, now?: number) => change({ at: minsAgo(m, now), by: 'Kim', byUserId: 7 });

  it('detects only other people within 10 minutes', () => {
    const now = Date.now();
    expect(recentChangeByOther(byKim(4, now), 42, now)).toEqual({ name: 'Kim', ago: '4 minutes ago' });
    expect(recentChangeByOther(byKim(0, now), 42, now)?.ago).toBe('just now');
    expect(recentChangeByOther(byKim(1, now), 42, now)?.ago).toBe('1 minute ago');
    expect(recentChangeByOther(byKim(11, now), 42, now)).toBeNull();
    expect(recentChangeByOther(change({ at: minsAgo(2, now) }), 42, now)).toBeNull(); // you
    expect(recentChangeByOther(change({ at: minsAgo(2, now), actor: 'ecobee', byUserId: null }), 42, now)).toBeNull();
    expect(recentChangeByOther(null, 42, now)).toBeNull();
  });

  it('asks before overriding, then runs the tapped action once confirmed', async () => {
    renderCard({ ...upstairs, lastChange: byKim(4) });
    fireEvent.click(screen.getByRole('radio', { name: 'Heat' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Change Upstairs?' });
    expect(dialog.textContent).toContain('Kim changed the Upstairs thermostat 4 minutes ago');
    expect(climate.setThermostatMode).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Change anyway' }));
    await waitFor(() => expect(climate.setThermostatMode).toHaveBeenCalledWith('a1b2', 'heat'));
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('does not ask twice for the same change', () => {
    vi.useFakeTimers();
    renderCard({ ...upstairs, lastChange: byKim(4) });
    const raise = screen.getByRole('button', { name: 'Raise Upstairs cool-to temperature' });
    fireEvent.click(raise);
    fireEvent.click(screen.getByRole('button', { name: 'Change anyway' }));
    expect(screen.getByText('73')).toBeTruthy();
    fireEvent.click(raise);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByText('74')).toBeTruthy();
    vi.useRealTimers();
  });

  it('Cancel leaves the thermostat alone', () => {
    renderCard({ ...upstairs, presetMode: 'temp', lastChange: byKim(2) });
    fireEvent.click(screen.getByRole('button', { name: 'Resume schedule' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(climate.resumeThermostat).not.toHaveBeenCalled();
  });

  it('confirming Off in the popup skips the second-tap confirmation', async () => {
    renderCard({ ...upstairs, lastChange: byKim(3) });
    fireEvent.click(screen.getByRole('radio', { name: 'Off' }));
    fireEvent.click(screen.getByRole('button', { name: 'Change anyway' }));
    await waitFor(() => expect(climate.setThermostatMode).toHaveBeenCalledWith('a1b2', 'off'));
  });

  it('no popup for your own change or an older one', async () => {
    renderCard({ ...upstairs, lastChange: byKim(12) });
    fireEvent.click(screen.getByRole('radio', { name: 'Heat' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    await waitFor(() => expect(climate.setThermostatMode).toHaveBeenCalledWith('a1b2', 'heat'));
  });
});

describe('review fixes', () => {
  it('a steady reading between 15-min snapshots is not stale', () => {
    const now = Date.now();
    expect(isStale(new Date(now - 16 * 60_000).toISOString(), now)).toBe(false);
    expect(isStale(new Date(now - STALE_AFTER_MS - 60_000).toISOString(), now)).toBe(true);
  });

  it('falls back to the same 45–92°F limits as the backend', () => {
    expect(limits({ minTemp: null, maxTemp: null })).toEqual({ min: 45, max: 92 });
  });

  it("treats HA's 'auto' mode as a heat/cool range", () => {
    expect(currentSetpoint({ ...upstairs, hvacMode: 'auto', heatSetpoint: 68, coolSetpoint: 75 })).toEqual({
      kind: 'range',
      low: 68,
      high: 75,
    });
  });
});

describe('Climate page: every thermostat side by side', { timeout: 20_000 }, () => {
  const downstairs: Thermostat = {
    ...auto,
    id: 'd0wn',
    name: 'Downstairs',
    temperature: 71.2,
    heatSetpoint: 68,
    coolSetpoint: 75,
    presetMode: 'home',
  };
  const up: Thermostat = { ...upstairs, temperature: 69.4 };
  const readings = (temp: number): ThermostatReading[] => [
    {
      recordedAt: new Date(Date.now() - 3 * 3_600_000).toISOString(),
      temperature: temp,
      humidity: 50,
      targetTemperature: 72,
      heatSetpoint: null,
      coolSetpoint: 72,
      hvacMode: 'cool',
      hvacAction: 'idle',
      presetMode: null,
      source: 'ha_websocket',
    },
  ];
  let failUpstairsHistory = false;

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    authState.role = 'USER';
    failUpstairsHistory = false;
    vi.mocked(climate.fetchThermostats).mockResolvedValue([downstairs, up]);
    vi.mocked(climate.fetchThermostatHistory).mockImplementation(async (id: string) => {
      if (id === up.id && failUpstairsHistory) throw new Error('history down');
      return readings(id === up.id ? 69 : 71);
    });
  });
  afterEach(() => vi.useRealTimers());

  async function mountClimate(path = '/climate') {
    const { default: Climate } = await import('../pages/Climate');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[path]}>
          <Climate />
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  async function renderClimate(path = '/climate') {
    await mountClimate(path);
    return {
      down: await screen.findByRole('region', { name: 'Downstairs' }, { timeout: 10_000 }),
      up: screen.getByRole('region', { name: 'Upstairs' }),
    };
  }

  it('shows every thermostat at once, each headed by its name, with no tabs', async () => {
    const { down, up: upPanel } = await renderClimate();
    expect(screen.queryByRole('tablist')).toBeNull();
    expect(within(down).getByRole('heading', { name: 'Downstairs' })).toBeTruthy();
    expect(within(down).getByText('Idle · 68–75°')).toBeTruthy();
    expect(within(down).getByText('71° and comfortable.')).toBeTruthy();
    expect(within(upPanel).getByRole('heading', { name: 'Upstairs' })).toBeTruthy();
    expect(within(upPanel).getByText('69° and holding.')).toBeTruthy();
    // Each panel carries its own comfort and mode keys (no separate "Comfort and schedule" panel).
    expect(within(down).getByRole('group', { name: 'Downstairs comfort setting' })).toBeTruthy();
    expect(within(upPanel).getByRole('radiogroup', { name: 'Upstairs mode' })).toBeTruthy();
    expect(screen.queryByText('Comfort and schedule')).toBeNull();
  });

  it("each panel's controls act on its own thermostat only", async () => {
    const { down, up: upPanel } = await renderClimate();
    vi.useFakeTimers();
    fireEvent.click(within(upPanel).getByRole('button', { name: 'Raise Upstairs cool-to temperature' }));
    // Upstairs waits to send; its mode keys hold, Downstairs' stay live.
    expect((within(upPanel).getByRole('radio', { name: 'Heat' }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(down).getByRole('radio', { name: 'Heat' }) as HTMLButtonElement).disabled).toBe(false);
    expect(within(down).queryByText('Sending in a moment…')).toBeNull();
    await act(async () => {
      vi.advanceTimersByTime(1300);
    });
    expect(climate.setThermostatTemperature).toHaveBeenCalledTimes(1);
    expect(climate.setThermostatTemperature).toHaveBeenCalledWith('a1b2', { temperature: 73 });
    vi.useRealTimers();
    fireEvent.click(within(down).getByRole('radio', { name: 'Heat' }));
    await waitFor(() => expect(climate.setThermostatMode).toHaveBeenCalledWith('d0wn', 'heat'));
    expect(climate.setThermostatMode).toHaveBeenCalledTimes(1);
  });

  it("a comfort key holds only its own thermostat", async () => {
    const { down } = await renderClimate();
    fireEvent.click(within(down).getByRole('button', { name: 'Sleep' }));
    await waitFor(() => expect(climate.holdThermostat).toHaveBeenCalledTimes(1));
    expect(vi.mocked(climate.holdThermostat).mock.calls[0][0]).toBe('d0wn');
  });

  it('?thermostat=<id> brings that panel into view and focuses it', async () => {
    const scroll = vi.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scroll;
    try {
      const { up: upPanel } = await renderClimate('/climate?thermostat=a1b2');
      await waitFor(() => expect(document.activeElement).toBe(upPanel));
      expect(scroll).toHaveBeenCalledTimes(1);
      expect(scroll.mock.instances[0]).toBe(upPanel);
      // Both are still on screen: it is a scroll target, not a tab.
      expect(screen.getByRole('region', { name: 'Downstairs' })).toBeTruthy();
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it('draws every thermostat on one history chart, naming each with its temperature now', async () => {
    await renderClimate();
    const panel = screen.getByRole('region', { name: 'Temperature history' });
    await waitFor(() => expect(climate.fetchThermostatHistory).toHaveBeenCalledTimes(2));
    expect(await within(panel).findByText('Downstairs')).toBeTruthy();
    expect(within(panel).getByText('Upstairs')).toBeTruthy();
    expect(within(panel).getByText('71°')).toBeTruthy();
    expect(within(panel).getByText('69°')).toBeTruthy();
    expect(within(panel).queryByText('Heat to')).toBeNull();
    fireEvent.click(within(panel).getByRole('button', { name: 'With setpoints' }));
    expect(within(panel).getByText('Heat to')).toBeTruthy();
    expect(within(panel).getByText('Cool to')).toBeTruthy();
  });

  it("one thermostat's history failing still shows the other, and says which failed", async () => {
    failUpstairsHistory = true;
    await renderClimate();
    const panel = screen.getByRole('region', { name: 'Temperature history' });
    expect(await within(panel).findByText("Couldn't load the Upstairs history.")).toBeTruthy();
    expect(within(panel).getByText('Downstairs')).toBeTruthy();
    expect(within(panel).queryByText('Upstairs')).toBeNull();
    expect(within(panel).queryByText("Couldn't load the history")).toBeNull();
    failUpstairsHistory = false;
    fireEvent.click(within(panel).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(within(panel).queryByText("Couldn't load the Upstairs history.")).toBeNull());
    expect(within(panel).getByText('Upstairs')).toBeTruthy();
  });

  it('both failing is one error for the chart', async () => {
    vi.mocked(climate.fetchThermostatHistory).mockRejectedValue(new Error('down'));
    await renderClimate();
    const panel = screen.getByRole('region', { name: 'Temperature history' });
    expect(await within(panel).findByText("Couldn't load the history")).toBeTruthy();
  });

  it('guests see both thermostats, view only', async () => {
    authState.role = 'GUEST';
    const { down, up: upPanel } = await renderClimate();
    for (const p of [down, upPanel]) {
      expect(within(p).queryByRole('button')).toBeNull();
      expect(within(p).queryByRole('radio')).toBeNull();
      expect(within(p).getByText('View only')).toBeTruthy();
    }
  });

  it("says Home Assistant isn't connected on a 503", async () => {
    vi.mocked(climate.fetchThermostats).mockRejectedValue(
      Object.assign(new Error('Request failed'), { isAxiosError: true, response: { status: 503, data: { error: 'Home Assistant is unavailable' } } }),
    );
    await mountClimate();
    expect(await screen.findByText("Home Assistant isn't connected", {}, { timeout: 10_000 })).toBeTruthy();
  });

  it('offers an admin the search when there are no thermostats', async () => {
    authState.role = 'ADMIN';
    vi.mocked(climate.fetchThermostats).mockResolvedValue([]);
    await mountClimate();
    expect(await screen.findByText('No thermostats yet', {}, { timeout: 10_000 })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Look for thermostats' })).toBeTruthy();
  });
});
