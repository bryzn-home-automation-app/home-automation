import { memo, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import StatTile, { Icons } from '../components/StatTile';
import DeferredRender from '../components/DeferredRender';
import VirtualizedList from '../components/VirtualizedList';
import RoombaMap, { type RoomSelection, type SplitLine } from '../components/RoombaMap';
import RoomRenameModal from '../components/RoomRenameModal';
import RoomSplitModal from '../components/RoomSplitModal';
import RoombaControls from '../components/RoombaControls';
import { fetchRoombaStatus, fetchRoombaRuns, fetchRoombaMap, fetchRoombaDevice } from '../api/roomba';
import { jitteredInterval } from '../hooks/useJitteredInterval';
import { useAuth } from '../context/AuthContext';
import type { RoombaStatus, RoombaRun } from '../types';

// ── Presentation helpers ──────────────────────────────────

/** Map a raw V4 phase to a human label. */
function phaseLabel(status: RoombaStatus | null | undefined): string {
  if (!status) return 'Unknown';
  if (status.error && status.error !== 0) return 'Needs attention';
  switch (status.phase) {
    case 'run':
      return 'Cleaning';
    case 'evac':
      return 'Emptying bin';
    case 'charge':
      return 'Charging';
    case 'hmMidMsn':
    case 'hmPostMsn':
    case 'hmUsrDock':
      return 'Returning to dock';
    case 'stop':
    case 'idle':
    case 'none':
    case null:
    case undefined:
      return 'Idle';
    default:
      return status.phase.charAt(0).toUpperCase() + status.phase.slice(1);
  }
}

function formatDuration(minutes: number | null | undefined): string {
  if (minutes == null || !Number.isFinite(minutes)) return '—';
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`;
}

function formatRelative(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return 'unknown';
  const diffSec = Math.round((Date.now() - then) / 1000);
  if (diffSec < 45) return 'just now';
  if (diffSec < 90) return 'a minute ago';
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr} hr ago`;
  const diffDay = Math.round(diffHr / 24);
  return `${diffDay} day${diffDay === 1 ? '' : 's'} ago`;
}

const INITIATOR_LABELS: Record<string, string> = {
  rmtApp: 'App',
  localApp: 'App',
  schedule: 'Schedule',
  manual: 'Robot button',
  cloud: 'Cloud',
  voice: 'Voice assistant',
};
function initiatorLabel(v: string | null | undefined): string {
  if (!v) return '—';
  return INITIATOR_LABELS[v] ?? v;
}

/** One label/value cell in the maintenance detail strip. */
function Detail({ label, value, tone }: { label: string; value: string; tone?: 'warn' }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-[0.16em] text-apptext-dim">{label}</p>
      <p className={`mt-1 font-medium ${tone === 'warn' ? 'text-amber-300' : 'text-apptext'}`}>{value}</p>
    </div>
  );
}

function runStatusStyle(status: string): { label: string; className: string } {
  switch (status) {
    case 'COMPLETED':
      return {
        label: 'Completed',
        className: 'border border-emerald-300/20 bg-emerald-300/10 text-emerald-300',
      };
    case 'STUCK':
      return {
        label: 'Stuck',
        className: 'border border-rose-300/20 bg-rose-300/10 text-rose-300',
      };
    case 'CANCELLED':
      return {
        label: 'Cancelled',
        className: 'border border-amber-300/20 bg-amber-300/10 text-amber-300',
      };
    default:
      return {
        label: status.charAt(0) + status.slice(1).toLowerCase(),
        className: 'border border-appborder bg-appinset text-apptext-muted',
      };
  }
}

function presenceChip(label: string, present: boolean | null | undefined): { text: string; className: string } {
  if (present == null) {
    return { text: `${label}: —`, className: 'border-appborder bg-appinset text-apptext-muted' };
  }
  return present
    ? { text: `${label} present`, className: 'border-emerald-300/20 bg-emerald-300/10 text-emerald-300' }
    : { text: `${label} missing`, className: 'border-amber-300/20 bg-amber-300/10 text-amber-300' };
}

