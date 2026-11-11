import { memo, useEffect, useRef, useState } from 'react';
import type { Thermostat, ThermostatChange } from '../types';
import { useThermostatCommands, type Draft } from '../hooks/useThermostatCommands';
import { SetpointTile, Spinner, type Side } from './ThermostatControls';
import ConfirmThermostatChangeModal from './ConfirmThermostatChangeModal';
import {
  Badge,
  Button,
  Dial,
  DialCentre,
  Lamp,
  List,
  Notice,
  Num,
  Panel,
  Readout,
  Readouts,
  Row,
  Seg,
  Verdict,
  cx,
  toneTextClass,
  type DialRing,
  type IconName,
} from './ui';
import { formatRelative, formatStamp } from '../utils/format';
import type { Tone } from '../utils/status';
import {
  HEAT_COOL_MIN_GAP,
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
  recentChangeByOther,
  selectablePresets,
  sortedModes,
  statusChip,
  unitSymbol,
} from '../utils/thermostat';

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

/** A "can't go further" hint clears itself after this long (B-104), so it never hides "Set by …" for the visit. */
export const BLOCKED_HINT_MS = 4_000;

/** The dial's printed scale: 60–85° unless a reading or setpoint falls outside it. */
function dialScale(values: Array<number | null>): { lo: number; hi: number } {
  const v = values.filter((x): x is number => x != null && Number.isFinite(x));
  if (!v.length) return { lo: 60, hi: 85 };
  return {
    lo: Math.min(60, Math.floor((Math.min(...v) - 2) / 5) * 5),
    hi: Math.max(85, Math.ceil((Math.max(...v) + 2) / 5) * 5),
  };
}

/** "2 min ago", "yesterday", "Mon, Nov 9": formatRelative to sit mid-sentence. */
function agoText(at: string | null): string {
  const r = formatRelative(at);
  return /^[A-Z][a-z]{2}, /.test(r) ? r : r.charAt(0).toLowerCase() + r.slice(1);
}

/** Who made the last change, as the row's title. */
export function changeWho(change: ThermostatChange, currentUserId: number | null | undefined): string {
  if (change.actor === 'ecobee') return 'Set at the thermostat';
  if (change.actor === 'schedule') return 'Set by the schedule';
  if (change.actor === 'home_assistant') return 'Set in Home Assistant';
  if (currentUserId != null && change.byUserId === currentUserId) return 'Set by you';
  return `Set by ${change.by}`;
}

const CHANGE_ICON: Record<ThermostatChange['actor'], IconName> = {
  app: 'user',
  schedule: 'calendar',
  ecobee: 'thermometer',
  home_assistant: 'home',
};

/** What the change did: "switched to Heat", "set to 68–75°". */
function changeWhat(c: ThermostatChange): string | null {
  const range = c.hvacMode === 'heat_cool' || c.hvacMode === 'auto';
  const temp = range
    ? c.heatSetpoint != null && c.coolSetpoint != null ? `${formatTemp(c.heatSetpoint)}–${formatTemp(c.coolSetpoint)}°` : null
    : c.targetTemperature != null ? `${formatTemp(c.targetTemperature)}°` : null;
  if (c.fields.includes('mode')) return c.hvacMode === 'off' ? 'turned off' : `switched to ${modeLabel(c.hvacMode)}`;
  if (c.fields.includes('preset') && c.presetMode !== 'temp') return `switched to ${presetLabel(c.presetMode)}`;
  return temp ? `set to ${temp}` : null;
}

