import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Thermostat } from '../types';
import {
  errorMessage,
  holdThermostat,
  resumeThermostat,
  setThermostatMode,
  setThermostatTemperature,
} from '../api/climate';
import {
  actionLabel,
  clampSetpoint,
  currentSetpoint,
  formatTemp,
  isHold,
  modeLabel,
  presetLabel,
  selectablePresets,
  sortedModes,
  unitSymbol,
} from '../utils/thermostat';

// Setpoint taps are batched: each ± restarts this timer and only the final
// value is sent, so tapping + five times is one command, not five.
const SEND_DELAY_MS = 1200;
// Commands return the stored state, which trails the thermostat. Refetch a
// couple of times while the WebSocket ingest catches up, and stop showing the
// "waiting" draft after this long even if the change never shows up.
const REFETCH_AFTER_MS = [2_500, 8_000];
const DRAFT_TIMEOUT_MS = 20_000;

type Draft = { kind: 'single'; value: number } | { kind: 'range'; low: number; high: number };

const ACTION_STYLES: Record<string, string> = {
  cooling: 'border-sky-300/20 bg-sky-300/10 text-sky-300',
  heating: 'border-orange-300/20 bg-orange-300/10 text-orange-300',
  fan: 'border-cyan-300/20 bg-cyan-300/10 text-cyan-300',
  drying: 'border-violet-300/20 bg-violet-300/10 text-violet-300',
};

function draftMatches(draft: Draft, t: Thermostat): boolean {
  const sp = currentSetpoint(t);
  if (draft.kind === 'single') return sp.kind === 'single' && sp.value === draft.value;
  return sp.kind === 'range' && sp.low === draft.low && sp.high === draft.high;
}

function formatUpdated(iso: string | null): string {
  if (!iso) return 'No reading yet';
  const diffMin = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (!Number.isFinite(diffMin)) return 'No reading yet';
  if (diffMin < 1) return 'Updated just now';
  if (diffMin < 60) return `Updated ${diffMin} min ago`;
  const h = Math.round(diffMin / 60);
  return h < 24 ? `Updated ${h} hr ago` : `Updated ${Math.round(h / 24)} d ago`;
}

function StepButton({ label, onClick, disabled }: { label: string; onClick: () => void; disabled: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="flex h-10 w-10 items-center justify-center rounded-xl border border-appborder bg-appinset text-lg font-semibold text-apptext transition-colors hover:border-appborder-hover hover:bg-appinset-strong disabled:cursor-not-allowed disabled:opacity-40"
    >
      {label.startsWith('Lower') ? '−' : '+'}
    </button>
  );
}

function SetpointStepper({
  label,
  value,
  unit,
  onStep,
  disabled,
  readOnly,
}: {
  label: string;
  value: number | null;
  unit: string;
  onStep: (delta: number) => void;
  disabled: boolean;
  readOnly: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-apptext-soft">{label}</span>
      <div className="flex items-center gap-2">
        {!readOnly && <StepButton label={`Lower ${label.toLowerCase()}`} onClick={() => onStep(-1)} disabled={disabled || value == null} />}
        <span className="min-w-[4.5rem] text-center text-2xl font-semibold tabular-nums text-apptext">
          {formatTemp(value)}
          <span className="text-sm text-apptext-muted">{unit}</span>
        </span>
        {!readOnly && <StepButton label={`Raise ${label.toLowerCase()}`} onClick={() => onStep(1)} disabled={disabled || value == null} />}
      </div>
    </div>
  );
}

interface ThermostatCardProps {
  thermostat: Thermostat;
  /** USER/ADMIN can change settings; GUEST sees the card read-only. */
  canControl: boolean;
}

