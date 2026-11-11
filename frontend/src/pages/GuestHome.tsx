import { useMemo, useState } from 'react';
import axios from 'axios';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import type { AdminUser } from '../api/auth';
import { useJitteredInterval } from '../hooks/useJitteredInterval';
import {
  Badge,
  Button,
  Dialog,
  InstrumentPanel,
  KeyValue,
  KV,
  Lamp,
  LinkButton,
  Notice,
  Panel,
  QueryState,
  Readout,
  Readouts,
  SkelRows,
  Verdict,
  EmptyState,
  cx,
  knobs,
} from '../components/ui';
import { formatList, formatTime } from '../utils/format';
import { roleLabel, type Tone } from '../utils/status';
import DoorFrame from './door/DoorFrame';
import VisitorBadge from './guest/VisitorBadge';
import chickenPng from '../../images/animals/chicken.png';
import raccoonPng from '../../images/animals/raccoon.png';
import dinoPng from '../../images/animals/dino.png';
import horsePng from '../../images/animals/horse.png';
import sheepPng from '../../images/animals/sheep.png';
import foxPng from '../../images/animals/fox.png';
import pigPng from '../../images/animals/pig.png';
import koalaPng from '../../images/animals/koala.png';
import birdPng from '../../images/animals/bird.png';
import bunnyPng from '../../images/animals/bunny.png';
import hedgehogPng from '../../images/animals/hedgehog.png';
import cowPng from '../../images/animals/cow.png';
import chickPng from '../../images/animals/chick.png';
import bearPng from '../../images/animals/bear.png';
import dogPng from '../../images/animals/dog.png';

/*
 * The guest lobby (/guest/home): who's at the house, for a visitor who just checked in. Every
 * person is real, from /auth/users (B-032: the room used to be padded with made-up "Guest 7" …
 * "Guest 15" shown as online). Each keeps their lobby animal (Bryan is always the chicken).
 * The visitor's session stays in sessionStorage and rides on this page's own request: the
 * shared sign-in key is never touched, so trying the lobby in a family member's browser can't
 * swap their sign-in for the guest's (B-165).
 */

type AnimalDef = { key: string; label: string; image: string };

const ANIMALS: AnimalDef[] = [
  { key: 'chicken', label: 'Chicken', image: chickenPng },
  { key: 'raccoon', label: 'Raccoon', image: raccoonPng },
  { key: 'dino', label: 'Dinosaur', image: dinoPng },
  { key: 'horse', label: 'Horse', image: horsePng },
  { key: 'sheep', label: 'Sheep', image: sheepPng },
  { key: 'fox', label: 'Fox', image: foxPng },
  { key: 'pig', label: 'Pig', image: pigPng },
  { key: 'koala', label: 'Koala', image: koalaPng },
  { key: 'bird', label: 'Blue bird', image: birdPng },
  { key: 'bunny', label: 'Bunny', image: bunnyPng },
  { key: 'hedgehog', label: 'Hedgehog', image: hedgehogPng },
  { key: 'cow', label: 'Cow', image: cowPng },
  { key: 'chick', label: 'Chick', image: chickPng },
  { key: 'bear', label: 'Bear', image: bearPng },
  { key: 'dog', label: 'Dog', image: dogPng },
];

const ROLE_ORDER: Record<string, number> = { ADMIN: 0, USER: 1, GUEST: 2 };

function getDisplayName(user: AdminUser): string {
  return user.displayName || user.username;
}