// ── Page ──────────────────────────────────────────────────

export default memo(function Roomba() {
  const statusQuery = useQuery({
    queryKey: ['roomba-status'],
    queryFn: fetchRoombaStatus,
    staleTime: 20_000,
    refetchInterval: jitteredInterval(30_000, 5_000),
    refetchIntervalInBackground: false,
  });

  const runsQuery = useQuery({
    queryKey: ['roomba-runs'],
    queryFn: () => fetchRoombaRuns(50),
    staleTime: 60_000,
    refetchInterval: jitteredInterval(60_000),
    refetchIntervalInBackground: false,
  });

  const mapQuery = useQuery({
    queryKey: ['roomba-map'],
    queryFn: fetchRoombaMap,
    staleTime: 300_000,
    refetchInterval: jitteredInterval(300_000, 30_000),
    refetchIntervalInBackground: false,
  });

  const deviceQuery = useQuery({
    queryKey: ['roomba-device'],
    queryFn: fetchRoombaDevice,
    staleTime: 600_000,
    refetchInterval: jitteredInterval(600_000, 30_000),
    refetchIntervalInBackground: false,
  });

  const status = statusQuery.data ?? null;
  const device = deviceQuery.data ?? null;
  const runs = useMemo<RoombaRun[]>(() => runsQuery.data ?? [], [runsQuery.data]);
  const statusLoading = statusQuery.isLoading;
  const running = status?.running ?? false;
  const { isAdmin } = useAuth();
  const [selectedRoom, setSelectedRoom] = useState<RoomSelection | null>(null);
  const [splitMode, setSplitMode] = useState(false);
  const [pendingSplit, setPendingSplit] = useState<SplitLine | null>(null);

  const deviceLine = device
    ? [device.family || device.sku, device.series && `Series ${device.series}`,
       device.firmware && `firmware ${device.firmware}`].filter(Boolean).join(' · ')
    : null;

  const dockChip = useMemo(() => {
    if (!status) return null;
    if (running) return { text: 'Cleaning', className: 'border-appaccent-border bg-appaccent-soft text-appaccent-text' };
    if (status.dockText) {
      const attention = status.dockError != null && status.dockError !== 0;
      return {
        text: `Dock · ${status.dockText}`,
        className: attention
          ? 'border-amber-300/25 bg-amber-300/10 text-amber-300'
          : 'border-emerald-300/20 bg-emerald-300/10 text-emerald-300',
      };
    }
    if (status.phase === 'charge') return { text: 'Docked · charging', className: 'border-emerald-300/20 bg-emerald-300/10 text-emerald-300' };
    if (status.phase === 'evac') return { text: 'Docked · emptying', className: 'border-appaccent-border bg-appaccent-soft text-appaccent-text' };
    return { text: 'Idle', className: 'border-appborder bg-appinset text-apptext-muted' };
  }, [status, running]);

  const binChip = presenceChip('Bin', status?.binPresent);
  const tankChip = presenceChip('Tank', status?.tankPresent);

  const wearSummary = useMemo(() => {
    const w = status?.wear;
    if (!w) return null;
    const parts: string[] = [];
    if (w.nStuck) parts.push(`${w.nStuck} stuck`);
    if (w.nCliffsF) parts.push(`${w.nCliffsF} cliff`);
    if (w.nPicks) parts.push(`${w.nPicks} pickup`);
    return parts.length ? parts.join(' · ') : null;
  }, [status?.wear]);

  // Aggregate lifetime stats for a friendly summary line.
  const totalRuns = runs.length;
  const completedRuns = runs.filter((r) => r.status === 'COMPLETED').length;

  return (
    <div className="space-y-6 sm:space-y-7">
      {/* ── Hero / live status header ─────────────────────── */}
      <section className="rounded-[30px] border border-appborder bg-appsurface-raised p-6 shadow-[0_12px_34px_var(--appshadow)] sm:p-7">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="max-w-2xl">
            <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-apptext-muted">
              Robot Vacuum
            </p>
            <h2 className="mt-3 flex items-center gap-3 text-2xl font-semibold tracking-[-0.04em] text-apptext sm:text-3xl">
              {status?.name || 'Roomba'}
              {running && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-appaccent-border bg-appaccent-soft px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-appaccent-text">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-appaccent opacity-75" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-appaccent" />
                  </span>
                  Live
                </span>
              )}
            </h2>
            <p className="mt-3 text-sm leading-6 text-apptext-soft sm:text-base">
              {status
                ? `${phaseLabel(status)}${running && status.sqft ? ` · ${status.sqft} sq ft cleaned so far` : ''}.`
                : 'Live status, cleaning history, and floor map for your robot vacuum.'}
            </p>
            {deviceLine && (
              <p className="mt-1.5 text-xs text-apptext-dim">{deviceLine}</p>
            )}
          </div>

          {/* Online + presence chips */}
          <div className="flex flex-col items-start gap-3 lg:items-end">
            <div className="flex items-center gap-2">
              <span
                className={`h-2.5 w-2.5 rounded-full ${
                  status?.online ? 'bg-emerald-400' : 'bg-amber-400'
                }`}
              />
              <span className="text-sm font-medium text-apptext-soft">
                {status?.online ? 'Online' : status ? 'Offline' : 'No data'}
              </span>
              <span className="text-xs text-apptext-dim">
                · updated {formatRelative(status?.updatedAt)}
              </span>
            </div>
            {status && (
              <div className="flex flex-wrap gap-2 lg:justify-end">
                {dockChip && (
                  <span className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${dockChip.className}`}>
                    {dockChip.text}
                  </span>
                )}
                <span className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${binChip.className}`}>
                  {binChip.text}
                </span>
                <span className={`rounded-full border px-2.5 py-1 text-[11px] font-medium ${tankChip.className}`}>
                  {tankChip.text}
                </span>
              </div>
            )}
          </div>
        </div>

        {status?.needsAttention && (
          <div className="mt-4 flex items-start gap-3 rounded-2xl border border-amber-300/30 bg-amber-300/10 px-4 py-3">
            <span className="mt-0.5 text-lg leading-none">⚠️</span>
            <div className="text-sm text-amber-200">
              <p className="font-semibold">Needs attention</p>
              <p className="mt-0.5 text-amber-200/90">{status.attentionReasons.join(' · ')}</p>
            </div>
          </div>
        )}

        {statusQuery.isError && (
          <p className="mt-4 rounded-2xl border border-rose-300/25 bg-rose-300/10 px-4 py-2.5 text-xs text-rose-200">
            Couldn't reach the robot status service. Showing the last known values if available.
          </p>
        )}
        {!statusLoading && !status && !statusQuery.isError && (
          <p className="mt-4 rounded-2xl border border-appborder bg-appinset px-4 py-2.5 text-xs text-apptext-muted">
            Waiting for your Roomba's first check-in. Status appears here once the poller
            connects to the robot.
          </p>
        )}
      </section>

      {/* ── Live status stat tiles ────────────────────────── */}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:gap-4">
        <StatTile
          label="Battery"
          value={status?.batteryPct != null ? String(status.batteryPct) : '—'}
          unit="%"
          loading={statusLoading}
          icon={Icons.Bolt}
          subtitle={status ? phaseLabel(status) : undefined}
        />
        <StatTile
          label={running ? 'This Run' : 'Last Area'}
          value={status?.sqft != null ? String(status.sqft) : '—'}
          unit="sq ft"
          loading={statusLoading}
          icon={Icons.Dollar}
          subtitle={running ? 'cleaning now' : undefined}
        />
        <StatTile
          label={running ? 'Runtime' : 'Lifetime Runs'}
          value={
            running
              ? status?.runtimeMinutes != null
                ? formatDuration(status.runtimeMinutes)
                : '—'
              : status?.lifetimeMissions != null
                ? String(status.lifetimeMissions)
                : String(totalRuns || '—')
          }
          unit={running ? '' : 'missions'}
          loading={statusLoading}
          icon={Icons.Calendar}
        />
        <StatTile
          label="Lifetime Time"
          value={
            status?.lifetimeRunMinutes != null
              ? String(Math.round(status.lifetimeRunMinutes / 60))
              : '—'
          }
          unit="hrs"
          loading={statusLoading}
          icon={Icons.Bolt}
        />
      </section>

      {/* ── Admin controls ────────────────────────────────── */}
      {isAdmin && <RoombaControls status={status} />}

      {/* ── Maintenance / detail strip ────────────────────── */}
      {status &&
        (status.errorText || status.dockText || status.initiator || status.detectedPad ||
          status.chargeCycles != null || wearSummary) && (
        <section className="rounded-[24px] border border-appborder bg-appsurface-raised p-4 sm:p-5">
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 lg:grid-cols-4">
            {status.errorText && <Detail label="Error" value={status.errorText} tone="warn" />}
            {!running && status.dockText && <Detail label="Dock" value={status.dockText} />}
            {running && status.initiator && <Detail label="Started by" value={initiatorLabel(status.initiator)} />}
            {status.detectedPad && <Detail label="Mop pad" value={status.detectedPad} />}
            {status.chargeCycles != null && <Detail label="Charge cycles" value={String(status.chargeCycles)} />}
            {status.chargeErrors != null && status.chargeErrors > 0 && (
              <Detail label="Charging faults" value={String(status.chargeErrors)} tone="warn" />
            )}
            {wearSummary && <Detail label="Recent incidents" value={wearSummary} />}
          </div>
        </section>
      )}

      {/* ── Floor-plan map ────────────────────────────────── */}
      <section className="perf-section rounded-[28px] border border-appborder bg-appsurface-raised p-5 shadow-[0_10px_28px_var(--appshadow)] sm:p-6">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-apptext-muted">
              Floor Plan
            </p>
            <h3 className="mt-2 text-lg font-semibold text-apptext">
              {mapQuery.data?.name || 'Cleaning map'}
            </h3>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-apptext-muted">
              Rooms, walls, and dock location as mapped by the robot. Built up over the first
              several cleaning runs.
              {isAdmin && !splitMode && ' Tap a room to rename it or set its type.'}
            </p>
          </div>
          {isAdmin && mapQuery.data && (
            <button
              type="button"
              onClick={() => setSplitMode((v) => !v)}
              className={`shrink-0 rounded-xl border px-3 py-2 text-xs font-medium transition-colors ${
                splitMode
                  ? 'border-amber-300/40 bg-amber-300/15 text-amber-200'
                  : 'border-appborder bg-appinset text-apptext-soft hover:bg-appinset-strong'
              }`}
            >
              {splitMode ? 'Cancel divide' : '✂ Divide a room'}
            </button>
          )}
        </div>

        {isAdmin && splitMode && (
          <div className="mb-4 rounded-2xl border border-amber-300/25 bg-amber-300/10 px-4 py-3 text-xs leading-5 text-amber-200">
            <span className="font-semibold">Divide mode.</span> Click two points across a room to
            draw a dividing line — the first click picks the room. This is an experimental,
            not-cleanly-reversible map edit.
          </div>
        )}

        <DeferredRender minHeight={320}>
          <RoombaMap
            map={mapQuery.data ?? null}
            loading={mapQuery.isLoading}
            running={running}
            editable={isAdmin}
            onSelectRoom={setSelectedRoom}
            splitMode={splitMode}
            onSplitReady={(line) => {
              setPendingSplit(line);
              setSplitMode(false);
            }}
          />
        </DeferredRender>
      </section>

      {/* ── Run history ───────────────────────────────────── */}
      <section className="perf-section rounded-[28px] border border-appborder bg-appsurface-raised p-5 shadow-[0_10px_28px_var(--appshadow)]">
        <div className="mb-4 flex items-center justify-between gap-4">
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-apptext-muted">
              History
            </p>
            <h3 className="mt-2 text-lg font-semibold text-apptext">Recent runs</h3>
          </div>
          {totalRuns > 0 && (
            <span className="text-xs text-apptext-dim">
              {completedRuns}/{totalRuns} completed
            </span>
          )}
        </div>

        {runsQuery.isLoading ? (
          <div className="space-y-2 animate-pulse">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-12 rounded-2xl bg-appinset" />
            ))}
          </div>
        ) : runs.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-[24px] border border-dashed border-appborder bg-appinset p-10 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-appaccent-border bg-appaccent-soft text-appaccent-text">
              {Icons.Calendar}
            </div>
            <p className="text-sm font-medium text-apptext-soft">No cleaning runs yet</p>
            <p className="max-w-xs text-xs leading-5 text-apptext-muted">
              Once your Roomba finishes its first mission, each run will show up here with its
              duration, area cleaned, and outcome.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <div className="text-sm">
              <div className="grid grid-cols-[1.5fr_1fr_0.9fr] md:grid-cols-[1.5fr_1fr_1fr_1fr] border-b border-appborder pb-2 text-left text-apptext-dim">
                <div className="font-medium">Date</div>
                <div className="text-right font-medium">Duration</div>
                <div className="hidden text-right font-medium md:block">Sq Ft</div>
                <div className="text-right font-medium">Status</div>
              </div>
              <VirtualizedList
                items={runs}
                height={Math.min(runs.length, 8) * 56 + 8}
                itemHeight={56}
                overscan={6}
                className="mt-1"
                renderItem={(r) => {
                  const started = new Date(r.startedAt);
                  const dateLabel = Number.isNaN(started.getTime())
                    ? '—'
                    : started.toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      });
                  const timeLabel = Number.isNaN(started.getTime())
                    ? ''
                    : started.toLocaleTimeString('en-US', {
                        hour: 'numeric',
                        minute: '2-digit',
                      });
                  const st = runStatusStyle(r.status);
                  return (
                    <div
                      key={r.id}
                      className="grid grid-cols-[1.5fr_1fr_0.9fr] md:grid-cols-[1.5fr_1fr_1fr_1fr] items-center border-b border-appborder-light pr-1 transition-colors hover:bg-appinset"
                    >
                      <div className="py-3">
                        <div className="text-apptext-soft">{dateLabel}</div>
                        {timeLabel && (
                          <div className="text-[11px] text-apptext-dim">{timeLabel}</div>
                        )}
                      </div>
                      <div className="py-3 text-right tabular-nums text-apptext">
                        {formatDuration(r.durationMinutes)}
                      </div>
                      <div className="hidden py-3 text-right tabular-nums text-apptext-muted md:block">
                        {r.squareFeet != null ? r.squareFeet : '—'}
                      </div>
                      <div className="py-3 text-right">
                        <span className={`rounded-full px-2.5 py-1 text-xs ${st.className}`}>
                          {st.label}
                        </span>
                      </div>
                    </div>
                  );
                }}
              />
            </div>
          </div>
        )}
      </section>

      {/* Admin room-rename dialog */}
      {isAdmin && selectedRoom && (
        <RoomRenameModal room={selectedRoom} onClose={() => setSelectedRoom(null)} />
      )}

      {/* Admin divide-a-room confirmation */}
      {isAdmin && pendingSplit && (
        <RoomSplitModal split={pendingSplit} onClose={() => setPendingSplit(null)} />
      )}
    </div>
  );
});
