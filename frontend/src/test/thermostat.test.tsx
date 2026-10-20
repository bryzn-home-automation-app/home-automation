import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Thermostat, ThermostatChange, ThermostatReading } from '../types';
import {
  attributionText,
  clampSetpoint,
  currentSetpoint,
  formatWhen,
  isHold,
  modeLabel,
  normalizeRange,
  presetLabel,
  selectablePresets,
  sortedModes,
  statusChip,
} from '../utils/thermostat';
import { buildSeries } from '../components/ThermostatHistoryChart';

vi.mock('../api/climate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/climate')>();
  return {
    ...actual,
    setThermostatTemperature: vi.fn().mockResolvedValue({}),
    setThermostatMode: vi.fn().mockResolvedValue({}),
    holdThermostat: vi.fn().mockResolvedValue({}),
    resumeThermostat: vi.fn().mockResolvedValue({}),
  };
});

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

describe('ThermostatCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });
  afterEach(() => vi.useRealTimers());

  it('shows the live reading, status chip and attribution', () => {
    renderCard({ ...upstairs, lastChange: change({ actor: 'ecobee', by: 'ecobee', byUserId: null }) });
    expect(screen.getByText('Upstairs')).toBeTruthy();
    expect(screen.getByText('72.4')).toBeTruthy();
    expect(screen.getByText('Idle · holding 72°')).toBeTruthy();
    expect(screen.getByText('Cool to')).toBeTruthy();
    expect(screen.getByText(/^Set at ecobee · /)).toBeTruthy();
  });

  it('is view-only for guests', () => {
    renderCard({ ...upstairs, lastChange: change() }, false, null);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('View only')).toBeTruthy();
    expect(screen.getByText(/^Set by Bryan · /)).toBeTruthy();
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
    expect(screen.getByText('Offline — showing the last reading.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Raise Upstairs cool-to temperature' }).getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(screen.getByRole('radio', { name: 'Heat' }));
    expect(climate.setThermostatMode).not.toHaveBeenCalled();
  });
});
