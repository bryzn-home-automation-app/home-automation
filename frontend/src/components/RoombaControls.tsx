import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { sendRoombaCommand, fetchRoombaCommands } from '../api/roomba';
import { useJitteredInterval } from '../hooks/useJitteredInterval';
import type { RoombaStatus } from '../types';

const BUTTONS: { command: string; label: string; icon: string }[] = [
  { command: 'start', label: 'Clean', icon: '▶' },
  { command: 'pause', label: 'Pause', icon: '⏸' },
  { command: 'resume', label: 'Resume', icon: '⏵' },
  { command: 'stop', label: 'Stop', icon: '⏹' },
  { command: 'dock', label: 'Dock', icon: '⏏' },
  { command: 'find', label: 'Locate', icon: '🔊' },
];

function statusTone(s: string): string {
  switch (s) {
    case 'OK':
      return 'text-emerald-300';
    case 'FAILED':
      return 'text-rose-300';
    case 'SENT':
      return 'text-amber-300';
    default:
      return 'text-apptext-muted';
  }
}

/** ADMIN-only control panel. Commands are queued server-side; the poller executes them. */
export default function RoombaControls({ status }: { status: RoombaStatus | null }) {
  const qc = useQueryClient();
  const [note, setNote] = useState<string | null>(null);
  const commandsInterval = useJitteredInterval(8000);

  const commandsQuery = useQuery({
    queryKey: ['roomba', 'commands'],
    queryFn: fetchRoombaCommands,
    refetchInterval: commandsInterval,
    refetchIntervalInBackground: false,
  });

  const mutation = useMutation({
    mutationFn: (command: string) => sendRoombaCommand(command),
    onSuccess: (cmd) => {
      setNote(`"${cmd.command}" sent — the robot may take a few seconds to respond.`);
      qc.invalidateQueries({ queryKey: ['roomba', 'commands'] });
    },
    onError: () => setNote('Command failed to send.'),
  });

  const last = (commandsQuery.data ?? [])[0];
  const offline = status != null && !status.online;

  return (
    <section className="rounded-[28px] border border-appborder bg-appsurface-raised p-5 shadow-[0_10px_28px_var(--appshadow)] sm:p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-apptext-muted">Admin</p>
          <h3 className="mt-2 text-lg font-semibold text-apptext">Controls</h3>
        </div>
        {last && (
          <span className={`text-xs font-medium ${statusTone(last.status)}`}>
            {last.command} · {last.status}
          </span>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {BUTTONS.map((b) => (
          <button
            key={b.command}
            type="button"
            disabled={mutation.isPending || offline}
            onClick={() => mutation.mutate(b.command)}
            className="flex flex-col items-center gap-1 rounded-2xl border border-appborder bg-appinset px-3 py-3 text-xs font-medium text-apptext-soft transition-colors hover:border-appborder-hover hover:bg-appinset-strong disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span className="text-lg leading-none">{b.icon}</span>
            {b.label}
          </button>
        ))}
      </div>

      <p className="mt-3 text-[11px] text-apptext-dim">
        {offline
          ? 'Robot is offline — commands are disabled until it checks in.'
          : 'A “sent” command was accepted by the robot, not guaranteed to run — watch the status to confirm.'}
      </p>
      {note && <p className="mt-2 text-xs text-apptext-muted">{note}</p>}
    </section>
  );
}
