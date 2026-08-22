import { useEffect } from 'react';
import type { RoombaRun } from '../types';

interface Props {
  run: RoombaRun;
  onClose: () => void;
}

const INITIATOR_LABELS: Record<string, string> = {
  rmtApp: 'App',
  localApp: 'App',
  schedule: 'Schedule',
  manual: 'Robot button',
  cloud: 'Cloud',
  voice: 'Voice assistant',
};

function statusStyle(status: string): { label: string; className: string } {
  switch (status) {
    case 'COMPLETED':
      return { label: 'Completed', className: 'border-emerald-300/25 bg-emerald-300/10 text-emerald-300' };
    case 'STUCK':
      return { label: 'Stuck', className: 'border-rose-300/25 bg-rose-300/10 text-rose-300' };
    case 'CANCELLED':
      return { label: 'Cancelled', className: 'border-amber-300/25 bg-amber-300/10 text-amber-300' };
    default:
      return {
        label: status ? status.charAt(0) + status.slice(1).toLowerCase() : 'Unknown',
        className: 'border-appborder bg-appinset text-apptext-muted',
      };
  }
}

function fmtDuration(min: number | null): string {
  if (min == null || !Number.isFinite(min)) return '—';
  if (min < 1) return '<1 min';
  if (min < 60) return `${Math.round(min)} min`;
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

function fmtTime(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

/** One label/value row in the detail grid. */
function Row({ label, value, tone }: { label: string; value: string; tone?: 'warn' }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-appborder-light py-2.5 last:border-0">
      <span className="text-xs uppercase tracking-[0.12em] text-apptext-dim">{label}</span>
      <span className={`text-sm font-medium ${tone === 'warn' ? 'text-amber-300' : 'text-apptext'}`}>
        {value}
      </span>
    </div>
  );
}

/** Read-only detail view for a single cleaning run. */
export default function RoomRunDetailModal({ run, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const st = statusStyle(run.status);

  // Prefer the elapsed time between the timestamps; fall back to the stored
  // duration, and never trust an absurd (>24h) stored value.
  const startMs = Date.parse(run.startedAt);
  const endMs = run.completedAt ? Date.parse(run.completedAt) : NaN;
  let durationMin = run.durationMinutes;
  if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs) {
    const computed = Math.round((endMs - startMs) / 60000);
    if (durationMin == null || durationMin > 1440) durationMin = computed;
  } else if (durationMin != null && durationMin > 1440) {
    durationMin = null;
  }

  const hasError = run.error != null && run.error !== 0;
  const initiator = run.initiator ? INITIATOR_LABELS[run.initiator] ?? run.initiator : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Cleaning run details"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-[24px] border border-appborder bg-appsurface-raised p-6 shadow-[0_20px_60px_var(--appshadow)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-apptext-muted">
              Cleaning run
            </p>
            <h3 className="mt-2 text-lg font-semibold text-apptext">{fmtDate(run.startedAt)}</h3>
          </div>
          <span className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium ${st.className}`}>
            {st.label}
          </span>
        </div>

        <div className="mt-4">
          <Row label="Started" value={fmtTime(run.startedAt)} />
          <Row label="Ended" value={fmtTime(run.completedAt)} />
          <Row label="Duration" value={fmtDuration(durationMin)} />
          <Row label="Area cleaned" value={run.squareFeet != null ? `${run.squareFeet} sq ft` : '—'} />
          {initiator && <Row label="Started by" value={initiator} />}
          {run.missionNumber != null && <Row label="Mission #" value={String(run.missionNumber)} />}
          {run.cycle && <Row label="Cycle" value={run.cycle} />}
          {hasError && (
            <Row label="Error" value={run.errorText || `Code ${run.error}`} tone="warn" />
          )}
          {run.missionId && <Row label="Mission ID" value={run.missionId} />}
          {run.source && <Row label="Source" value={run.source} />}
        </div>

        {run.missionNumber == null && run.initiator == null && (
          <p className="mt-4 text-xs leading-5 text-apptext-dim">
            Extra per-run details (who started it, mission number, faults) are captured for runs
            recorded from now on.
          </p>
        )}

        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-appborder bg-appinset px-4 py-2 text-sm font-medium text-apptext-soft transition-colors hover:bg-appinset-strong"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