/** The thermostat's answer: one sentence and why, from what it reports. */
function verdictFor(t: Thermostat, stale: boolean): { tone: Tone; text: string; note: string } {
  const now = formatTemp(t.temperature);
  const hold = isHold(t.presetMode) ? ' The schedule is paused until someone resumes it.' : '';
  if (!t.available) {
    return { tone: 'headsup', text: `${t.name} isn't answering.`, note: `Showing its last reading, from ${agoText(t.updatedAt)}. Check its Wi-Fi if this lasts.` };
  }
  const staleNote = stale ? ` The last reading came in ${agoText(t.updatedAt)}.` : '';
  const tone: Tone = stale ? 'headsup' : 'ok';
  if (t.hvacMode === 'off') {
    return { tone: stale ? 'headsup' : 'neutral', text: `${now}° with the system off.`, note: `Nothing heats or cools until someone picks a mode.${staleNote}` };
  }
  const sp = currentSetpoint(t);
  if (t.hvacAction === 'heating') {
    const to = sp.kind === 'range' ? sp.low : sp.kind === 'single' ? sp.value : null;
    return { tone, text: `${now}° and warming up${to != null ? ` to ${formatTemp(to)}°` : ''}.`, note: `The heat stays on until it gets there.${hold}${staleNote}` };
  }
  if (t.hvacAction === 'cooling') {
    const to = sp.kind === 'range' ? sp.high : sp.kind === 'single' ? sp.value : null;
    return { tone, text: `${now}° and cooling down${to != null ? ` to ${formatTemp(to)}°` : ''}.`, note: `The air conditioning stays on until it gets there.${hold}${staleNote}` };
  }
  if (sp.kind === 'range' && sp.low != null && sp.high != null) {
    return {
      tone,
      text: `${now}° and comfortable.`,
      note: `Auto keeps it between ${formatTemp(sp.low)}° and ${formatTemp(sp.high)}°, so nothing is running right now.${hold}${staleNote}`,
    };
  }
  if (sp.kind === 'single' && sp.value != null) {
    return {
      tone,
      text: `${now}° and holding.`,
      note: `${modeLabel(t.hvacMode)} is set to ${formatTemp(sp.value)}°, so nothing is running right now.${hold}${staleNote}`,
    };
  }
  return { tone, text: `${now}° inside.`, note: `${statusChip(t).text}.${hold}${staleNote}` };
}

interface ThermostatCardProps {
  thermostat: Thermostat;
  /** USER/ADMIN can change settings; GUEST sees the card read-only. */
  canControl: boolean;
  /** Logged-in user, so their own changes read "Set by you". */
  currentUserId?: number | null;
  className?: string;
}

/** The id of a thermostat's panel: ?thermostat=<id> scrolls to it. */
export function thermostatPanelId(id: string): string {
  return `climate-thermostat-${id}`;
}

/**
 * One thermostat, self-contained, in its own panel headed by its name and status: the dial
 * (indoor temperature, the heat and cool setpoints as marks, − / + keys under it) and the mode
 * keys, then the verdict, humidity and schedule, the comfort settings and any hold, and who
 * changed it last. Every control acts on this thermostat only; the page shows one per
 * thermostat, side by side.
 */
