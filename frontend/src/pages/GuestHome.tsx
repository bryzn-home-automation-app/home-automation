import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import type { PanInfo } from 'framer-motion';
import { fetchAllUsers, type AdminUser } from '../api/auth';
import { jitteredInterval } from '../hooks/useJitteredInterval';
import webBackgroundImage from '../../images/web_guest_bg.png';
import mobileBackgroundImage from '../../images/mobile_guest_bg.png';
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

const TOKEN_KEY = 'auth_token';
const MOBILE_MEDIA_QUERY = '(max-width: 767px)';

type AnimalKey =
  | 'chicken'
  | 'raccoon'
  | 'dino'
  | 'horse'
  | 'sheep'
  | 'fox'
  | 'pig'
  | 'koala'
  | 'bird'
  | 'bunny'
  | 'hedgehog'
  | 'cow'
  | 'chick'
  | 'bear'
  | 'dog';

type AnimalDef = {
  key: AnimalKey;
  label: string;
  image: string;
};

type HangoutSpot = {
  name: string;
  x: number;
  y: number;
  scale: number;
};

type SceneLayout = {
  width: number;
  height: number;
  spots: HangoutSpot[];
};

type LobbyMember = {
  user: AdminUser;
  animal: AnimalDef;
  spot: HangoutSpot;
  slotIndex: number;
  activity: string;
  entryFrom: 'left' | 'right';
};

const ANIMALS: AnimalDef[] = [
  { key: 'chicken', label: 'Chicken', image: chickenPng },
  { key: 'raccoon', label: 'Raccoon', image: raccoonPng },
  { key: 'dino', label: 'Dinosaur', image: dinoPng },
  { key: 'horse', label: 'Horse', image: horsePng },
  { key: 'sheep', label: 'Sheep', image: sheepPng },
  { key: 'fox', label: 'Fox', image: foxPng },
  { key: 'pig', label: 'Pig', image: pigPng },
  { key: 'koala', label: 'Koala', image: koalaPng },
  { key: 'bird', label: 'Blue Bird', image: birdPng },
  { key: 'bunny', label: 'Bunny', image: bunnyPng },
  { key: 'hedgehog', label: 'Hedgehog', image: hedgehogPng },
  { key: 'cow', label: 'Cow', image: cowPng },
  { key: 'chick', label: 'Chick', image: chickPng },
  { key: 'bear', label: 'Bear', image: bearPng },
  { key: 'dog', label: 'Dog', image: dogPng },
];

const DESKTOP_SCENE: SceneLayout = {
  width: 1920,
  height: 1080,
  spots: [
    { name: 'left couch pillow', x: 469, y: 572, scale: 0.98 },
    { name: 'middle couch seat', x: 625, y: 549, scale: 1.0 },
    { name: 'right couch pillow', x: 824, y: 556, scale: 0.98 },
    { name: 'left floor by couch', x: 318, y: 719, scale: 1.04 },
    { name: 'lamp table', x: 1119, y: 509, scale: 0.92 },
    { name: 'floor under lamp', x: 936, y: 685, scale: 1.04 },
    { name: 'bean bag', x: 1438, y: 626, scale: 1.08 },
    { name: 'pizza box', x: 127, y: 853, scale: 1.08 },
    { name: 'rug left', x: 491, y: 830, scale: 1.12 },
    { name: 'rug center', x: 712, y: 850, scale: 1.12 },
    { name: 'rug right', x: 1004, y: 884, scale: 1.12 },
    { name: 'controller', x: 1188, y: 783, scale: 1.08 },
    { name: 'bean bag floor', x: 1410, y: 837, scale: 1.08 },
    { name: 'tv stand', x: 1658, y: 747, scale: 1.06 },
    { name: 'between couch and lamp', x: 1357, y: 225, scale: 0.86 },
  ],
};

