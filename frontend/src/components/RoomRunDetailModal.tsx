import type { RoombaRun } from '../types';
import { daysBetween, formatDate, formatDateTime, formatDuration, formatNumber, formatTime, plural } from '../utils/format';
import { cycleLabel, initiatorLabel, runStatus } from '../utils/roombaStatus';
import { Badge, Button, Dialog, Disclosure, KeyValue, KV, Stack } from './ui';

interface Props {
  run: RoombaRun;
  onClose: () => void;
}

/**
 * The run's whole length in minutes. Unconfirmed (poll-based) rows prefer the time between the
 * timestamps over the stored figure and never trust an absurd (>24 h) one; the cloud's own
 * figures are used as they are.
 */
export function runDurationMinutes(run: Pick<RoombaRun, 'durationMinutes' | 'startedAt' | 'completedAt' | 'verified'>): number | null {
  let duration = run.durationMinutes;
  if (!run.verified) {
    const startMs = Date.parse(run.startedAt);
    const endMs = run.completedAt ? Date.parse(run.completedAt) : NaN;
    if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs) {
      const computed = Math.round((endMs - startMs) / 60000);
      if (duration == null || duration > 1440) duration = computed;
    } else if (duration != null && duration > 1440) {
      duration = null;
    }
  }
  return duration;
}

/**
 * "Ended": the time alone on the day it started, the day and time when the run went past
 * midnight, so an overnight clean can't look as if it ended before it began (B-134).
 */
export function endedLabel(startedAt: string, completedAt: string | null): string {
  if (!completedAt) return 'Still going';
  const days = daysBetween(startedAt, completedAt);
  return days != null && days !== 0 ? formatDateTime(completedAt) : formatTime(completedAt);
}

/** Read-only detail for one cleaning run. */
export default function RoomRunDetailModal({ run, onClose }: Props) {
  const st = runStatus(run.status);
  const durationMin = runDurationMinutes(run);
  const charged = run.chargeMinutes != null && run.chargeMinutes > 0 ? run.chargeMinutes : null;
  const paused = run.pauseMinutes != null && run.pauseMinutes > 0 ? run.pauseMinutes : null;
  const cleaningMin = durationMin != null ? Math.max(0, durationMin - (charged ?? 0) - (paused ?? 0)) : null;
  const hasError = run.error != null && run.error !== 0;
  const initiator = initiatorLabel(run.initiator);

  return (
    <Dialog
      open
      onClose={onClose}
      size="narrow"
      eyebrow="Cleaning run"
      title={formatDate(run.startedAt)}
      footer={<Button onClick={onClose}>Close</Button>}
    >
      <Stack>
        <div><Badge status={st} /></div>
        <KeyValue>
          <KV label="Started" value={formatTime(run.startedAt)} />
          <KV label="Ended" value={endedLabel(run.startedAt, run.completedAt)} />
          <KV label="Cleaning time" value={formatDuration(cleaningMin)} />
          {charged != null && <KV label="Docked to recharge" value={formatDuration(charged)} />}
          {paused != null && <KV label="Paused" value={formatDuration(paused)} />}
          <KV label="Area cleaned" value={formatNumber(run.squareFeet, { unit: 'sq ft' })} />
          {run.verified && <KV label="Rooms" value={run.rooms.length ? run.rooms.join(', ') : 'Whole home'} />}
          {run.settings && <KV label="Settings" value={run.settings} />}
          {run.evacuations != null && run.evacuations > 0 && <KV label="Bin emptied" value={plural(run.evacuations, 'time')} />}
          {initiator && <KV label="Started by" value={initiator} />}
          {hasError && <KV label="Problem" value={run.errorText || `Error code ${run.error}`} tone="problem" />}
        </KeyValue>

        {!run.verified && run.missionNumber == null && run.initiator == null && (
          <p className="fp-small fp-muted">
            Extra details (who started it, the run number, faults) are kept for runs recorded from now on.
          </p>
        )}

        <Disclosure summary="For the curious" openSummary="Hide the details">
          <KeyValue>
            {run.missionNumber != null && <KV label="Run number" value={String(run.missionNumber)} mono />}
            {run.missionId && (
              // A long unbroken ID wraps instead of running off a phone's edge (B-133).
              <KV label="Run ID" value={<span className="fp-code whitespace-normal break-all">{run.missionId}</span>} />
            )}
            {!run.verified && run.cycle && <KV label="Cycle" value={cycleLabel(run.cycle)} />}
            <KV label="Recorded from" value={run.verified ? 'iRobot history' : 'Live polling (not confirmed yet)'} />
          </KeyValue>
        </Disclosure>
      </Stack>
    </Dialog>
  );
}
