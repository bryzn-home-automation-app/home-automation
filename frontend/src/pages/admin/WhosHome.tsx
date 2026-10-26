import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchPresence, labelDevice } from '../../api/presence';
import { errorMessage } from '../../api/climate';
import { FOCUS_RING } from '../../components/ThermostatControls';
import { useJitteredInterval } from '../../hooks/useJitteredInterval';
import { ago } from '../../utils/cameras';
import type { PresenceDevice, PresencePerson } from '../../types';

const INPUT = `h-10 w-full rounded-xl border border-appborder bg-appinset px-3 text-sm text-apptext placeholder:text-apptext-dim ${FOCUS_RING}`;
const BUTTON = `h-9 rounded-lg px-3 text-xs font-semibold transition-colors disabled:opacity-50 ${FOCUS_RING}`;

/** "5:42 PM" today, else "Oct 24, 5:42 PM". */
function clock(iso: string): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString()
    ? time
    : `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${time}`;
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <section className="rounded-[24px] border border-appborder bg-appsurface-raised p-4 shadow-[0_10px_28px_var(--appshadow)] sm:p-5">
      {children}
    </section>
  );
}

/** Home / Away / Unknown, always as words beside the dot. */
function Status({ home, children }: { home: boolean | null; children?: React.ReactNode }) {
  const dot = home === true ? 'bg-appsuccess' : home === false ? 'bg-apptext-dim' : 'bg-appwarning';
  const text = home === true ? 'text-apptext-success' : home === false ? 'text-apptext-muted' : 'text-apptext-warning';
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${text}`}>
      <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} aria-hidden="true" />
      {children}
    </span>
  );
}

function PersonCard({ p }: { p: PresencePerson }) {
  return (
    <Card>
      <h3 className="truncate text-base font-semibold text-apptext">{p.name}</h3>
      <div className="mt-1.5">
        {p.home === true ? (
          <Status home>Home{p.since ? ` since ${clock(p.since)}` : ''}</Status>
        ) : p.home === false ? (
          <Status home={false}>Away{p.lastSeen ? ` · last seen ${ago(p.lastSeen)}` : ''}</Status>
        ) : (
          <Status home={null}>Unknown — scanner offline</Status>
        )}
      </div>
      <p className="mt-1 text-2xs text-apptext-muted">
        {p.devices} device{p.devices === 1 ? '' : 's'}
      </p>
    </Card>
  );
}

function DeviceRow({ d, people }: { d: PresenceDevice; people: string[] }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(d.label ?? '');
  const [person, setPerson] = useState(d.person ?? '');
  const save = useMutation({
    mutationFn: () => labelDevice(d.id, label, person),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin-presence'] });
      setEditing(false);
    },
  });

  const seen =
    d.home === true ? `On Wi-Fi now · since ${clock(d.presentSince)}` : `Last seen ${ago(d.lastSeen) || clock(d.lastSeen)}`;

  return (
    <li className="border-t border-appborder py-3 first:border-t-0 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-apptext">
            {d.label || <span className="font-medium text-apptext-muted">Unnamed device</span>}
            {d.person && <span className="ml-2 text-xs font-medium text-apptext-muted">· {d.person}</span>}
          </p>
          <p className="mt-0.5 font-mono text-2xs text-apptext-muted">
            {d.mac}
            {d.ip ? ` · ${d.ip}` : ''}
          </p>
          {d.privateAddress && !d.label && (
            <p className="mt-0.5 text-2xs text-apptext-info">Private address — likely a phone, tablet or watch</p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <Status home={d.home}>{d.home === null ? 'Unknown' : seen}</Status>
          {!editing && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className={`${BUTTON} border border-appborder bg-appinset text-apptext-soft hover:bg-appinset-strong`}
            >
              {d.label || d.person ? 'Edit' : 'Label'}
            </button>
          )}
        </div>
      </div>
      {editing && (
        <form
          className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,12rem)_auto] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <label className="text-2xs font-medium text-apptext-muted">
            Device
            <input className={`${INPUT} mt-1`} value={label} maxLength={60} placeholder="Bryan's iPhone"
              onChange={(e) => setLabel(e.target.value)} autoFocus />
          </label>
          <label className="text-2xs font-medium text-apptext-muted">
            Whose (counts them as home)
            <input className={`${INPUT} mt-1`} value={person} maxLength={40} placeholder="Bryan" list="presence-people"
              onChange={(e) => setPerson(e.target.value)} />
          </label>
          <div className="flex gap-2">
            <button type="submit" disabled={save.isPending}
              className={`${BUTTON} h-10 border border-appaccent-border bg-appaccent-soft text-appaccent-text`}>
              {save.isPending ? 'Saving…' : 'Save'}
            </button>
            <button type="button" onClick={() => { setEditing(false); setLabel(d.label ?? ''); setPerson(d.person ?? ''); }}
              className={`${BUTTON} h-10 border border-appborder bg-appinset text-apptext-soft hover:bg-appinset-strong`}>
              Cancel
            </button>
          </div>
          {save.isError && (
            <p role="alert" className="text-xs text-apptext-danger sm:col-span-3">{errorMessage(save.error, 'Couldn’t save')}</p>
          )}
          <datalist id="presence-people">
            {people.map((p) => <option key={p} value={p} />)}
          </datalist>
        </form>
      )}
    </li>
  );
}

/**
 * Admin → Who's home. The NUC lists the devices on the home Wi-Fi every minute; label
 * the household's phones with whose they are, and each person shows as home while one
 * of their devices was seen recently.
 */
export default function WhosHome() {
  const refreshInterval = useJitteredInterval(60_000);
  const query = useQuery({
    queryKey: ['admin-presence'],
    queryFn: fetchPresence,
    staleTime: 30_000,
    refetchInterval: refreshInterval,
    refetchIntervalInBackground: false,
    placeholderData: keepPreviousData,
  });
  const data = query.data;
  const [showAll, setShowAll] = useState(false);

  if (query.isLoading) return <div className="h-40 animate-pulse rounded-[24px] bg-appinset" />;
  if (query.isError || !data) {
    return (
      <Card>
        <p className="text-sm text-apptext">Couldn't load who's home: {errorMessage(query.error)}</p>
      </Card>
    );
  }

  const { scanner } = data;
  const named = data.devices.filter((d) => d.label || d.person);
  const others = data.devices.filter((d) => !d.label && !d.person);
  const othersShown = showAll ? others : others.filter((d) => d.home !== false);
  const people = data.people.map((p) => p.name);

  return (
    <div className="flex flex-col gap-4 lg:gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-xs text-apptext-muted">
          The NUC checks which devices are on the home Wi-Fi every minute. Label each person's phone below; they show as
          home while it's been seen in the last {data.awayAfterMinutes} minutes (sleeping phones skip some checks).
        </p>
        {scanner.lastScanAt == null ? (
          <Status home={null}>Scanner not set up</Status>
        ) : scanner.online ? (
          <Status home>
            Checked {ago(scanner.lastScanAt)} · {scanner.devicesInLastScan} on Wi-Fi
          </Status>
        ) : (
          <Status home={null}>Scanner offline · last check {ago(scanner.lastScanAt)}</Status>
        )}
      </div>

      {data.people.length > 0 ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 lg:gap-4">
          {data.people.map((p) => <PersonCard key={p.name} p={p} />)}
        </div>
      ) : (
        <Card>
          <p className="text-sm text-apptext">Nobody's set up yet.</p>
          <p className="mt-1 text-xs text-apptext-muted">
            Find each phone below and fill in whose it is. Phones usually show “Private address”. To spot yours, turn its
            Wi-Fi off for a few minutes: the one that goes from “On Wi-Fi now” to “Last seen” is it.
          </p>
        </Card>
      )}

      {named.length > 0 && (
        <Card>
          <h3 className="mb-3 text-sm font-semibold text-apptext">Labeled devices</h3>
          <ul>{named.map((d) => <DeviceRow key={d.id} d={d} people={people} />)}</ul>
        </Card>
      )}

      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-apptext">
            Other devices <span className="font-medium text-apptext-muted">· {others.length}</span>
          </h3>
          <label className="inline-flex items-center gap-2 text-xs text-apptext-muted">
            <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)}
              className="h-4 w-4 accent-[var(--appaccent)]" />
            Include ones not on Wi-Fi now
          </label>
        </div>
        {othersShown.length ? (
          <ul>{othersShown.map((d) => <DeviceRow key={d.id} d={d} people={people} />)}</ul>
        ) : (
          <p className="text-xs text-apptext-muted">No other devices{showAll ? '' : ' on Wi-Fi right now'}.</p>
        )}
      </Card>
    </div>
  );
}