const MOBILE_SCENE: SceneLayout = {
  width: 1080,
  height: 1920,
  spots: [
    { name: 'left couch', x: 390, y: 690, scale: 1.0 },
    { name: 'middle couch', x: 540, y: 665, scale: 1.0 },
    { name: 'right couch', x: 690, y: 690, scale: 1.0 },
    { name: 'left armrest', x: 300, y: 700, scale: 0.98 },
    { name: 'right armrest', x: 785, y: 700, scale: 0.98 },
    { name: 'top rug', x: 540, y: 980, scale: 1.07 },
    { name: 'upper left rug', x: 390, y: 1110, scale: 1.1 },
    { name: 'upper right rug', x: 690, y: 1110, scale: 1.1 },
    { name: 'center rug', x: 540, y: 1250, scale: 1.12 },
    { name: 'middle left rug', x: 390, y: 1375, scale: 1.14 },
    { name: 'middle right rug', x: 690, y: 1375, scale: 1.14 },
    { name: 'bottom left rug', x: 330, y: 1540, scale: 1.16 },
    { name: 'bottom center rug', x: 540, y: 1600, scale: 1.18 },
    { name: 'bottom right rug', x: 750, y: 1540, scale: 1.16 },
    { name: 'bean bag', x: 930, y: 810, scale: 1.05 },
  ],
};

const ACTIVITIES = [
  'playing games',
  'eating pizza',
  'watching TV',
  'chatting',
  'vibing',
  'snack break',
  'queueing co-op',
  'controller in hand',
  'hanging out',
];

const ROLE_ORDER: Record<string, number> = { ADMIN: 0, USER: 1, GUEST: 2 };