function ThermostatCard({ thermostat: t, canControl, currentUserId, className }: ThermostatCardProps) {
  const cmd = useThermostatCommands(t);
  const unit = unitSymbol(t.temperatureUnit);
  const [hint, setHint] = useState<string | null>(null);
  const [blockedHint, setBlockedHint] = useState<string | null>(null);
  const [flash, setFlash] = useState<Side | null>(null);
  const [confirmOff, setConfirmOff] = useState(false);
  const [showHoldHint, setShowHoldHint] = useState(() => !holdHintSeen());
  const [pendingAction, setPendingAction] = useState<(() => void) | null>(null);
  const [acknowledgedAt, setAcknowledgedAt] = useState<string | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const offTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const blockedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (flashTimer.current) clearTimeout(flashTimer.current);
      if (offTimer.current) clearTimeout(offTimer.current);
      if (blockedTimer.current) clearTimeout(blockedTimer.current);
    },
    [],
  );
  // The gap hint belongs to the draft it explains.
  useEffect(() => {
    if (!cmd.draft) setHint(null);
  }, [cmd.draft]);

  const disabled = !t.available || cmd.busy;
  // B-107: a mode, comfort or resume tap while ± is still batching would be overtaken by the
  // queued temperature a moment later, so those keys wait the ~1 s until it has gone out.
  const settingsLocked = disabled || cmd.debouncing;
  const setpoint = currentSetpoint(t);
  const lim = limits(t);
  const draft = cmd.draft;

  const shownSingle = draft?.kind === 'single' ? draft.value : setpoint.kind === 'single' ? setpoint.value : null;
  const shownLow = draft?.kind === 'range' ? draft.low : setpoint.kind === 'range' ? setpoint.low : null;
  const shownHigh = draft?.kind === 'range' ? draft.high : setpoint.kind === 'range' ? setpoint.high : null;

  const showBlocked = (text: string) => {
    setBlockedHint(text);
    if (blockedTimer.current) clearTimeout(blockedTimer.current);
    blockedTimer.current = setTimeout(() => setBlockedHint(null), BLOCKED_HINT_MS);
  };
  const clearBlocked = () => {
    if (blockedTimer.current) clearTimeout(blockedTimer.current);
    setBlockedHint(null);
  };

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
    clearBlocked();
    queue({ kind: 'single', value: next });
  };

  const stepRange = (field: 'low' | 'high', delta: number) => {
    if (shownLow == null || shownHigh == null) return;
    const r = normalizeRange(shownLow, shownHigh, field, delta, HEAT_COOL_MIN_GAP, lim);
    if (r.blocked) {
      // B-105: name the side that was tapped when it is the one at its limit; only a push the
      // other side can't make blames the other side.
      if (field === 'low' && delta < 0) showBlocked(`Heat to can't go below ${lim.min}°.`);
      else if (field === 'high' && delta > 0) showBlocked(`Cool to can't go above ${lim.max}°.`);
      else if (field === 'low') showBlocked(`Can't go higher: cool to is at the ${lim.max}° limit.`);
      else showBlocked(`Can't go lower: heat to is at the ${lim.min}° limit.`);
      return;
    }
    clearBlocked();
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

  // Ask before overriding another household member's change from the last
  // 10 minutes — once per change: after "Change anyway", further taps go through.
  const recentOther = recentChangeByOther(t.lastChange, currentUserId);
  const needsConfirm = recentOther != null && acknowledgedAt !== t.lastChange?.at;
  const guard = (action: (confirmed: boolean) => void) => {
    if (disabled) return;
    if (needsConfirm) {
      setPendingAction(() => () => action(true));
      return;
    }
    action(false);
  };
  const confirmPending = () => {
    setAcknowledgedAt(t.lastChange?.at ?? null);
    const run = pendingAction;
    setPendingAction(null);
    run?.();
  };

  /** `confirmed`: the person already said yes in the dialog, so Off needs no second tap. */
  const onMode = (m: string, confirmed = false) => {
    if (m === t.hvacMode || settingsLocked) return;
    if (m === 'off' && !confirmOff && !confirmed) {
      setConfirmOff(true);
      if (offTimer.current) clearTimeout(offTimer.current);
      offTimer.current = setTimeout(() => setConfirmOff(false), 3000);
      return;
    }
    setConfirmOff(false);
    cmd.changeMode(m);
  };

  // One status line under the keys, first match wins.
  let status: { text: string; tone: Tone; spinner?: boolean; retry?: () => void } | null = null;
  if (cmd.error) status = { text: cmd.error.message, tone: 'problem', retry: cmd.error.retry };
  else if (blockedHint) status = { text: blockedHint, tone: 'neutral' };
  else if (hint && draft) status = { text: hint, tone: 'neutral' };
  else if (cmd.debouncing) status = { text: 'Sending in a moment…', tone: 'neutral' };
  else if (cmd.waiting) status = { text: 'Updating the thermostat…', tone: 'neutral', spinner: true };
  else if (cmd.notice) status = { text: cmd.notice, tone: 'headsup' };
  else if (canControl && showHoldHint && !isHold(t.presetMode) && setpoint.kind !== 'none') {
    status = { text: 'Changing it pauses the schedule until you resume.', tone: 'neutral' };
  }

  const presets = selectablePresets(t.presetModes);
  const stale = isStale(t.updatedAt);
  const hold = isHold(t.presetMode);
  const verdict = verdictFor(t, stale);

  // The dial: the scale, the heat side from the bottom of the scale up to heat-to, the cool
  // side from cool-to to the top, a mark on each setpoint and the pointer at the room.
  const { lo, hi } = dialScale([t.temperature, shownLow, shownHigh, shownSingle]);
  const ring: DialRing = {
    r: 86, w: 10, min: lo, max: hi, ticks: hi - lo, major: 5, labels: [[lo, `${lo}°`], [hi, `${hi}°`]],
    segments: [], marks: [],
  };
  if (setpoint.kind === 'range') {
    if (shownLow != null) {
      ring.segments!.push({ from: lo, to: shownLow, tone: 'heat' });
      ring.marks!.push({ at: shownLow, tone: 'heat' });
    }
    if (shownHigh != null) {
      ring.segments!.push({ from: shownHigh, to: hi, tone: 'cool' });
      ring.marks!.push({ at: shownHigh, tone: 'cool' });
    }
  } else if (setpoint.kind === 'single' && shownSingle != null) {
    const heat = t.hvacMode === 'heat';
    ring.segments!.push(heat ? { from: lo, to: shownSingle, tone: 'heat' } : { from: shownSingle, to: hi, tone: 'cool' });
    ring.marks!.push({ at: shownSingle, tone: heat ? 'heat' : 'cool' });
  }
  if (t.temperature != null) ring.needle = { at: t.temperature };
  const dialSentence = `${t.name} is ${formatTemp(t.temperature, 1)} degrees. ${statusChip(t).text}.`;

  const modeOptions = sortedModes(t.hvacModes).map((m) => ({
    value: m,
    disabled: settingsLocked,
    label:
      m === 'off' && confirmOff ? (
        'Tap to turn off'
      ) : cmd.pendingMode === m ? (
        <>
          <Spinner />
          {modeLabel(m)}
        </>
      ) : (
        modeLabel(m)
      ),
  }));

  const last = t.lastChange;
  const lastWhat = last ? changeWhat(last) : null;
  const chip = statusChip(t);

  return (
    <>
      {/* The thermostat's own section, named by its heading. Its inner layout follows the
          panel's width (a container query), not the window's: in a half-width column the dial
          sits on top with the facts under it; a wide panel puts them side by side. */}
      <Panel
        id={thermostatPanelId(t.id)}
        tabIndex={-1}
        title={t.name}
        subtitle={chip.text}
        action={
          !canControl ? (
            <Badge plain icon="eye">
              View only
            </Badge>
          ) : undefined
        }
        className={cx(
          '@container flex h-full scroll-mt-24 flex-col focus:outline-none [&_.fp-panel-title]:text-[length:var(--appfs-lead)]',
          className,
        )}
      >
        <div className="grid flex-1 grid-rows-[auto_1fr] gap-4 @min-[44rem]:grid-cols-[minmax(260px,4fr)_minmax(0,6fr)] @min-[44rem]:grid-rows-1 @min-[44rem]:gap-8">
          <div className="flex min-w-0 flex-col items-center gap-3">
            <Dial
              rings={[ring]}
              label={dialSentence}
              className="-mb-7 [--fp-dial-max:188px] @min-[24rem]:[--fp-dial-max:220px] @min-[44rem]:-mb-6 @min-[44rem]:[--fp-dial-max:var(--appdial-max)]"
            >
              <DialCentre label="Inside">
                <Num size="xl" value={`${formatTemp(t.temperature)}°`} />
              </DialCentre>
            </Dial>
            <div className="flex w-full max-w-[360px] flex-wrap justify-center gap-x-3 gap-y-2">
              {setpoint.kind === 'none' ? (
                <p className="w-full rounded-well bg-appinset px-3 py-3.5 text-center text-small text-apptext-muted">
                  {t.hvacMode === 'off' ? 'The system is off. Pick a mode to set a temperature.' : 'No setpoint reported.'}
                </p>
              ) : setpoint.kind === 'range' ? (
                <>
                  <SetpointTile
                    side="heat" label="Heat to" deviceName={t.name} value={shownLow} unit={unit}
                    pending={draft?.kind === 'range'} flash={flash === 'heat'} readOnly={!canControl}
                    disabled={disabled}
                    lowerDisabled={shownLow != null && shownLow <= lim.min}
                    onStep={(d) => guard(() => stepRange('low', d))}
                  />
                  <SetpointTile
                    side="cool" label="Cool to" deviceName={t.name} value={shownHigh} unit={unit}
                    pending={draft?.kind === 'range'} flash={flash === 'cool'} readOnly={!canControl}
                    disabled={disabled}
                    raiseDisabled={shownHigh != null && shownHigh >= lim.max}
                    onStep={(d) => guard(() => stepRange('high', d))}
                  />
                </>
              ) : (
                <SetpointTile
                  side={t.hvacMode === 'heat' ? 'heat' : 'cool'}
                  label={t.hvacMode === 'heat' ? 'Heat to' : 'Cool to'}
                  deviceName={t.name} value={shownSingle} unit={unit}
                  pending={draft?.kind === 'single'} flash={false} readOnly={!canControl}
                  disabled={disabled}
                  lowerDisabled={shownSingle != null && shownSingle <= lim.min}
                  raiseDisabled={shownSingle != null && shownSingle >= lim.max}
                  onStep={(d) => guard(() => stepSingle(d))}
                />
              )}
              <p className="flex min-h-5 w-full flex-wrap items-center justify-center gap-2 text-center text-small" role="status">
                {status && (
                  <>
                    {status.spinner && <Spinner className="text-apptext-muted" />}
                    <span className={toneTextClass(status.tone)}>{status.text}</span>
                    {status.retry && (
                      <Button size="sm" variant="quiet" icon="refresh" onClick={status.retry}>
                        Retry
                      </Button>
                    )}
                  </>
                )}
              </p>
              <span className="fp-sr-only" aria-live="polite">{cmd.announce}</span>
            </div>
            {canControl && t.hvacModes.length > 0 && (
              <div className="w-full max-w-[420px]">
                <Seg
                  kind="radio"
                  fit="fill"
                  label={`${t.name} mode`}
                  value={t.hvacMode ?? ''}
                  onChange={(m) => guard((confirmed) => onMode(m, confirmed))}
                  options={modeOptions}
                />
              </div>
            )}
          </div>

          <div className="fp-stack min-w-0">
            <Verdict tone={verdict.tone} note={verdict.note}>{verdict.text}</Verdict>
            <Readouts count={2}>
              <Readout label="Humidity" value={formatTemp(t.humidity)} unit="%" note="At the thermostat" />
              <Readout
                label="Schedule"
                value={hold ? 'Paused' : 'Running'}
                note={hold ? holdLabel(t.presetMode) : t.presetMode ? `${presetLabel(t.presetMode)} comfort` : 'Following the schedule'}
              />
            </Readouts>
            {(hold || (canControl && presets.length > 0)) && (
              <div className="fp-stack fp-stack--s">
                <p className="fp-label" aria-hidden="true">Comfort</p>
                {/* B-106: no Comfort row at all when the thermostat offers nothing to pick. */}
                {canControl && presets.length > 0 && (
                  <div className="fp-chips" role="group" aria-label={`${t.name} comfort setting`}>
                    {presets.map((p) => {
                      const active = t.presetMode === p;
                      return (
                        <button
                          key={p}
                          type="button"
                          className="fp-chip aria-disabled:cursor-default aria-disabled:opacity-40"
                          aria-pressed={active}
                          aria-disabled={settingsLocked || undefined}
                          onClick={() => {
                            if (!active && !settingsLocked) guard(() => cmd.hold(p));
                          }}
                        >
                          {presetLabel(p)}
                        </button>
                      );
                    })}
                  </div>
                )}
                {hold && (
                  <Notice
                    tone="neutral"
                    icon="pause"
                    title={`${holdLabel(t.presetMode)} · schedule paused`}
                    action={
                      canControl ? (
                        <Button
                          size="sm"
                          aria-disabled={settingsLocked || undefined}
                          onClick={() => {
                            if (!settingsLocked) guard(() => cmd.resume());
                          }}
                        >
                          Resume schedule
                        </Button>
                      ) : undefined
                    }
                  >
                    The schedule takes over again once someone resumes it.
                  </Notice>
                )}
              </div>
            )}
            {last && (
              <div className="fp-stack fp-stack--s">
                <p className="fp-label">Last change</p>
                <List inset>
                  <Row
                    compact
                    icon={CHANGE_ICON[last.actor] ?? 'user'}
                    title={changeWho(last, currentUserId)}
                    meta={
                      <>
                        <span className="fp-mono">{formatStamp(last.at)}</span>
                        {lastWhat ? ` · ${lastWhat}` : ''}
                      </>
                    }
                  />
                </List>
              </div>
            )}
            <div className="fp-ip-foot mt-auto">
              <span className="fp-cluster">
                <Lamp tone={stale || !t.available ? 'headsup' : 'ok'} size="s" />
                <span className="fp-mono">{t.updatedAt ? `Updated ${agoText(t.updatedAt)}` : 'No reading yet'}</span>
              </span>
            </div>
          </div>
        </div>
      </Panel>

      <ConfirmThermostatChangeModal
        open={pendingAction != null && recentOther != null}
        deviceName={t.name}
        changedBy={recentOther?.name ?? ''}
        ago={recentOther?.ago ?? ''}
        onConfirm={confirmPending}
        onCancel={() => setPendingAction(null)}
      />
    </>
  );
}

export default memo(ThermostatCard);
