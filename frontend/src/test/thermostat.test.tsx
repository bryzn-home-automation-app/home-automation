import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Thermostat, ThermostatReading } from '../types';
import {
  clampSetpoint,
  currentSetpoint,
  isHold,
  modeLabel,
  presetLabel,
  selectablePresets,
  sortedModes,
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
};

function renderCard(t: Thermostat, canControl = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ThermostatCard thermostat={t} canControl={canControl} />
    </QueryClientProvider>,
  );
}

describe('thermostat helpers', () => {
  it('labels modes, presets and holds the way ecobee users expect', () => {
    expect(modeLabel('heat_cool')).toBe('Auto');
    expect(modeLabel('cool')).toBe('Cool');
    expect(presetLabel('temp')).toBe('Manual hold');
    expect(presetLabel('away_indefinitely')).toBe('Away (until resumed)');
    expect(presetLabel('some_new_one')).toBe('Some New One');
    expect(isHold('temp')).toBe(true);
    expect(isHold('away_indefinitely')).toBe(true);
    expect(isHold('sleep')).toBe(false);
    expect(selectablePresets(['home', 'temp', 'away'])).toEqual(['home', 'away']);
    expect(sortedModes(['off', 'cool', 'heat_cool', 'heat'])).toEqual(['heat_cool', 'heat', 'cool', 'off']);
  });

  it('picks the setpoint for the current mode', () => {
    expect(currentSetpoint(upstairs)).toEqual({ kind: 'single', value: 72 });
    expect(currentSetpoint({ ...upstairs, hvacMode: 'heat', targetTemperature: null, heatSetpoint: 68 })).toEqual({
      kind: 'single',
      value: 68,
    });
    expect(currentSetpoint({ ...upstairs, hvacMode: 'heat_cool', heatSetpoint: 68, coolSetpoint: 75 })).toEqual({
      kind: 'range',
      low: 68,
      high: 75,
    });
    expect(currentSetpoint({ ...upstairs, hvacMode: 'off' })).toEqual({ kind: 'none' });
  });

  it('clamps setpoints to the thermostat limits in whole degrees', () => {
    expect(clampSetpoint(96, upstairs)).toBe(95);
    expect(clampSetpoint(40, upstairs)).toBe(45);
    expect(clampSetpoint(72.5 + 1, upstairs)).toBe(74);
  });
});

describe('buildSeries', () => {
  const reading = (iso: string, temperature: number, coolSetpoint: number): ThermostatReading => ({
    recordedAt: iso,
    temperature,
    humidity: 50,
    targetTemperature: null,
    heatSetpoint: null,
    coolSetpoint,
    hvacMode: 'cool',
    hvacAction: 'idle',
    presetMode: null,
    source: 'ha-websocket',
  });

  it('extends stored readings to now with the live state', () => {
    const now = Date.parse('2026-10-20T05:00:00Z');
    const pts = buildSeries([reading('2026-10-20T04:00:00Z', 71, 72)], upstairs, now);
    expect(pts).toEqual([
      { t: Date.parse('2026-10-20T04:00:00Z'), temp: 71, setpoint: 72 },
      { t: now, temp: 72.4, setpoint: 72 },
    ]);
  });

  it('adds no live point for an unavailable thermostat', () => {
    expect(buildSeries([], { ...upstairs, available: false })).toEqual([]);
  });
});

describe('ThermostatCard', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.useRealTimers());

  it('shows the live reading and status', () => {
    renderCard(upstairs);
    expect(screen.getByText('Upstairs')).toBeTruthy();
    expect(screen.getByText('72.4')).toBeTruthy();
    expect(screen.getByText('Idle')).toBeTruthy();
    expect(screen.getByText('Cool · Sleep')).toBeTruthy();
    expect(screen.getByText('Cool to')).toBeTruthy();
  });

  it('is read-only for guests', () => {
    renderCard(upstairs, false);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('batches setpoint taps into one command', async () => {
    vi.useFakeTimers();
    renderCard(upstairs);
    const raise = screen.getByRole('button', { name: 'Raise cool to' });
    fireEvent.click(raise);
    fireEvent.click(raise);
    expect(screen.getByText('74')).toBeTruthy();
    expect(climate.setThermostatTemperature).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(1300);
    });
    expect(climate.setThermostatTemperature).toHaveBeenCalledTimes(1);
    expect(climate.setThermostatTemperature).toHaveBeenCalledWith('a1b2', { temperature: 74 });
  });

  it('changes mode', async () => {
    renderCard(upstairs);
    fireEvent.click(screen.getByRole('button', { name: 'Heat' }));
    await waitFor(() => expect(climate.setThermostatMode).toHaveBeenCalledWith('a1b2', 'heat'));
  });

  it('offers Resume schedule during a manual hold', async () => {
    renderCard({ ...upstairs, presetMode: 'temp' });
    expect(screen.getByText('Manual hold — schedule paused')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Resume schedule' }));
    await waitFor(() => expect(climate.resumeThermostat).toHaveBeenCalledWith('a1b2'));
  });

  it('disables controls when the thermostat is unavailable', () => {
    renderCard({ ...upstairs, available: false });
    expect(screen.getByText('Unavailable')).toBeTruthy();
    for (const b of screen.getAllByRole('button')) expect((b as HTMLButtonElement).disabled).toBe(true);
  });
});
