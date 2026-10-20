import { memo, useEffect, useRef, useState } from 'react';
import type { Thermostat } from '../types';
import { useThermostatCommands, type Draft } from '../hooks/useThermostatCommands';
import { FOCUS_RING, SetpointTile, Spinner, type Side } from './ThermostatControls';
import {
  HEAT_COOL_MIN_GAP,
  attributionText,
  clampSetpoint,
  currentSetpoint,
  formatTemp,
  holdLabel,
  isHold,
  isStale,
  limits,
  modeLabel,
  normalizeRange,
  presetLabel,
  selectablePresets,
  sortedModes,
  statusChip,
  unitSymbol,
  updatedText,
  type ChipTone,
} from '../utils/thermostat';

const CHIP_STYLES: Record<ChipTone, { chip: string; dot: string }> = {
  heat: { chip: 'border-orange-300/25 bg-orange-300/10 text-orange-400', dot: 'bg-orange-400' },
  cool: { chip: 'border-sky-300/25 bg-sky-300/10 text-sky-400', dot: 'bg-sky-400' },
  fan: { chip: 'border-cyan-300/25 bg-cyan-300/10 text-cyan-400', dot: 'bg-cyan-400' },
  warn: { chip: 'border-amber-300/25 bg-amber-300/10 text-amber-400', dot: 'bg-amber-400' },
  neutral: { chip: 'border-appborder bg-appinset text-apptext-soft', dot: 'bg-apptext-muted' },
};

/** Active-mode colors: heat orange, cool sky, auto accent, off neutral. */
const MODE_ACTIVE: Record<string, string> = {
  heat: 'border-orange-300/40 bg-orange-300/15 text-orange-400',
  cool: 'border-sky-300/40 bg-sky-300/15 text-sky-400',
  heat_cool: 'border-appaccent-border bg-appaccent-soft text-apptext',
  off: 'border-appborder-hover bg-appinset-strong text-apptext',
};

const HOLD_HINT_KEY = 'climate.holdHintSeen';
function holdHintSeen(): boolean {
  try {
    return localStorage.getItem(HOLD_HINT_KEY) === '1';
  } catch {
    return true;
  }
}
function markHoldHintSeen() {
  try {
    localStorage.setItem(HOLD_HINT_KEY, '1');
  } catch {
    /* private mode etc. — the hint just shows again */
  }
}

interface ThermostatCardProps {
  thermostat: Thermostat;
  /** USER/ADMIN can change settings; GUEST sees the card read-only. */
  canControl: boolean;
  /** Logged-in user, so their own changes read "Set by you". */
  currentUserId?: number | null;
}