function ThermostatCard({ thermostat: t, canControl }: ThermostatCardProps) {
  const queryClient = useQueryClient();
  const unit = unitSymbol(t.temperatureUnit);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [draftSentAt, setDraftSentAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sendTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refetchTimers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(
    () => () => {
      if (sendTimer.current) clearTimeout(sendTimer.current);
      refetchTimers.current.forEach(clearTimeout);
    },
    [],
  );

  const refetchSoon = useCallback(() => {
    refetchTimers.current.forEach(clearTimeout);
    refetchTimers.current = REFETCH_AFTER_MS.map((ms) =>
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ['thermostats'] });
        queryClient.invalidateQueries({ queryKey: ['thermostat-history'] });
      }, ms),
    );
  }, [queryClient]);

  // Drop the draft once the thermostat reports it, or give up after a while.
  useEffect(() => {
    if (!draft || draftSentAt == null) return;
    if (draftMatches(draft, t)) {
      setDraft(null);
      setDraftSentAt(null);
      return;
    }
    const left = DRAFT_TIMEOUT_MS - (Date.now() - draftSentAt);
    const timer = setTimeout(() => {
      setDraft(null);
      setDraftSentAt(null);
    }, Math.max(0, left));
    return () => clearTimeout(timer);
  }, [draft, draftSentAt, t]);

  const onSettled = {
    onSuccess: () => {
      setError(null);
      refetchSoon();
    },
    onError: (err: unknown) => setError(errorMessage(err, 'The thermostat did not accept that change')),
  };

  const temperature = useMutation({
    mutationFn: (d: Draft) =>
      setThermostatTemperature(t.id, d.kind === 'single' ? { temperature: d.value } : { low: d.low, high: d.high }),
    onSuccess: () => {
      setDraftSentAt(Date.now());
      onSettled.onSuccess();
    },
    onError: (err) => {
      setDraft(null);
      setDraftSentAt(null);
      onSettled.onError(err);
    },
  });
  const mode = useMutation({ mutationFn: (m: string) => setThermostatMode(t.id, m), ...onSettled });
  const hold = useMutation({ mutationFn: (p: string) => holdThermostat(t.id, p), ...onSettled });
  const resume = useMutation({ mutationFn: () => resumeThermostat(t.id), ...onSettled });

  const busy = temperature.isPending || mode.isPending || hold.isPending || resume.isPending;
  const controlsDisabled = !t.available || busy;

  const setpoint = currentSetpoint(t);

  const step = (field: 'value' | 'low' | 'high', delta: number) => {
    let next: Draft;
    if (setpoint.kind === 'single') {
      const base = draft?.kind === 'single' ? draft.value : setpoint.value;
      if (base == null) return;
      next = { kind: 'single', value: clampSetpoint(base + delta, t) };
    } else if (setpoint.kind === 'range') {
      const low = draft?.kind === 'range' ? draft.low : setpoint.low;
      const high = draft?.kind === 'range' ? draft.high : setpoint.high;
      if (low == null || high == null) return;
      next = {
        kind: 'range',
        low: field === 'low' ? clampSetpoint(low + delta, t) : low,
        high: field === 'high' ? clampSetpoint(high + delta, t) : high,
      };
      if (next.low >= next.high) return; // keep heat-to below cool-to
    } else {
      return;
    }
    setError(null);
    setDraft(next);
    setDraftSentAt(null);
    if (sendTimer.current) clearTimeout(sendTimer.current);
    sendTimer.current = setTimeout(() => temperature.mutate(next), SEND_DELAY_MS);
  };

  const shownSingle = draft?.kind === 'single' ? draft.value : setpoint.kind === 'single' ? setpoint.value : null;
  const shownLow = draft?.kind === 'range' ? draft.low : setpoint.kind === 'range' ? setpoint.low : null;
  const shownHigh = draft?.kind === 'range' ? draft.high : setpoint.kind === 'range' ? setpoint.high : null;

  const status = error
    ? null
    : draft && draftSentAt == null
      ? 'Sending shortly…'
      : draft || busy
        ? 'Updating thermostat…'
        : null;

  const presets = selectablePresets(t.presetModes);
  const action = t.available ? t.hvacAction : null;

  return (
    <section
      aria-label={`${t.name} thermostat`}
      className="flex flex-col gap-4 rounded-[24px] border border-appborder bg-appsurface-raised p-5 shadow-[0_10px_28px_var(--appshadow)]"
    >
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-lg font-semibold text-apptext">{t.name}</h3>
          <p className="mt-0.5 text-xs text-apptext-muted">
            {modeLabel(t.hvacMode)}
            {t.presetMode ? ` · ${presetLabel(t.presetMode)}` : ''}
          </p>
        </div>
        {t.available ? (
          <span
            className={`shrink-0 rounded-full border px-2.5 py-1 text-2xs font-semibold ${
              (action && ACTION_STYLES[action]) || 'border-appborder bg-appinset text-apptext-muted'
            }`}
          >
            {actionLabel(action)}
          </span>
        ) : (
          <span className="shrink-0 rounded-full border border-amber-300/20 bg-amber-300/10 px-2.5 py-1 text-2xs font-semibold text-amber-300">
            Unavailable
          </span>
        )}
      </header>

      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-3xs uppercase tracking-[0.18em] text-apptext-muted">Indoor</p>
          <p className="mt-1 text-5xl font-semibold tracking-[-0.04em] tabular-nums text-apptext">
            {formatTemp(t.temperature, 1)}
            <span className="ml-1 text-xl font-medium text-apptext-muted">{unit}</span>
          </p>
        </div>
        <div className="text-right">
          <p className="text-3xs uppercase tracking-[0.18em] text-apptext-muted">Humidity</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-apptext">
            {formatTemp(t.humidity)}
            <span className="text-sm text-apptext-muted">%</span>
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-3 rounded-2xl border border-appborder bg-appinset p-3">
        {setpoint.kind === 'single' && (
          <SetpointStepper
            label={t.hvacMode === 'heat' ? 'Heat to' : 'Cool to'}
            value={shownSingle}
            unit={unit}
            onStep={(d) => step('value', d)}
            disabled={controlsDisabled}
            readOnly={!canControl}
          />
        )}
        {setpoint.kind === 'range' && (
          <>
            <SetpointStepper label="Heat to" value={shownLow} unit={unit} onStep={(d) => step('low', d)} disabled={controlsDisabled} readOnly={!canControl} />
            <SetpointStepper label="Cool to" value={shownHigh} unit={unit} onStep={(d) => step('high', d)} disabled={controlsDisabled} readOnly={!canControl} />
          </>
        )}
        {setpoint.kind === 'none' && (
          <p className="py-2 text-center text-sm text-apptext-muted">
            {t.hvacMode === 'off' ? 'System is off' : 'No setpoint reported'}
          </p>
        )}
        {(status || error) && (
          <p role="status" className={`text-xs ${error ? 'text-rose-300' : 'text-apptext-muted'}`}>
            {error ?? status}
          </p>
        )}
      </div>

      {canControl && t.hvacModes.length > 0 && (
        <div>
          <p className="mb-2 text-3xs uppercase tracking-[0.18em] text-apptext-muted">Mode</p>
          <div className="grid grid-cols-4 gap-2" role="group" aria-label="Mode">
            {sortedModes(t.hvacModes).map((m) => {
              const active = t.hvacMode === m;
              return (
                <button
                  key={m}
                  type="button"
                  aria-pressed={active}
                  disabled={controlsDisabled || active}
                  onClick={() => mode.mutate(m)}
                  className={`rounded-xl border px-2 py-2 text-xs font-semibold transition-colors disabled:cursor-not-allowed ${
                    active
                      ? 'border-appaccent-border bg-appaccent-soft text-apptext'
                      : 'border-appborder bg-appinset text-apptext-soft hover:border-appborder-hover hover:bg-appinset-strong disabled:opacity-40'
                  }`}
                >
                  {modeLabel(m)}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {canControl && (presets.length > 0 || isHold(t.presetMode)) && (
        <div>
          <p className="mb-2 text-3xs uppercase tracking-[0.18em] text-apptext-muted">Hold comfort setting</p>
          <div className="flex flex-wrap gap-2">
            {presets.map((p) => {
              const active = t.presetMode === p;
              return (
                <button
                  key={p}
                  type="button"
                  aria-pressed={active}
                  disabled={controlsDisabled || active}
                  onClick={() => hold.mutate(p)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed ${
                    active
                      ? 'border-appaccent-border bg-appaccent-soft text-apptext'
                      : 'border-appborder bg-appinset text-apptext-soft hover:border-appborder-hover hover:bg-appinset-strong disabled:opacity-40'
                  }`}
                >
                  {presetLabel(p)}
                </button>
              );
            })}
          </div>
          {isHold(t.presetMode) && (
            <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-amber-300/20 bg-amber-300/10 px-3 py-2">
              <span className="text-xs text-amber-300">{presetLabel(t.presetMode)} — schedule paused</span>
              <button
                type="button"
                disabled={controlsDisabled}
                onClick={() => resume.mutate()}
                className="rounded-lg border border-appborder bg-appsurface px-3 py-1 text-xs font-semibold text-apptext transition-colors hover:border-appborder-hover disabled:cursor-not-allowed disabled:opacity-40"
              >
                Resume schedule
              </button>
            </div>
          )}
        </div>
      )}

      {!canControl && isHold(t.presetMode) && (
        <p className="text-xs text-amber-300">{presetLabel(t.presetMode)} — schedule paused</p>
      )}

      <p className="mt-auto text-3xs text-apptext-dim">{formatUpdated(t.updatedAt)}</p>
    </section>
  );
}

export default memo(ThermostatCard);
