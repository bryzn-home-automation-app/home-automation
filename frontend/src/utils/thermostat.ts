import type { Thermostat } from '../types';

// Presentation helpers for the Climate tab. Kept free of React so they can be
// unit-tested directly (see src/test/thermostat.test.tsx).

const MODE_LABELS: Record<string, string> = {
  heat_cool: 'Auto',
  heat: 'Heat',
  cool: 'Cool',
  off: 'Off',
};

/** Display order for the mode buttons, whatever order HA reports them in. */
const MODE_ORDER = ['heat_cool', 'heat', 'cool', 'off'];

const ACTION_LABELS: Record<string, string> = {
  heating: 'Heating',
  cooling: 'Cooling',
  idle: 'Idle',
  fan: 'Fan only',
  drying: 'Dehumidifying',
  off: 'Off',
};

const PRESET_LABELS: Record<string, string> = {
  home: 'Home',
  away: 'Away',
  sleep: 'Sleep',
  away_indefinitely: 'Away (until resumed)',
  temp: 'Manual hold',
  vacation: 'Vacation',
};

function titleCase(v: string): string {
  return v
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export function modeLabel(mode: string | null | undefined): string {
  if (!mode) return '—';
  return MODE_LABELS[mode] ?? titleCase(mode);
}

export function actionLabel(action: string | null | undefined): string {
  if (!action) return '—';
  return ACTION_LABELS[action] ?? titleCase(action);
}

export function presetLabel(preset: string | null | undefined): string {
  if (!preset) return '—';
  return PRESET_LABELS[preset] ?? titleCase(preset);
}

export function sortedModes(modes: string[]): string[] {
  const rank = (m: string) => {
    const i = MODE_ORDER.indexOf(m);
    return i === -1 ? MODE_ORDER.length : i;
  };
  return [...modes].sort((a, b) => rank(a) - rank(b));
}

/**
 * ecobee reports a manual setpoint change as preset "temp", and an open-ended
 * away as "away_indefinitely" — both are holds the schedule won't undo on its
 * own, so the card offers "Resume schedule" for them.
 */
export function isHold(preset: string | null | undefined): boolean {
  return preset === 'temp' || preset === 'away_indefinitely' || preset === 'vacation';
}

/** Presets a user can pick to hold. "temp" is a state, not a choice. */
export function selectablePresets(presets: string[]): string[] {
  return presets.filter((p) => p !== 'temp');
}

export type Setpoint =
  | { kind: 'single'; value: number | null }
  | { kind: 'range'; low: number | null; high: number | null }
  | { kind: 'none' };

/** What the setpoint control should show for the thermostat's current mode. */
export function currentSetpoint(t: Thermostat): Setpoint {
  switch (t.hvacMode) {
    case 'heat_cool':
      return { kind: 'range', low: t.heatSetpoint, high: t.coolSetpoint };
    case 'heat':
      return { kind: 'single', value: t.targetTemperature ?? t.heatSetpoint };
    case 'cool':
      return { kind: 'single', value: t.targetTemperature ?? t.coolSetpoint };
    default:
      return { kind: 'none' };
  }
}

/** Keep a setpoint within the thermostat's limits; whole degrees for the ± buttons. */
export function clampSetpoint(value: number, t: Pick<Thermostat, 'minTemp' | 'maxTemp'>): number {
  // ecobee reports fractional limits (e.g. 44.6) — round them inward so the
  // result is always a whole degree the thermostat accepts.
  const min = Math.ceil(t.minTemp ?? 45);
  const max = Math.floor(t.maxTemp ?? 95);
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function formatTemp(value: number | null | undefined, digits = 0): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return value.toFixed(digits);
}

export function unitSymbol(unit: string | null | undefined): string {
  return unit ? unit : '°F';
}