function hashStringToInt(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function isBryanAdmin(user: AdminUser): boolean {
  const text = `${user.displayName || ''} ${user.username || ''} ${user.email || ''}`.toLowerCase();
  return user.role === 'ADMIN' && text.includes('bryan');
}

/**
 * Each person's lobby animal: the same one every visit (a hash of who they are), no two alike
 * while there are animals to go round, and Bryan is always the chicken.
 */
export function lobbyAnimals(users: readonly AdminUser[]): Map<number, AnimalDef> {
  const map = new Map<number, AnimalDef>();
  const used = new Set<number>();
  const chickenIndex = ANIMALS.findIndex((a) => a.key === 'chicken');
  const bryan = users.find(isBryanAdmin);
  if (bryan && chickenIndex >= 0) {
    used.add(chickenIndex);
    map.set(bryan.id, ANIMALS[chickenIndex]);
  }
  users.forEach((user) => {
    if (map.has(user.id)) return;
    const preferred = hashStringToInt(`${user.id}:${user.username}:${user.email}`) % ANIMALS.length;
    let chosen = preferred;
    for (let i = 0; i < ANIMALS.length; i += 1) {
      const candidate = (preferred + i) % ANIMALS.length;
      if (!used.has(candidate)) {
        chosen = candidate;
        break;
      }
    }
    used.add(chosen);
    map.set(user.id, ANIMALS[chosen]);
  });
  return map;
}

/** The household in lobby order: admins, members, guests; online first within each. */
export function lobbyOrder(users: readonly AdminUser[]): AdminUser[] {
  return [...users].sort((a, b) =>
    (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9) || Number(b.isOnline) - Number(a.isOnline) || a.id - b.id,
  );
}

// A person in the lobby is online in the app or not; being away isn't a problem.
const PRESENCE: Record<'on' | 'off', { tone: Tone; label: string }> = {
  on: { tone: 'ok', label: 'Online now' },
  off: { tone: 'neutral', label: 'Away right now' },
};

function readSession(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

export default function GuestHome() {
  const guestName = readSession('guestName') || 'Guest';
  const guestToken = readSession('guestToken');
  const guestAccent = readSession('guestAccent') || '#A855F7';
  const guestAvatar = readSession('guestAvatar') || null;
  const lobbyInterval = useJitteredInterval(30_000);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const usersQuery = useQuery({
    queryKey: ['all-users-guest-lobby', guestToken],
    queryFn: async () => {
      const { data } = await axios.get<AdminUser[]>('/api/auth/users', {
        headers: { Authorization: `Bearer ${guestToken}` },
        timeout: 30_000,
      });
      return data;
    },
    enabled: !!guestToken,
    staleTime: 25_000,
    refetchInterval: lobbyInterval,
    refetchIntervalInBackground: false,
    // A pass that has ended won't come back by retrying.
    retry: (count, err) => !isSignedOut(err) && count < 2,
  });

  const users = useMemo(() => lobbyOrder(usersQuery.data ?? []), [usersQuery.data]);
  const animals = useMemo(() => lobbyAnimals(users), [users]);
  const selected = users.find((u) => u.id === selectedId) ?? null;

  const foot = <>Live here? <Link className="fp-link text-apptext" to="/login">Sign in instead</Link></>;

  // No guest session in this tab: nothing to show but the way in (B-032).
  if (!guestToken) {
    return (
      <DoorFrame foot={foot} center>
        <Panel className="flex w-[min(100%,440px)] flex-col gap-4">
          <p className="fp-label">Guest welcome</p>
          <h1 className="text-title font-semibold text-apptext">Check in first</h1>
          <p className="fp-muted">The lobby shows who’s at the house once you’ve checked in as a guest with the code from your host.</p>
          <LinkButton to="/guest" variant="primary" size="lg" block icon="log-in">Check in as a guest</LinkButton>
        </Panel>
      </DoorFrame>
    );
  }

  const online = users.filter((u) => u.isOnline);
  const onlineNames = online.map(getDisplayName);
  const loaded = usersQuery.data !== undefined;
  const passEnded = usersQuery.isError && isSignedOut(usersQuery.error);

  return (
    <DoorFrame foot={foot}>
      <h1 className="fp-sr-only">Who’s at the house</h1>
      <InstrumentPanel
        instrument={
          <VisitorBadge
            label={`Visitor badge for ${guestName}`}
            name={guestName}
            color={guestAccent}
            photoUrl={guestAvatar}
            role={<><Lamp tone="ok" size="s" />Guest at the house</>}
            foot={[['Guest pass', 'Lasts 30 days from check-in']]}
          />
        }
        verdict={
          passEnded ? (
            <Verdict tone="headsup" note="Check in again with the code from your host.">Your guest pass has ended.</Verdict>
          ) : (
            <Verdict
              tone={loaded ? 'ok' : 'neutral'}
              note={loaded ? (online.length ? `${formatList(onlineNames)} ${online.length === 1 ? 'is' : 'are'} on the app right now.` : 'Nobody else is on the app right now.') : 'Looking for who’s around…'}
            >
              You’re in, {guestName}.
            </Verdict>
          )
        }
        readouts={
          loaded ? (
            <Readouts count={2}>
              <Readout label="Online now" value={online.length} unit={online.length === 1 ? 'person' : 'people'} tone={online.length ? 'ok' : 'neutral'} />
              <Readout label="Household" value={users.length} unit={users.length === 1 ? 'person' : 'people'} note="Everyone with the app" />
            </Readouts>
          ) : undefined
        }
      >
        {passEnded && <LinkButton to="/guest" variant="primary" size="lg" block icon="log-in">Check in again</LinkButton>}
      </InstrumentPanel>

      <Panel
        title="Who’s at the house"
        subtitle="Tap someone to see more"
        action={
          <Button size="sm" variant="quiet" icon="refresh" busy={usersQuery.isFetching} busyLabel="Refreshing…" onClick={() => usersQuery.refetch()}>
            Refresh
          </Button>
        }
        footer={usersQuery.dataUpdatedAt ? <span className="fp-mono fp-muted">Updated {formatTime(usersQuery.dataUpdatedAt)}</span> : undefined}
      >
        <QueryState
          query={usersQuery}
          what="who’s here"
          loading={<SkelRows count={3} />}
          error={passEnded ? <Notice tone="headsup" title="Your guest pass has ended.">Check in again to see who’s here.</Notice> : undefined}
          empty={<EmptyState icon="users" title="Nobody’s here yet" compact>People show up here once they have the house app.</EmptyState>}
        >
          {() => (
            <ul className="grid grid-cols-2 overflow-hidden rounded-well border-l border-t border-appborder sm:grid-cols-3 lg:grid-cols-4" aria-label="People at the house">
              {users.map((u) => {
                const p = PRESENCE[u.isOnline ? 'on' : 'off'];
                const animal = animals.get(u.id);
                return (
                  <li key={u.id} className="flex border-b border-r border-appborder">
                    <button
                      type="button"
                      onClick={() => setSelectedId(u.id)}
                      className="flex min-h-[var(--apptap)] w-full flex-col items-center gap-1.5 px-2 py-4 text-center hover:bg-[var(--approw-hover)] focus-visible:[outline-offset:-3px]"
                    >
                      <AnimalFace animal={animal} color={u.accentColor} away={!u.isOnline} />
                      <span className="w-full truncate font-semibold text-apptext">{getDisplayName(u)}</span>
                      <span className="flex items-center gap-1.5">
                        <Lamp tone={p.tone} />
                        <span className="fp-label">{u.isOnline ? 'Online' : 'Away'}</span>
                      </span>
                      <span className="fp-small fp-muted">{roleLabel(u.role)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </QueryState>
      </Panel>

      <Dialog
        open={selected != null}
        onClose={() => setSelectedId(null)}
        size="narrow"
        eyebrow="At the house"
        title={selected ? getDisplayName(selected) : ''}
      >
        {selected && (
          <div className="flex flex-col gap-4">
            <div className="fp-person">
              <AnimalFace animal={animals.get(selected.id)} color={selected.accentColor} away={!selected.isOnline} large />
              <div className="flex flex-col gap-1">
                <p className="fp-strong">{roleLabel(selected.role)}</p>
                <p className="fp-small fp-muted">Shown as the {animals.get(selected.id)?.label.toLowerCase() ?? 'animal'} in the lobby</p>
              </div>
            </div>
            <KeyValue>
              <KV label="In the app" value={<Badge tone={PRESENCE[selected.isOnline ? 'on' : 'off'].tone}>{PRESENCE[selected.isOnline ? 'on' : 'off'].label}</Badge>} />
            </KeyValue>
          </div>
        )}
      </Dialog>
    </DoorFrame>
  );
}

/** A 401/403: the guest's pass has ended or was revoked. */
function isSignedOut(err: unknown): boolean {
  const status = (err as { response?: { status?: number } } | null)?.response?.status;
  return status === 401 || status === 403;
}

/** The person's lobby animal on a disc in their own colour (a hollow ring while away). */
function AnimalFace({ animal, color, away, large }: { animal?: AnimalDef; color: string | null; away?: boolean; large?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        'grid flex-none place-items-center rounded-full',
        large ? 'h-[72px] w-[72px]' : 'h-16 w-16',
        away ? 'bg-appinset shadow-[inset_0_0_0_2px_var(--fp-who)]' : 'bg-[color-mix(in_srgb,var(--fp-who)_28%,var(--appsurface))]',
      )}
      style={knobs({ '--fp-who': color || 'var(--appavatar-default)' })}
    >
      {animal && <img src={animal.image} alt="" className={cx('h-[86%] w-[86%] object-contain', away && 'opacity-60')} draggable={false} />}
    </span>
  );
}