function mulberry32(seed: number) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), t | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleWithSeed<T>(items: T[], seed: number): T[] {
  const arr = [...items];
  const rand = mulberry32(seed);
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function getDisplayName(user: AdminUser): string {
  return user.displayName || user.username;
}

function roleLabel(role: string): string {
  if (role === 'ADMIN') return 'Homeowner';
  if (role === 'USER') return 'Household Member';
  return 'Guest';
}

function toPctX(x: number, sceneWidth: number): string {
  return `${(x / sceneWidth) * 100}%`;
}

function toPctY(y: number, sceneHeight: number): string {
  return `${(y / sceneHeight) * 100}%`;
}

function avatarBaseSize(spotName: string): number {
  const n = spotName.toLowerCase();
  if (n.includes('couch') || n.includes('armrest')) return 148;
  if (n.includes('bean')) return 164;
  if (n.includes('rug')) return 156;
  if (n.includes('pizza') || n.includes('drink') || n.includes('controller')) return 160;
  return 152;
}

function hashStringToInt(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function stableAnimalIndexForUser(user: AdminUser): number {
  const key = `${user.id}:${user.username}:${user.email}`;
  return hashStringToInt(key) % ANIMALS.length;
}

function isBryanAdmin(user: AdminUser): boolean {
  const text = `${user.displayName || ''} ${user.username || ''} ${user.email || ''}`.toLowerCase();
  return user.role === 'ADMIN' && text.includes('bryan');
}

function buildUniqueAnimalMap(users: AdminUser[]): Map<number, AnimalDef> {
  const map = new Map<number, AnimalDef>();
  const used = new Set<number>();
  const chickenIndex = ANIMALS.findIndex((animal) => animal.key === 'chicken');

  // Priority override: Bryan admin is always the chicken.
  const bryanAdmin = users.find((user) => isBryanAdmin(user));
  if (bryanAdmin && chickenIndex >= 0) {
    used.add(chickenIndex);
    map.set(bryanAdmin.id, ANIMALS[chickenIndex]);
  }

  users.forEach((user) => {
    if (map.has(user.id)) return;
    const preferred = stableAnimalIndexForUser(user);
    let chosen = preferred;

    // Keep each visible user unique by probing for next available animal.
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

function createLobbyMembers(users: AdminUser[], seed: number, spots: HangoutSpot[]): LobbyMember[] {
  const sorted = [...users].sort((a, b) => {
    const roleSort = (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9);
    if (roleSort !== 0) return roleSort;
    return a.id - b.id;
  });

  const rand = mulberry32(seed + 151);
  const activityPool = shuffleWithSeed(ACTIVITIES, seed + 93);
  const uniqueAnimalMap = buildUniqueAnimalMap(sorted.slice(0, spots.length));

  return sorted.slice(0, spots.length).map((user, index) => ({
    user,
    animal: uniqueAnimalMap.get(user.id) || ANIMALS[index % ANIMALS.length],
    spot: spots[index],
    slotIndex: index,
    activity: activityPool[index % activityPool.length],
    entryFrom: rand() > 0.5 ? 'left' : 'right',
  }));
}

function cloneSpots(spots: HangoutSpot[]): HangoutSpot[] {
  return spots.map((spot) => ({ ...spot }));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function formatLayoutSnapshot(title: string, width: number, height: number, spots: HangoutSpot[]): string {
  const header = `# ${title} (${width}x${height})`;
  const tableHeader = '| Slot | Area | X | Y |';
  const tableRule = '| --- | --- | ---: | ---: |';
  const rows = spots.map((spot, index) => `| ${index + 1} | ${spot.name} | ${Math.round(spot.x)} | ${Math.round(spot.y)} |`);
  return [header, '', tableHeader, tableRule, ...rows].join('\n');
}

function fillUsersToSlotCount(users: AdminUser[], fallbackGuest: AdminUser, slotCount: number): AdminUser[] {
  if (users.length >= slotCount) return users.slice(0, slotCount);

  const filled = [...users];
  for (let i = users.length; i < slotCount; i += 1) {
    filled.push({
      ...fallbackGuest,
      id: -(i + 1),
      username: `guest-${i + 1}`,
      displayName: `Guest ${i + 1}`,
      isOnline: true,
    });
  }

  return filled;
}

function useIsMobileScene() {
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia(MOBILE_MEDIA_QUERY).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const media = window.matchMedia(MOBILE_MEDIA_QUERY);
    const onChange = (event: MediaQueryListEvent) => setIsMobile(event.matches);
    setIsMobile(media.matches);

    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', onChange);
      return () => media.removeEventListener('change', onChange);
    }

    media.addListener(onChange);
    return () => media.removeListener(onChange);
  }, []);

  return isMobile;
}

function LobbyAvatar({
  member,
  index,
  sceneSeed,
  sceneWidth,
  sceneHeight,
  editMode,
  onMove,
  onSelect,
}: {
  member: LobbyMember;
  index: number;
  sceneSeed: number;
  sceneWidth: number;
  sceneHeight: number;
  editMode: boolean;
  onMove: (slotIndex: number, dxPx: number, dyPx: number) => void;
  onSelect: (member: LobbyMember) => void;
}) {
  const displayName = getDisplayName(member.user);
  const zLayer = Math.round(member.spot.y) + 200;
  const baseSize = avatarBaseSize(member.spot.name) * member.spot.scale;
  const idleTransition = { type: 'spring' as const, stiffness: 150, damping: 16, delay: index * 0.04 };
  const editTransition = { duration: 0 };

  return (
    <motion.div
      className="absolute"
      style={{ left: toPctX(member.spot.x, sceneWidth), top: toPctY(member.spot.y, sceneHeight), zIndex: zLayer }}
      initial={{
        opacity: 0,
        x: member.entryFrom === 'left' ? -240 : 240,
        y: 14,
        scale: 0.82,
      }}
      animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
      exit={{
        opacity: 0,
        x: member.entryFrom === 'left' ? 240 : -240,
        y: 14,
        scale: 0.82,
      }}
      transition={editMode ? editTransition : idleTransition}
      drag={editMode}
      dragMomentum={false}
      dragElastic={0}
      onDragEnd={(_, info: PanInfo) => onMove(member.slotIndex, info.offset.x, info.offset.y)}
    >
      <motion.button
        type="button"
        onClick={() => onSelect(member)}
        className="group relative flex -translate-x-1/2 -translate-y-1/2 flex-col items-center"
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.96 }}
      >
        <motion.img
          src={member.animal.image}
          alt={`${member.animal.label} avatar for ${displayName}`}
          className="relative z-10 select-none object-contain"
          style={{ width: `${baseSize}px`, height: `${baseSize}px` }}
          animate={editMode ? { y: 0, rotate: 0, scaleY: 1 } : { y: [0, -3, 0], rotate: [0, 0, 1.5, 0, -1.5, 0], scaleY: [1, 1, 0.9, 1, 1, 1] }}
          transition={
            editMode
              ? { duration: 0 }
              : {
                  repeat: Infinity,
                  duration: 5.9 + (index % 3) * 0.7,
                  times: [0, 0.34, 0.39, 0.44, 0.78, 1],
                  ease: 'easeInOut',
                }
          }
          draggable={false}
        />

        <p className="mt-1 rounded-full border border-black/10 bg-white/75 px-2.5 py-0.5 text-xs font-semibold text-slate-800">
          {displayName}
        </p>

        <div className="pointer-events-none absolute -top-12 left-1/2 z-20 w-max -translate-x-1/2 rounded-full border border-white/70 bg-white/92 px-2.5 py-1 text-[10px] text-slate-700 opacity-0 shadow transition-opacity duration-150 group-hover:opacity-100">
          {member.activity}
        </div>

        <div className="absolute inset-0 rounded-3xl opacity-0 blur-xl transition-opacity duration-200 group-hover:opacity-100" style={{ backgroundColor: 'rgba(255,255,255,0.45)' }} />
      </motion.button>

      {!editMode && (
        <motion.div
          key={`step-${sceneSeed}-${member.user.id}`}
          className="absolute left-1/2 top-[62%] h-0.5 -translate-x-1/2 rounded-full bg-white/85"
          style={{ width: `${baseSize * 0.24}px` }}
          initial={{ opacity: 0, x: member.entryFrom === 'left' ? -38 : 38 }}
          animate={{ opacity: [0, 0.8, 0], x: [member.entryFrom === 'left' ? -34 : 34, 0, member.entryFrom === 'left' ? 14 : -14] }}
          transition={{ duration: 0.75, ease: 'easeOut' }}
        />
      )}
    </motion.div>
  );
}

function ProfileCard({ selected, onClose }: { selected: LobbyMember; onClose: () => void }) {
  const displayName = getDisplayName(selected.user);

  return (
    <motion.div
      className="absolute inset-x-4 bottom-4 z-[999] rounded-3xl border border-amber-900/25 bg-white/92 p-4 shadow-[0_18px_42px_rgba(0,0,0,0.28)] backdrop-blur"
      initial={{ y: 32, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 32, opacity: 0 }}
      transition={{ duration: 0.2 }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <img src={selected.animal.image} alt={selected.animal.label} className="h-14 w-14 rounded-xl border border-white/70 bg-white object-contain" />
          <div>
            <p className="text-sm font-semibold text-slate-900">{displayName}</p>
            <p className="text-xs text-slate-600">{selected.animal.label} · {roleLabel(selected.user.role)}</p>
          </div>
        </div>
        <button type="button" onClick={onClose} className="rounded-full border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700">
          Close
        </button>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-slate-700">
          <p className="text-[10px] uppercase tracking-[0.14em] text-slate-500">Current Activity</p>
          <p className="mt-1">{selected.activity}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-slate-700">
          <p className="text-[10px] uppercase tracking-[0.14em] text-slate-500">Status</p>
          <p className="mt-1">{selected.user.isOnline ? 'Online now' : 'Away right now'}</p>
        </div>
      </div>
    </motion.div>
  );
}

export default function GuestHome() {
  const guestName = sessionStorage.getItem('guestName') || 'Guest';
  const guestToken = sessionStorage.getItem('guestToken');
  const [sceneSeed, setSceneSeed] = useState(() => Date.now());
  const [selected, setSelected] = useState<LobbyMember | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [snapshotStatus, setSnapshotStatus] = useState<string | null>(null);
  const isMobileScene = useIsMobileScene();
  const [desktopSpots, setDesktopSpots] = useState<HangoutSpot[]>(() => cloneSpots(DESKTOP_SCENE.spots));
  const [mobileSpots, setMobileSpots] = useState<HangoutSpot[]>(() => cloneSpots(MOBILE_SCENE.spots));
  const activeScene = useMemo<SceneLayout>(
    () => ({
      width: isMobileScene ? MOBILE_SCENE.width : DESKTOP_SCENE.width,
      height: isMobileScene ? MOBILE_SCENE.height : DESKTOP_SCENE.height,
      spots: isMobileScene ? mobileSpots : desktopSpots,
    }),
    [isMobileScene, mobileSpots, desktopSpots],
  );

  useEffect(() => {
    if (!guestToken) return;
    const previous = localStorage.getItem(TOKEN_KEY);
    localStorage.setItem(TOKEN_KEY, guestToken);
    return () => {
      if (previous) {
        localStorage.setItem(TOKEN_KEY, previous);
      } else {
        localStorage.removeItem(TOKEN_KEY);
      }
    };
  }, [guestToken]);

  const usersQuery = useQuery({
    queryKey: ['all-users-guest-lobby'],
    queryFn: fetchAllUsers,
    staleTime: 25_000,
    refetchInterval: jitteredInterval(30_000),
    refetchIntervalInBackground: false,
  });

  useEffect(() => {
    if (editMode) return;
    const timer = setInterval(() => {
      setSceneSeed(Date.now());
    }, 22000);
    return () => clearInterval(timer);
  }, [editMode]);

  const refreshScene = useCallback(() => {
    usersQuery.refetch();
    setSceneSeed(Date.now());
  }, [usersQuery]);

  const moveSpot = useCallback(
    (slotIndex: number, dxPx: number, dyPx: number) => {
      if (typeof window === 'undefined') return;
      const viewportWidth = Math.max(window.innerWidth, 1);
      const viewportHeight = Math.max(window.innerHeight, 1);
      const dxScene = (dxPx / viewportWidth) * activeScene.width;
      const dyScene = (dyPx / viewportHeight) * activeScene.height;

      const applyMove = (spots: HangoutSpot[]) =>
        spots.map((spot, index) => {
          if (index !== slotIndex) return spot;
          return {
            ...spot,
            x: clamp(spot.x + dxScene, 0, activeScene.width),
            y: clamp(spot.y + dyScene, 0, activeScene.height),
          };
        });

      if (isMobileScene) {
        setMobileSpots((prev) => applyMove(prev));
      } else {
        setDesktopSpots((prev) => applyMove(prev));
      }
    },
    [activeScene.height, activeScene.width, isMobileScene],
  );

  const copySnapshot = useCallback(async () => {
    const title = isMobileScene ? 'Mobile (1080x1920)' : 'Desktop (1920x1080)';
    const snapshot = formatLayoutSnapshot(title, activeScene.width, activeScene.height, activeScene.spots);
    try {
      await navigator.clipboard.writeText(snapshot);
      setSnapshotStatus('Snapshot copied to clipboard');
    } catch {
      setSnapshotStatus('Clipboard blocked. Snapshot printed to console.');
      console.log(snapshot);
    }
  }, [activeScene.height, activeScene.spots, activeScene.width, isMobileScene]);

  const users = usersQuery.data ?? [];
  const onlineCount = users.filter((u) => u.isOnline).length;

  const fallbackGuest: AdminUser = useMemo(
    () => ({
      id: -1,
      email: 'guest@home.local',
      username: guestName.toLowerCase().replace(/\s+/g, '-') || 'guest',
      displayName: guestName,
      role: 'GUEST',
      status: 'ACTIVE',
      lastLoginAt: null,
      loginCount: 1,
      createdAt: new Date().toISOString(),
      approvedAt: null,
      isOnline: true,
      avatarUrl: null,
      accentColor: '#a855f7',
    }),
    [guestName],
  );

  const lobbyMembers = useMemo(() => {
    const source = users.length > 0 ? users : [fallbackGuest];
    const filledSource = fillUsersToSlotCount(source, fallbackGuest, activeScene.spots.length);
    return createLobbyMembers(filledSource, sceneSeed, activeScene.spots);
  }, [users, fallbackGuest, sceneSeed, activeScene]);

  useEffect(() => {
    if (!selected) return;
    const stillExists = lobbyMembers.some((m) => m.user.id === selected.user.id);
    if (!stillExists) setSelected(null);
  }, [lobbyMembers, selected]);

  return (
    <div className="relative min-h-[100dvh] overflow-hidden bg-black">
      <picture>
        <source media="(max-width: 767px)" srcSet={mobileBackgroundImage} />
        <img src={webBackgroundImage} alt="Cozy living room background" className="pointer-events-none fixed inset-0 h-full w-full object-cover" />
      </picture>

      <div className="pointer-events-none fixed inset-x-4 top-4 z-30 flex items-start justify-between gap-3 sm:inset-x-6 sm:top-5">
        <div className="pointer-events-auto rounded-2xl border border-white/40 bg-white/75 px-4 py-3 shadow-[0_8px_22px_rgba(0,0,0,0.16)] backdrop-blur">
          <h1 className="text-xl font-semibold tracking-[-0.03em] text-slate-900 sm:text-2xl">Who&apos;s at the House?</h1>
          <p className="mt-1 text-sm font-medium text-slate-700">
            {onlineCount} online now
            <span className="ml-2 inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
          </p>
        </div>

        <div className="pointer-events-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => setEditMode((prev) => !prev)}
            className="rounded-full border border-white/55 bg-white/75 px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm backdrop-blur"
          >
            {editMode ? 'Done Moving' : 'Move Animals'}
          </button>
          <button
            type="button"
            onClick={copySnapshot}
            className="rounded-full border border-white/55 bg-white/75 px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm backdrop-blur"
          >
            Snapshot
          </button>
          <button type="button" onClick={refreshScene} className="rounded-full border border-white/55 bg-white/75 px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm backdrop-blur">
            Refresh
          </button>
          <button type="button" className="rounded-full border border-white/55 bg-white/75 px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm backdrop-blur">
            Invite
          </button>
          <button type="button" className="rounded-full border border-white/55 bg-white/75 px-3 py-2 text-xs font-semibold text-slate-700 shadow-sm backdrop-blur">
            Settings
          </button>
        </div>
      </div>

      <div className="absolute inset-0 z-20 overflow-hidden">
        <div className="absolute inset-0">
          <AnimatePresence>
            {lobbyMembers.map((member, index) => (
              <LobbyAvatar
                key={`${member.user.id}-${sceneSeed}`}
                member={member}
                index={index}
                sceneSeed={sceneSeed}
                sceneWidth={activeScene.width}
                sceneHeight={activeScene.height}
                editMode={editMode}
                onMove={moveSpot}
                onSelect={setSelected}
              />
            ))}
          </AnimatePresence>
        </div>

        <AnimatePresence>
          {selected && <ProfileCard selected={selected} onClose={() => setSelected(null)} />}
        </AnimatePresence>
      </div>

      <motion.button
        type="button"
        className="fixed bottom-5 right-4 z-40 rounded-full border border-amber-300/80 bg-amber-200 px-5 py-3 text-sm font-semibold text-amber-900 shadow-[0_12px_24px_rgba(0,0,0,0.18)]"
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.96 }}
      >
        Join House
      </motion.button>

      <div className="pointer-events-none fixed bottom-3 left-1/2 z-20 -translate-x-1/2 text-[10px] uppercase tracking-[0.22em] text-white/70">
        powered by bryzncode
      </div>

      {snapshotStatus && (
        <div className="pointer-events-none fixed bottom-10 left-1/2 z-50 -translate-x-1/2 rounded-full border border-white/50 bg-black/65 px-4 py-2 text-xs font-semibold text-white backdrop-blur">
          {snapshotStatus}
        </div>
      )}
    </div>
  );
}