function ThermostatCard({ thermostat: t, canControl, currentUserId }: ThermostatCardProps) {
  const cmd = useThermostatCommands(t);
  const unit = unitSymbol(t.temperatureUnit);
  const [hint, setHint] = useState<string | null>(null);
  const [flash, setFlash] = useState<Side | null>(null);
  const [confirmOff, setConfirmOff] = useState(false);
  const [showHoldHint, setShowHoldHint] = useState(() => !holdHintSeen());
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const offTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
      if (offTimer.current) clearTimeout(offTimer.current);
    },
    [],
  );
  // The gap/limit hint belongs to the draft it explains.
  useEffect(() => {
    if (!cmd.draft) setHint(null);
  }, [cmd.draft]);

  const disabled = !t.available || cmd.busy;
  const setpoint = currentSetpoint(t);
  const lim = limits(t);
  const draft = cmd.draft;

  const shownSingle = draft?.kind === 'single' ? draft.value : setpoint.kind === 'single' ? setpoint.value : null;
  const shownLow = draft?.kind === 'range' ? draft.low : setpoint.kind === 'range' ? setpoint.low : null;
  const shownHigh = draft?.kind === 'range' ? draft.high : setpoint.kind === 'range' ? setpoint.high : null;

  const queue = (d: Draft) => {
    if (showHoldHint) {
      markHoldHintSeen();
      setShowHoldHint(false);
    }
    cmd.queueDraft(d);
  };

  const stepSingle = (delta: number) => {
    if (shownSingle == null) return;
    const next = clampSetpoint(shownSingle + delta, t);
    if (next === shownSingle) return;
    setHint(null);
    queue({ kind: 'single', value: next });
  };

  const stepRange = (field: 'low' | 'high', delta: number) => {
    if (shownLow == null || shownHigh == null) return;
    const r = normalizeRange(shownLow, shownHigh, field, delta, HEAT_COOL_MIN_GAP, lim);
    if (r.blocked) {
      setHint(
        field === 'low'
          ? `Can't go higher — cool-to is at the ${lim.max}° limit.`
          : `Can't go lower — heat-to is at the ${lim.min}° limit.`,
      );
      return;
    }
    if (r.pushed) {
      const side: Side = r.pushed === 'high' ? 'cool' : 'heat';
      setHint(
        side === 'cool'
          ? `Cool to moved to ${r.high}° to keep a ${HEAT_COOL_MIN_GAP}° gap.`
          : `Heat to moved to ${r.low}° to keep a ${HEAT_COOL_MIN_GAP}° gap.`,
      );
      setFlash(side);
      if (flashTimer.current) clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setFlash(null), 600);
    } else {
      setHint(null);
    }
    queue({ kind: 'range', low: r.low, high: r.high });
  };

  const onMode = (m: string) => {
    if (m === t.hvacMode || disabled) return;
    if (m === 'off' && !confirmOff) {
      setConfirmOff(true);
      if (offTimer.current) clearTimeout(offTimer.current);
      offTimer.current = setTimeout(() => setConfirmOff(false), 3000);
      return;
    }
    setConfirmOff(false);
    cmd.changeMode(m);
  };

  // One status slot, first match wins.
  let status: { text: string; tone: 'error' | 'warn' | 'muted'; spinner?: boolean; retry?: () => void } | null = null;
  if (cmd.error) status = { text: cmd.error.message, tone: 'error', retry: cmd.error.retry };
  else if (hint && draft) status = { text: hint, tone: 'muted' };
  else if (cmd.debouncing) status = { text: 'Sending in a moment…', tone: 'muted' };
  else if (cmd.waiting) status = { text: 'Updating thermostat…', tone: 'muted', spinner: true };
  else if (hint) status = { text: hint, tone: 'muted' };
  else if (cmd.notice) status = { text: cmd.notice, tone: 'warn' };
  else if (t.lastChange) status = { text: attributionText(t.lastChange, currentUserId), tone: 'muted' };

  const chip = statusChip(t);
  const chipStyle = CHIP_STYLES[chip.tone];
  const presets = selectablePresets(t.presetModes);
  const stale = isStale(t.updatedAt);
  const dim = t.available ? '' : 'opacity-50';

  return (
    <section
      id={`thermostat-${t.id}`}
      aria-label={`${t.name} thermostat`}
      className="flex scroll-mt-4 flex-col gap-4 rounded-[24px] border border-appborder bg-appsurface-raised p-4 shadow-[0_10px_28px_var(--appshadow)] sm:p-5"
    >
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-lg font-semibold text-apptext">{t.name}</h3>
          {!canControl && (
            <p className="mt-0.5 text-xs text-apptext-muted">
              {modeLabel(t.hvacMode)}
              {t.presetMode ? ` · ${presetLabel(t.presetMode)}` : ''}
            </p>
          )}
        </div>
        <span
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-2xs font-semibold ${chipStyle.chip}`}
        >
          <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${chipStyle.dot}`} />
          {chip.text}
        </span>
      </header>

      <div className={`flex items-end justify-between gap-4 ${dim}`}>
        <div>
          <p className="text-3xs uppercase tracking-[0.18em] text-apptext-muted">Indoor</p>
          <p className="mt-1 text-5xl font-semibold tracking-[-0.04em] tabular-nums text-apptext">
            {formatTemp(t.temperature, 1)}
            <span className="ml-1 text-xl font-medium text-apptext-muted">{unit}</span>
          </p>
        </div>
        <div className="text-right">
          <p className="text-3xs uppercase tracking-[0.18em] text-apptext-muted">Humidity</p>
          <p className="mt-1 text-xl font-semibold tabular-nums text-apptext">
            {formatTemp(t.humidity)}
            <span className="text-sm text-apptext-muted">%</span>
          </p>
        </div>
      </div>

      {!t.available && <p className="text-xs text-amber-400">Offline — showing the last reading.</p>}

      <div className={dim}>
        {setpoint.kind === 'none' ? (
          <p className="rounded-2xl border border-appborder bg-appinset py-4 text-center text-sm text-apptext-muted">
            {t.hvacMode === 'off' ? 'System is off' : 'No setpoint reported'}
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {setpoint.kind === 'range' ? (
              <>
                <SetpointTile
                  side="heat" label="Heat to" deviceName={t.name} value={shownLow} unit={unit}
                  pending={draft?.kind === 'range'} flash={flash === 'heat'} readOnly={!canControl}
                  disabled={disabled} onStep={(d) => stepRange('low', d)}
                />
                <SetpointTile
                  side="cool" label="Cool to" deviceName={t.name} value={shownHigh} unit={unit}
                  pending={draft?.kind === 'range'} flash={flash === 'cool'} readOnly={!canControl}
                  disabled={disabled} onStep={(d) => stepRange('high', d)}
                />
              </>
            ) : (
              <SetpointTile
                side={t.hvacMode === 'heat' ? 'heat' : 'cool'}
                label={t.hvacMode === 'heat' ? 'Heat to' : 'Cool to'}
                deviceName={t.name} value={shownSingle} unit={unit} span
                pending={draft?.kind === 'single'} flash={false} readOnly={!canControl}
                disabled={disabled}
                lowerDisabled={shownSingle != null && shownSingle <= lim.min}
                raiseDisabled={shownSingle != null && shownSingle >= lim.max}
                onStep={stepSingle}
              />
            )}
          </div>
        )}

        <div className="mt-2 flex min-h-5 items-center gap-2 text-2xs" role="status">
          {status && (
            <>
              {status.spinner && <Spinner className="text-apptext-muted" />}
              <span
                className={
                  status.tone === 'error' ? 'text-rose-400' : status.tone === 'warn' ? 'text-amber-400' : 'text-apptext-muted'
                }
              >
                {status.text}
              </span>
              {status.retry && (
                <button
                  type="button"
                  onClick={status.retry}
                  className={`font-semibold text-rose-400 underline underline-offset-2 ${FOCUS_RING}`}
                >
                  Retry
                </button>
              )}
            </>
          )}
        </div>
        <span className="sr-only" aria-live="polite">{cmd.announce}</span>
        {canControl && showHoldHint && !isHold(t.presetMode) && setpoint.kind !== 'none' && (
          <p className="mt-1 text-2xs text-apptext-dim">Changing the temperature pauses the schedule until you resume.</p>
        )}
      </div>

      {canControl && t.hvacModes.length > 0 && (
        <div>
          <p className="mb-2 text-3xs uppercase tracking-[0.18em] text-apptext-muted">Mode</p>
          <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label={`${t.name} mode`}>
            {sortedModes(t.hvacModes).map((m) => {
              const active = t.hvacMode === m;
              const pending = cmd.pendingMode === m;
              const confirming = m === 'off' && confirmOff;
              return (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  aria-disabled={active || disabled}
                  onClick={() => onMode(m)}
                  className={`flex h-11 items-center justify-center gap-1.5 rounded-xl border px-1 text-xs font-semibold transition-colors aria-disabled:cursor-default ${FOCUS_RING} ${
                    active
                      ? MODE_ACTIVE[m] ?? MODE_ACTIVE.heat_cool
                      : pending
                        ? `${MODE_ACTIVE[m] ?? MODE_ACTIVE.heat_cool} opacity-60`
                        : confirming
                          ? 'border-rose-300/40 bg-rose-300/10 text-rose-400'
                          : 'border-appborder bg-appinset text-apptext-soft hover:border-appborder-hover hover:bg-appinset-strong'
                  } ${!active && disabled ? 'opacity-40' : ''}`}
                >
                  {pending && <Spinner />}
                  {confirming ? 'Tap to turn off' : modeLabel(m)}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {canControl && (presets.length > 0 || isHold(t.presetMode)) && (
        <div>
          <p className="mb-2 text-3xs uppercase tracking-[0.18em] text-apptext-muted">Comfort</p>
          <div className="flex flex-wrap gap-2">
            {presets.map((p) => {
              const active = t.presetMode === p;
              return (
                <button
                  key={p}
                  type="button"
                  aria-pressed={active}
                  aria-disabled={active || disabled}
                  onClick={() => !active && !disabled && cmd.hold(p)}
                  className={`h-11 rounded-full border px-4 text-xs font-medium transition-colors aria-disabled:cursor-default ${FOCUS_RING} ${
                    active
                      ? 'border-appaccent-border bg-appaccent-soft text-apptext'
                      : 'border-appborder bg-appinset text-apptext-soft hover:border-appborder-hover hover:bg-appinset-strong'
                  } ${!active && disabled ? 'opacity-40' : ''}`}
                >
                  {presetLabel(p)}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {isHold(t.presetMode) && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-appborder bg-appinset px-3 py-2">
          <span className="text-xs text-apptext-soft">
            <span aria-hidden="true">⏸ </span>
            {holdLabel(t.presetMode)} · schedule paused
          </span>
          {canControl && (
            <button
              type="button"
              aria-disabled={disabled}
              onClick={() => !disabled && cmd.resume()}
              className={`h-11 shrink-0 rounded-xl border border-appaccent-border bg-appaccent-soft px-4 text-xs font-semibold text-apptext transition-colors hover:bg-appaccent/20 aria-disabled:opacity-40 ${FOCUS_RING}`}
            >
              Resume schedule
            </button>
          )}
        </div>
      )}

      <div className="mt-auto flex items-center justify-between gap-2 text-3xs">
        <span className={stale ? 'text-amber-400' : 'text-apptext-dim'}>{updatedText(t.updatedAt)}</span>
        {!canControl && <span className="text-apptext-dim">View only</span>}
      </div>
    </section>
  );
}

export default memo(ThermostatCard);
