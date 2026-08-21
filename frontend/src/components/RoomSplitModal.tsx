import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { splitRoombaRoom, fetchRoombaCommands } from '../api/roomba';
import { jitteredInterval } from '../hooks/useJitteredInterval';
import type { SplitLine } from './RoombaMap';

interface Props {
  split: SplitLine;
  onClose: () => void;
}

/**
 * Confirmation dialog for dividing a room. This is an EXPERIMENTAL, not-cleanly-
 * reversible map edit (never validated on hardware), so it requires an explicit
 * acknowledgement before sending. After enqueueing it watches the command status
 * and refreshes the floor plan when the split lands.
 */
export default function RoomSplitModal({ split, onClose }: Props) {
  const qc = useQueryClient();
  const [ack, setAck] = useState(false);
  const [commandId, setCommandId] = useState<number | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const mutation = useMutation({
    mutationFn: () => splitRoombaRoom(split.roomId, split.points),
    onSuccess: (cmd) => setCommandId(cmd.id),
  });

  const isTerminalStatus = (s: string | undefined) => s === 'OK' || s === 'FAILED';

  const commandsQuery = useQuery({
    queryKey: ['roomba', 'commands'],
    queryFn: fetchRoombaCommands,
    enabled: commandId != null,
    refetchInterval: (query) => {
      const c = (query.state.data ?? []).find((x) => x.id === commandId);
      return isTerminalStatus(c?.status) ? false : jitteredInterval(2500);
    },
    refetchIntervalInBackground: false,
  });

  const queued = useMemo(
    () => (commandsQuery.data ?? []).find((c) => c.id === commandId) ?? null,
    [commandsQuery.data, commandId],
  );

  const status = queued?.status ?? (mutation.isPending || commandId != null ? 'PENDING' : null);

  useEffect(() => {
    if (queued?.status !== 'OK') return;
    qc.invalidateQueries({ queryKey: ['roomba-map'] });
    window.setTimeout(() => qc.invalidateQueries({ queryKey: ['roomba-map'] }), 30_000);
    window.setTimeout(() => qc.invalidateQueries({ queryKey: ['roomba-map'] }), 70_000);
  }, [queued?.status, qc]);

  const submitting =
    mutation.isPending || (commandId != null && !isTerminalStatus(status ?? undefined));
  const roomLabel = split.roomName ? `“${split.roomName}”` : 'this room';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Divide room"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-[24px] border border-appborder bg-appsurface-raised p-6 shadow-[0_20px_60px_var(--appshadow)]"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-apptext-muted">
          Floor plan
        </p>
        <h3 className="mt-2 text-lg font-semibold text-apptext">Divide {roomLabel}</h3>
        <p className="mt-2 text-sm leading-6 text-apptext-soft">
          This splits {roomLabel} in two along the line you drew, adding a new section to the map.
        </p>

        <div className="mt-4 rounded-xl border border-amber-300/25 bg-amber-300/10 px-3 py-2.5 text-xs leading-5 text-amber-200">
          <span className="font-semibold">Experimental.</span> Dividing a room hasn’t been
          verified on this robot and <span className="font-semibold">can’t be cleanly undone</span>{' '}
          from here — if it goes wrong, re-merge or reset the map from the iRobot app.
        </div>

        {!status && (
          <label className="mt-4 flex items-start gap-2 text-xs text-apptext-soft">
            <input
              type="checkbox"
              checked={ack}
              onChange={(e) => setAck(e.target.checked)}
              className="mt-0.5"
            />
            I understand this is experimental and may not be reversible.
          </label>
        )}

        {status && (
          <div
            className={`mt-4 rounded-xl border px-3 py-2.5 text-xs ${
              status === 'OK'
                ? 'border-emerald-300/25 bg-emerald-300/10 text-emerald-300'
                : status === 'FAILED'
                  ? 'border-rose-300/25 bg-rose-300/10 text-rose-300'
                  : 'border-amber-300/25 bg-amber-300/10 text-amber-300'
            }`}
          >
            {status === 'OK'
              ? 'Applied — the floor plan will update within a minute.'
              : status === 'FAILED'
                ? `The robot rejected the divide${queued?.detail ? `: ${queued.detail}` : '.'}`
                : 'Sending to the robot…'}
          </div>
        )}
        {mutation.isError && (
          <p className="mt-3 text-xs text-rose-300">Couldn’t queue the divide. Try again.</p>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-appborder bg-appinset px-4 py-2 text-sm font-medium text-apptext-soft transition-colors hover:bg-appinset-strong"
          >
            {status === 'OK' ? 'Done' : 'Cancel'}
          </button>
          {status !== 'OK' && (
            <button
              type="button"
              disabled={!ack || submitting}
              onClick={() => mutation.mutate()}
              className="rounded-xl border border-amber-300/30 bg-amber-300/15 px-4 py-2 text-sm font-semibold text-amber-200 transition-colors hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? 'Dividing…' : 'Divide room'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
