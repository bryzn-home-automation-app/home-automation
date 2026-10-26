import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchPresence, labelDevice } from '../../api/presence';
import { errorMessage } from '../../api/climate';
import { FOCUS_RING } from '../../components/ThermostatControls';
import { useJitteredInterval } from '../../hooks/useJitteredInterval';
import { ago } from '../../utils/cameras';
import type { DeviceType, Presence, PresenceDevice, PresencePerson } from '../../types';

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

function PersonCard({ p, online }: { p: PresencePerson; online: boolean }) {
  return (
    <Card>
      <h3 className="truncate text-base font-semibold text-apptext">{p.name}</h3>
      <div className="mt-1.5">
        {p.home === true ? (
          <Status home>Home{p.since ? ` since ${clock(p.since)}` : ''}</Status>
        ) : p.home === false ? (
          <Status home={false}>Away{p.lastSeen ? ` · last seen ${ago(p.lastSeen)}` : ''}</Status>
        ) : online ? (
          <Status home={null}>Unknown — no mobile or watch</Status>
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

const DEVICE_TYPES: Array<{ value: DeviceType; label: string }> = [
  { value: 'MOBILE', label: 'Mobile' },
  { value: 'COMPUTER', label: 'Computer' },
  { value: 'TABLET', label: 'Tablet' },
  { value: 'WATCH', label: 'Watch' },
  { value: 'TV', label: 'TV' },
  { value: 'SMART_HOME', label: 'Smart home' },
  { value: 'OTHER', label: 'Other' },
];
const typeLabel = (t: DeviceType | null) => DEVICE_TYPES.find((x) => x.value === t)?.label ?? null;

type Member = Presence['members'][number];

function DeviceRow({ d, members }: { d: PresenceDevice; members: Member[] }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  // A phone-style private address is most likely a phone, so start there.
  const initialType = d.type ?? (d.privateAddress ? 'MOBILE' : '');
  const [name, setName] = useState(d.name ?? '');
  const [type, setType] = useState<DeviceType | ''>(initialType);
  const [owner, setOwner] = useState(d.ownerUserId != null ? String(d.ownerUserId) : '');
  const reset = () => {
    setName(d.name ?? '');
    setType(initialType);
    setOwner(d.ownerUserId != null ? String(d.ownerUserId) : '');
  };
  const save = useMutation({
    mutationFn: () => labelDevice(d.id, name, type || null, owner ? Number(owner) : null),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin-presence'] });
      setEditing(false);
    },
  });

  const seen =
    d.home === true ? `On Wi-Fi now · since ${clock(d.presentSince)}` : `Last seen ${ago(d.lastSeen) || clock(d.lastSeen)}`;
  const details = [typeLabel(d.type), d.owner].filter(Boolean).join(' · ');
  const labeled = d.name || d.type || d.ownerUserId != null;
  const countsTowardHome = type === 'MOBILE' || type === 'WATCH';

  return (
    <li className="border-t border-appborder py-3 first:border-t-0 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1.5">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-apptext">
            {d.name || <span className="font-medium text-apptext-muted">Unnamed device</span>}
            {details && <span className="ml-2 text-xs font-medium text-apptext-muted">· {details}</span>}
          </p>
          <p className="mt-0.5 font-mono text-2xs text-apptext-muted">
            {d.mac}
            {d.ip ? ` · ${d.ip}` : ''}
          </p>
          {d.privateAddress && !labeled && (
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
              {labeled ? 'Edit' : 'Label'}
            </button>
          )}
        </div>
      </div>
      {editing && (
        <form
          className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,9rem)_minmax(0,10rem)_auto] sm:items-end"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <label className="text-2xs font-medium text-apptext-muted">
            Name
            <input className={`${INPUT} mt-1`} value={name} maxLength={60} placeholder="Bryan's iPhone"
              onChange={(e) => setName(e.target.value)} autoFocus />
          </label>
          <label className="text-2xs font-medium text-apptext-muted">
            Type
            <select className={`${INPUT} mt-1`} value={type} onChange={(e) => setType(e.target.value as DeviceType | '')}>
              <option value="">Not set</option>
              {DEVICE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </label>
          <label className="text-2xs font-medium text-apptext-muted">
            Owner
            <select className={`${INPUT} mt-1`} value={owner} onChange={(e) => setOwner(e.target.value)}>
              <option value="">Nobody</option>
              {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </label>
          <div className="flex gap-2">
            <button type="submit" disabled={save.isPending}
              className={`${BUTTON} h-10 border border-appaccent-border bg-appaccent-soft text-appaccent-text`}>
              {save.isPending ? 'Saving…' : 'Save'}
            </button>
            <button type="button" onClick={() => { setEditing(false); reset(); }}
              className={`${BUTTON} h-10 border border-appborder bg-appinset text-apptext-soft hover:bg-appinset-strong`}>
              Cancel
            </button>
          </div>
          {owner && !countsTowardHome && (
            <p className="text-2xs text-apptext-muted sm:col-span-4">
              Only mobiles and watches count toward their owner being home; a {typeLabel(type || null)?.toLowerCase() ?? 'device with no type'} stays
              home when they leave.
            </p>
          )}
          {save.isError && (
            <p role="alert" className="text-xs text-apptext-danger sm:col-span-4">{errorMessage(save.error, 'Couldn’t save')}</p>
          )}
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
  const isLabeled = (d: PresenceDevice) => d.name || d.type || d.ownerUserId != null;
  const named = data.devices.filter(isLabeled);
  const others = data.devices.filter((d) => !isLabeled(d));
  const othersShown = showAll ? others : others.filter((d) => d.home !== false);

  return (
    <div className="flex flex-col gap-4 lg:gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-xs text-apptext-muted">
          The NUC checks which devices are on the home Wi-Fi every minute. Label each member's phone below; they show as
          home while their mobile or watch has been seen in the last {data.awayAfterMinutes} minutes (sleeping phones skip
          some checks).
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
          {data.people.map((p) => <PersonCard key={p.userId} p={p} online={scanner.online} />)}
        </div>
      ) : (
        <Card>
          <p className="text-sm text-apptext">Nobody's set up yet.</p>
          <p className="mt-1 text-xs text-apptext-muted">
            Easiest: each member opens Profile → This device on their phone and taps Link this device. Or find each
            phone below, set its type to Mobile and pick its owner. Phones usually show “Private address”. To spot yours, turn its
            Wi-Fi off for a few minutes: the one that goes from “On Wi-Fi now” to “Last seen” is it.
          </p>
        </Card>
      )}

      {named.length > 0 && (
        <Card>
          <h3 className="mb-3 text-sm font-semibold text-apptext">Labeled devices</h3>
          <ul>{named.map((d) => <DeviceRow key={d.id} d={d} members={data.members} />)}</ul>
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
          <ul>{othersShown.map((d) => <DeviceRow key={d.id} d={d} members={data.members} />)}</ul>
        ) : (
          <p className="text-xs text-apptext-muted">No other devices{showAll ? '' : ' on Wi-Fi right now'}.</p>
        )}
      </Card>
    </div>
  );
}
