import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { Thermostat } from '../types';
import {
  errorMessage,
  holdThermostat,
  resumeThermostat,
  setThermostatMode,
  setThermostatTemperature,
} from '../api/climate';
import { currentSetpoint, formatTemp } from '../utils/thermostat';

// Setpoint taps are batched: each ± restarts this timer and only the final
// value is sent, so tapping + five times is one command, not five.
export const SEND_DELAY_MS = 1200;
// Commands return the stored state, which trails the thermostat. Refetch while
// the WebSocket ingest catches up; after DRAFT_TIMEOUT_MS say so instead of
// silently reverting.
const REFETCH_AFTER_MS = [2_500, 8_000, 15_000];
export const DRAFT_TIMEOUT_MS = 20_000;

export type Draft = { kind: 'single'; value: number } | { kind: 'range'; low: number; high: number };

export function draftMatches(draft: Draft, t: Thermostat): boolean {
  const sp = currentSetpoint(t);
  if (draft.kind === 'single') return sp.kind === 'single' && sp.value === draft.value;
  return sp.kind === 'range' && sp.low === draft.low && sp.high === draft.high;
}

function draftText(d: Draft): string {
  return d.kind === 'single' ? `${formatTemp(d.value)}°` : `${formatTemp(d.low)}–${formatTemp(d.high)}°`;
}

export interface CommandError {
  message: string;
  retry: () => void;
}

/**
 * State machine behind a thermostat card: batched setpoint drafts, pending
 * mode, confirmation tracking, errors with retry, and a timeout notice when
 * ecobee hasn't confirmed a change.
 */
export function useThermostatCommands(t: Thermostat) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [draftSentAt, setDraftSentAt] = useState<number | null>(null);
  const [pendingMode, setPendingMode] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null); // timed-out confirmation
  const [error, setError] = useState<CommandError | null>(null);
  const [announce, setAnnounce] = useState('');
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

  const fail = (err: unknown, retry: () => void) =>
    setError({ message: errorMessage(err, 'The thermostat did not accept that change'), retry });
  const succeed = () => {
    setError(null);
    refetchSoon();
  };

  const temperature = useMutation({
    mutationFn: (d: Draft) =>
      setThermostatTemperature(t.id, d.kind === 'single' ? { temperature: d.value } : { low: d.low, high: d.high }),
    onSuccess: (_r, d) => {
      setDraftSentAt(Date.now());
      setAnnounce(`${t.name} set to ${draftText(d)}`);
      succeed();
    },
    onError: (err, d) => {
      setDraft(null);
      setDraftSentAt(null);
      fail(err, () => sendDraft(d));
    },
  });
  const mode = useMutation({
    mutationFn: (m: string) => setThermostatMode(t.id, m),
    onSuccess: succeed,
    onError: (err, m) => {
      setPendingMode(null);
      fail(err, () => changeMode(m));
    },
  });
  const hold = useMutation({
    mutationFn: (p: string) => holdThermostat(t.id, p),
    onSuccess: succeed,
    onError: (err, p) => fail(err, () => hold.mutate(p)),
  });
  const resume = useMutation({
    mutationFn: () => resumeThermostat(t.id),
    onSuccess: succeed,
    onError: (err) => fail(err, () => resume.mutate()),
  });

  function sendDraft(d: Draft) {
    setError(null);
    setNotice(null);
    setDraft(d);
    setDraftSentAt(null);
    temperature.mutate(d);
  }

  /** Queue a new draft; it's sent once the taps stop for SEND_DELAY_MS. */
  const queueDraft = (d: Draft) => {
    setError(null);
    setNotice(null);
    setDraft(d);
    setDraftSentAt(null);
    if (sendTimer.current) clearTimeout(sendTimer.current);
    sendTimer.current = setTimeout(() => temperature.mutate(d), SEND_DELAY_MS);
  };

  function changeMode(m: string) {
    setError(null);
    setNotice(null);
    setPendingMode(m);
    mode.mutate(m);
  }

  // Clear the draft when the thermostat reports it; otherwise, after the
  // timeout, keep the real value but say the request is still unconfirmed.
  useEffect(() => {
    if (!draft || draftSentAt == null) return;
    if (draftMatches(draft, t)) {
      setDraft(null);
      setDraftSentAt(null);
      return;
    }
    const timer = setTimeout(() => {
      setNotice(`ecobee hasn't confirmed yet — it can take a few minutes. (requested ${draftText(draft)})`);
      setDraft(null);
      setDraftSentAt(null);
    }, Math.max(0, DRAFT_TIMEOUT_MS - (Date.now() - draftSentAt)));
    return () => clearTimeout(timer);
  }, [draft, draftSentAt, t]);

  // Pending mode: done when HA reports it, dropped quietly after the timeout.
  useEffect(() => {
    if (!pendingMode) return;
    if (t.hvacMode === pendingMode) {
      setPendingMode(null);
      return;
    }
    const timer = setTimeout(() => setPendingMode(null), DRAFT_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [pendingMode, t.hvacMode]);

  // A late confirmation (a newer recorded change) clears the "hasn't confirmed" notice.
  const lastChangeAt = t.lastChange?.at ?? null;
  const noticeBaseline = useRef<string | null>(null);
  useEffect(() => {
    if (!notice) {
      noticeBaseline.current = lastChangeAt;
      return;
    }
    if (lastChangeAt !== noticeBaseline.current) setNotice(null);
  }, [notice, lastChangeAt]);

  const busy = temperature.isPending || mode.isPending || hold.isPending || resume.isPending;
  const waiting = busy || (draft != null && draftSentAt != null) || pendingMode != null;

  return {
    draft,
    debouncing: draft != null && draftSentAt == null && !temperature.isPending,
    waiting,
    busy,
    pendingMode,
    notice,
    clearNotice: () => setNotice(null),
    error,
    announce,
    queueDraft,
    changeMode,
    hold: (p: string) => {
      setError(null);
      hold.mutate(p);
    },
    resume: () => {
      setError(null);
      resume.mutate();
    },
  };
}
