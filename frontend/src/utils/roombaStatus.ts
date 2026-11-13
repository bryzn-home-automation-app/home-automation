import type { GeoPosition, RoombaMapGeoJson, RoombaNativeSchedule, RoombaPart, RoombaPosition, RoombaStatus } from '../types';
import {
  formatDayName, formatDuration, formatList, formatNumber, formatRelative, formatStamp, formatTime, homeClock, homeDayKey, plural,
  toInstant, type DateInput,
} from './format';
import { pointInRings, type Pt } from './mapLabels';
import { humanize, roombaPhaseStatus, type Tone } from './status';
import { isRecharging } from './roomba';
import type { RoombaScheduleSkip } from '../types';
import { heldSchedules, runsOnWeekday, skippedCleans } from './roombaSkips';

/*
 * The robot's state in one place, for every screen that shows it (the Roomba page, Home's
 * Roomba card). Before this, each screen worked it out on its own and they disagreed: Home and
 * the page said "Cleaning" while the dock emptied the bin (B-140), kept a stale "Cleaning 64%"
 * up for hours after the poller lost the robot (B-070, B-138), and the page called a mid-clean
 * recharge's area "Last area" (B-130). Pure functions, no React, tested in roombaStatus.test.ts.
 */

/** The status fields this reads (a RoombaStatus fits). */
export type RoombaStatusInput = Pick<
  RoombaStatus,
  'phase' | 'cycle' | 'error' | 'errorText' | 'running' | 'dockError' | 'dockText' | 'online' | 'updatedAt'
>;

export interface RoombaState {
  /** A short word for a pill, a lamp or a card: "Cleaning", "Emptying the bin", "Docked", "Offline". */
  label: string;
  tone: Tone;
  /** Out cleaning on a fresh reading: drives the live dot, the coverage layer and "This clean". */
  cleaning: boolean;
  /** Partway through a clean on a fresh reading: cleaning, emptying, heading back mid-clean or recharging to finish. */
  inMission: boolean;
  /** The last reading is too old to trust (the backend's `online` is false: no check-in for 10 minutes). */
  offline: boolean;
  /** Paused partway through a clean (Resume carries on). */
  paused: boolean;
  /** For an offline robot, what it was last seen doing and when ("Last seen cleaning, 3 hr ago"). */
  lastSeen: string | null;
}

const NO_STATUS: RoombaState = {
  label: 'No status yet', tone: 'neutral', cleaning: false, inMission: false, offline: false, paused: false, lastSeen: null,
};

/**
 * What the robot is doing, trusting a reading only while it is fresh. Order: no reading, then
 * offline (a frozen "Cleaning" from hours ago must not read as live), then the phase words from
 * utils/status (an error first, the bin emptying before "Cleaning", a mid-clean recharge).
 */
export function roombaState(s: RoombaStatusInput | null | undefined, now: Date | number = Date.now()): RoombaState {
  if (!s) return NO_STATUS;
  const phase = (s.phase ?? '').toLowerCase();
  const cycleOn = s.cycle != null && s.cycle !== '' && s.cycle !== 'none';
  const recharging = isRecharging(s);
  const paused = (phase === 'stop' || phase === 'pause') && cycleOn;
  if (!s.online) {
    const when = s.updatedAt ? formatRelative(s.updatedAt, now) : null;
    const doing = s.running && phase !== 'evac' ? 'cleaning' : recharging ? 'recharging mid-clean' : null;
    const lastSeen = when ? `Last seen ${doing ? `${doing}, ` : ''}${lowerFirst(when)}` : null;
    return { label: 'Offline', tone: 'headsup', cleaning: false, inMission: false, offline: true, paused: false, lastSeen };
  }
  const st = roombaPhaseStatus(s);
  const cleaning = s.running && phase !== 'evac';
  // A clean is under way (the controls lead with Pause, not Clean) through every leg of it:
  // cleaning, the dock emptying the bin mid-clean, heading back mid-clean (hmMidMsn) and
  // recharging to finish. A stand-alone bin empty (cycle "evac", or no cycle) isn't a mission.
  const missionCycle = cycleOn && s.cycle !== 'evac' && s.cycle !== 'dock';
  const emptyingMidClean = phase === 'evac' && missionCycle;
  const homing = phase === 'hmmidmsn';
  return {
    label: st.label,
    tone: st.tone,
    cleaning,
    inMission: cleaning || phase === 'run' || emptyingMidClean || recharging || paused || homing,
    offline: false,
    paused,
    lastSeen: null,
  };
}

/** formatRelative for the middle of a sentence: "updated 2 hr ago", "yesterday", "Sat, Aug 22". */
export function relativeInSentence(input: string | number | Date | null | undefined, now: Date | number = Date.now()): string {
  return lowerFirst(formatRelative(input, now));
}

function lowerFirst(text: string): string {
  // "Yesterday" reads "last seen yesterday"; "Mon, Nov 2" keeps its capital.
  return /^(Just now|Yesterday|Tomorrow)$/.test(text) ? text.toLowerCase() : text;
}

// ─── Last seen ──────────────────────────────────────────────────────────

/*
 * Where the robot was last seen, for the map: shown when it is away from its dock and not
 * moving, so someone can go and find it (Nov 12 2026: it stopped in the living room at
 * 11:00 AM and never docked). The poller keeps one position row, written from the live
 * stream while the robot is out; the stream stops when the robot docks or stops. What the
 * stored status says in each case:
 *  - docked: phase "charge" (also mid-clean, with a cycle), "evac" while the dock empties the
 *    bin. Charging is the robot's own word for sitting on the dock, so it hides the marker,
 *    including after someone carries it back by hand.
 *  - paused or stopped off the dock: "stop"/"pause"; stuck: "stuck" or an error. Show it.
 *  - battery flat or offline: the cloud keeps the last state it reported (Nov 12: "stop", 11%,
 *    still "online" because the poller reads the cloud's copy), so a dead robot looks like
 *    the state it died in. A dead robot can't say it is docked, so anything but a docked
 *    phase shows the marker, with its time.
 *  - moving (cleaning, heading home): the live dot's job, unless the position has stopped
 *    changing for a couple of minutes, which is a robot that died mid-move (its cloud state
 *    can freeze at "run").
 */

/** Phases the robot reports only on its dock: charging (to finish a clean, too), emptying the bin, a dock without power. */
const DOCKED_PHASES = new Set(['charge', 'recharge', 'evac', 'chargingerror']);
/** Phases with the robot on the move (lower case): cleaning, starting, heading home. */
const MOVING_PHASES = new Set(['run', 'resume', 'new', 'hmpostmsn', 'hmmidmsn', 'hmusrdock', 'dock', 'dockend']);
/** A moving robot whose position hasn't changed for this long has stopped somewhere (a stream gap is shorter). */
export const LAST_SEEN_MOVING_GRACE_MS = 2 * 60_000;
/** A last position this close to the dock (metres) is the dock: no marker drawn on top of it. */
export const LAST_SEEN_DOCK_RADIUS_M = 0.6;

export interface LastSeen {
  /** Metres, in the map's space. */
  x: number;
  y: number;
  /** When it was there (the position's updatedAt). */
  at: string;
  /** The mapped room it was in, or null outside every room. */
  room: string | null;
  /** The sentence: "Last seen in Living Room at 11:00 AM". */
  words: string;
  /** For the map key: "Last seen 11:00 AM", "Last seen yesterday, 3:44 PM". */
  short: string;
}

export interface LastSeenInput {
  status: Pick<RoombaStatus, 'phase' | 'missionStart'> | null | undefined;
  position: Pick<RoombaPosition, 'x' | 'y' | 'updatedAt'> | null | undefined;
  geojson?: Pick<RoombaMapGeoJson, 'rooms' | 'dockPose'> | null;
  now?: Date | number;
}

/** Where the robot was last seen, when the map should show it (see above); otherwise null. */
export function lastSeen({ status, position, geojson, now = Date.now() }: LastSeenInput): LastSeen | null {
  if (!status || !position || !Number.isFinite(position.x) || !Number.isFinite(position.y)) return null;
  const at = toInstant(position.updatedAt);
  const nowMs = toInstant(now);
  if (at == null || nowMs == null) return null;
  const phase = (status.phase ?? '').toLowerCase();
  if (DOCKED_PHASES.has(phase)) return null;
  // On the dock already (a stop on the dock, the last sample of the trip home).
  if (dockPoints(geojson).some(([dx, dy]) => Math.hypot(position.x - dx, position.y - dy) <= LAST_SEEN_DOCK_RADIUS_M)) return null;
  // From before this clean began: the robot has moved since, so it says nothing.
  const started = toInstant(status.missionStart);
  if (started != null && at < started) return null;
  if (MOVING_PHASES.has(phase) && nowMs - at < LAST_SEEN_MOVING_GRACE_MS) return null;
  const room = roomAt(geojson, position.x, position.y);
  return {
    x: position.x,
    y: position.y,
    at: position.updatedAt,
    room,
    words: lastSeenWords(room, position.updatedAt, now),
    short: `Last seen ${formatStamp(position.updatedAt, { now, time: 'always' }).replace(/^Yesterday/, 'yesterday')}`,
  };
}

/** "Last seen in Living Room at 11:00 AM", "… yesterday at 3:44 PM", "… on Mon, Nov 9 at 9:05 AM". */
export function lastSeenWords(room: string | null, at: DateInput, now: DateInput = Date.now()): string {
  const day = formatDayName(at, now);
  const time = formatTime(at);
  const when = day === 'Yesterday' ? `yesterday at ${time}` : day === 'Today' || day === 'Tomorrow' ? `at ${time}` : `on ${day} at ${time}`;
  return `Last seen ${room ? `in ${room} ` : ''}${when}`;
}

/** The name of the mapped room a point (metres) falls in, or null. */
export function roomAt(geojson: Pick<RoombaMapGeoJson, 'rooms'> | null | undefined, x: number, y: number): string | null {
  for (const f of geojson?.rooms?.features ?? []) {
    const g = f.geometry;
    const polygons = g?.type === 'Polygon' ? [g.coordinates] : g?.type === 'MultiPolygon' ? g.coordinates : [];
    if (!polygons.some((rings) => pointInRings(x, y, rings.map((r) => r.map(toPt))))) continue;
    const raw = (f.properties?.name ?? f.properties?.room_name) as unknown;
    return typeof raw === 'string' && raw.trim() ? raw.trim() : null;
  }
  return null;
}

function dockPoints(geojson: Pick<RoombaMapGeoJson, 'dockPose'> | null | undefined): Pt[] {
  const out: Pt[] = [];
  for (const f of geojson?.dockPose?.features ?? []) {
    if (f.geometry?.type === 'Point') out.push(toPt(f.geometry.coordinates));
  }
  return out.filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
}

function toPt(p: GeoPosition): Pt {
  return [p[0], p[1]];
}

// ─── Parts ──────────────────────────────────────────────────────────────

export interface PartsSummary {
  overdue: string[];
  dueSoon: string[];
  tone: Tone;
}

/** The parts that want attention, by label: overdue first. */
export function partsSummary(parts: readonly Pick<RoombaPart, 'label' | 'status'>[] | null | undefined): PartsSummary {
  const list = parts ?? [];
  const overdue = list.filter((p) => p.status === 'overdue').map((p) => p.label);
  const dueSoon = list.filter((p) => p.status === 'due_soon').map((p) => p.label);
  return { overdue, dueSoon, tone: overdue.length ? 'headsup' : dueSoon.length ? 'info' : 'ok' };
}

// ─── The verdict ────────────────────────────────────────────────────────

export interface RoombaVerdictInput {
  status: (RoombaStatusInput & Partial<Pick<RoombaStatus, 'name' | 'sqft' | 'runtimeMinutes' | 'needsAttention' | 'attentionReasons' | 'batteryPct' | 'dockIssue'>>) | null | undefined;
  parts?: readonly Pick<RoombaPart, 'label' | 'status'>[] | null;
  /** Where it was last seen, when the map shows that (lastSeen): the note says where to look. */
  lastSeen?: Pick<LastSeen, 'words'> | null;
  now?: Date | number;
}

export interface RoombaVerdict {
  tone: Tone;
  /** The sentence: what is going on. */
  sentence: string;
  /** What next, with numbers. */
  note: string | null;
  /** True when the note points at the parts (the page adds a "See parts" link). */
  aboutParts: boolean;
  /** The dock's own code, shown small after the note ("Dock code 671"), or null. */
  code?: string | null;
}

/** The answer at the top of the Roomba page: what the robot is doing and whether anything needs doing. */
export function roombaVerdict({ status, parts, lastSeen: seenAt, now = Date.now() }: RoombaVerdictInput): RoombaVerdict {
  if (!status) {
    return {
      tone: 'neutral',
      sentence: "The Roomba hasn't checked in yet.",
      note: 'Its status shows here once the home server reaches the robot.',
      aboutParts: false,
    };
  }
  const name = status.name?.trim() || 'The Roomba';
  const state = roombaState(status, now);
  const ps = partsSummary(parts);
  const partsNote = ps.overdue.length
    ? `${formatPartList(ps.overdue)} ${ps.overdue.length === 1 ? 'is' : 'are'} overdue.`
    : ps.dueSoon.length
      ? `${formatPartList(ps.dueSoon)} ${ps.dueSoon.length === 1 ? 'is' : 'are'} due soon.`
      : null;
  const join = (...bits: Array<string | null | undefined>) => bits.filter(Boolean).join(' ') || null;
  const sqft = status.sqft != null ? formatNumber(status.sqft, { unit: 'sq ft' }) : null;
  // Where to go and look, first in the note whenever the map shows it.
  const seen = seenAt ? `${seenAt.words}.` : null;

  if (state.offline) {
    return {
      tone: 'headsup',
      sentence: `${name} hasn't checked in since ${formatStamp(status.updatedAt, { now }).replace(/^Yesterday/, 'yesterday')}.`,
      note: join(
        status.running ? 'It was cleaning then.' : null,
        seen ?? 'The page catches up as soon as it reconnects; check its Wi-Fi if this lasts.',
      ),
      aboutParts: false,
    };
  }
  if (status.error) {
    return {
      tone: 'problem',
      sentence: `${name} needs help${status.errorText ? `: ${lowerFirstWord(status.errorText)}` : ''}.`,
      note: join(seen, 'Sort it out at the robot, then start the clean again.'),
      aboutParts: false,
    };
  }
  const phase = (status.phase ?? '').toLowerCase();
  if (phase === 'stuck') {
    return { tone: 'problem', sentence: `${name} is stuck.`, note: join(seen, 'Free it, then start the clean again.'), aboutParts: false };
  }
  if (phase === 'evac') {
    return { tone: 'info', sentence: `${name} is emptying its bin into the dock.`, note: join(sqft && `${sqft} cleaned so far.`, partsNote), aboutParts: !!partsNote };
  }
  if (state.cleaning) {
    const so = [sqft, status.runtimeMinutes != null ? `${formatDuration(status.runtimeMinutes)} in` : null].filter(Boolean).join(', ');
    return { tone: 'info', sentence: `${name} is cleaning.`, note: join(seen, so ? `${so[0].toUpperCase()}${so.slice(1)}.` : null, partsNote), aboutParts: !!partsNote };
  }
  if (isRecharging(status)) {
    return {
      tone: 'info',
      sentence: `${name} is recharging to finish the clean.`,
      note: join(sqft && `${sqft} cleaned so far.`, 'It carries on once charged.'),
      aboutParts: false,
    };
  }
  if (state.paused) {
    return { tone: 'headsup', sentence: `${name} is paused partway through a clean.`, note: join(seen, 'Resume it, or send it home to the dock.'), aboutParts: false };
  }
  if (phase === 'hmpostmsn' || phase === 'hmusrdock' || phase === 'hmmidmsn') {
    return { tone: 'info', sentence: `${name} is heading back to the dock.`, note: join(seen, partsNote), aboutParts: !!partsNote };
  }
  // Not on the dock and not moving (stopped after a clean ran out, or its battery went flat):
  // never "docked and ready".
  if (seen) {
    return { tone: 'headsup', sentence: `${name} is stopped away from the dock.`, note: join(seen, partsNote), aboutParts: !!partsNote };
  }
  // The dock's own complaint (its tanks, its bag, the mop): what's wrong and what to do, never "ready".
  const dock = dockIssueWords(status.dockIssue, status.name);
  if (dock) {
    return { tone: 'headsup', sentence: dock.sentence, note: dock.note, aboutParts: false, code: dock.code };
  }
  if (status.dockError) {
    return {
      tone: 'headsup',
      sentence: `${name} is docked, but the dock needs a look.`,
      note: join(status.dockText ? `The dock says: ${status.dockText}.` : null, partsNote),
      aboutParts: !!partsNote,
    };
  }
  if (ps.overdue.length) {
    return { tone: 'headsup', sentence: `${name} is ready, but a part needs replacing.`, note: partsNote, aboutParts: true };
  }
  const otherReasons = (status.attentionReasons ?? []).filter((r) => !/^maintenance/i.test(r));
  if (status.needsAttention && otherReasons.length) {
    return { tone: 'headsup', sentence: `${name} needs a look.`, note: `${otherReasons.join('. ')}.`, aboutParts: false };
  }
  return {
    tone: 'ok',
    sentence: `${name} is docked and ready.`,
    note: partsNote ?? (status.batteryPct != null ? `Battery at ${Math.round(status.batteryPct)}%.` : null),
    aboutParts: !!partsNote,
  };
}

function formatPartList(labels: string[]): string {
  // "Dock bag" and "Filter" → "The dock bag and filter".
  return `The ${formatList(labels.map((l) => l.charAt(0).toLowerCase() + l.slice(1)))}`;
}

function lowerFirstWord(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1).replace(/\.$/, '');
}

// ─── The dock ───────────────────────────────────────────────────────────

/*
 * The dock's own complaint (status.dockIssue, decoded by the poller: roomba-poller/dock_issues.py
 * has the code table and where each code comes from). Nov 13 2026: the 9:00 AM vacuum-and-mop
 * clean didn't start, the dock's light was red, and this page said "docked and ready" because the
 * dock's main state (301) only covers emptying the bin; the pad-wash state read 671, "clean-water
 * tank empty or not installed". 671 and 672 can't tell an empty (or full) tank from one that isn't
 * pushed in, so their advice covers both. A kind this doesn't know reads as "the dock needs
 * attention" with the code, never as ready. The alerts word the same kinds (backend RoombaDock).
 */

export interface DockIssueWords {
  /** What's wrong: "The dock's clean-water tank is empty." */
  sentence: string;
  /** What to do. */
  note: string;
  /** Short, for the lamp under the map beside "Bin in" and the robot's own "Tank in": "Dock: clean water empty". */
  short: string;
  /** "Dock code 671", or null without a code. */
  code: string | null;
}

/** The dock's complaint in words, or null when it has none. */
export function dockIssueWords(issue: RoombaStatus['dockIssue'], robotName?: string | null): DockIssueWords | null {
  if (!issue || !issue.kind) return null;
  const name = robotName?.trim() || 'the Roomba';
  const Name = robotName?.trim() || 'The Roomba';
  const code = issue.code != null ? `Dock code ${issue.code}` : null;
  const words = (sentence: string, note: string, short: string): DockIssueWords => ({ sentence, note, short, code });
  switch (issue.kind) {
    case 'clean_water_empty':
      return words(
        "The dock's clean-water tank is empty.",
        `Refill it and ${name} can mop again.${issue.code === 671 ? " If it's full, push it in firmly; a loose tank reads as empty." : ''}`,
        'Dock: clean water empty',
      );
    case 'clean_water_out':
      return words("The dock's clean-water tank is out.", `Fill it and put it back, and ${name} can mop again.`, 'Dock: clean tank out');
    case 'dirty_water_full':
      return words(
        "The dock's dirty-water tank is full.",
        `Empty it and ${name} can mop again.${issue.code === 672 ? " If it's empty, push it in firmly; a loose tank reads as full." : ''}`,
        'Dock: dirty water full',
      );
    case 'dirty_water_out':
      return words("The dock's dirty-water tank is out.", `Put it back and ${name} can mop again.`, 'Dock: dirty tank out');
    case 'bag':
      return words('The dock needs a new bag.', `Fit one so the dock can empty ${name}'s bin again.`, 'Dock: needs a bag');
    case 'mop':
      return words(`${Name}'s mop isn't attached.`, 'Attach or reseat it and it can mop again. It can still vacuum.', 'Mop not attached');
    default:
      return words(
        'The dock needs attention.',
        "It's reporting something this app can't read yet. Check the light on the dock and the iRobot app.",
        code ?? 'Dock needs a look',
      );
  }
}

/** The dock's lamp under the map: its complaint in a few words, a dock error, or "Dock OK". Null when nothing is known. */
export function dockLamp(
  status: Pick<RoombaStatus, 'dockState' | 'dockError' | 'name'> & Partial<Pick<RoombaStatus, 'dockIssue'>> | null | undefined,
): { tone: Tone; label: string } | null {
  if (!status) return null;
  const issue = dockIssueWords(status.dockIssue, status.name);
  if (issue) return { tone: 'headsup', label: issue.short };
  if (status.dockError) return { tone: 'headsup', label: 'Dock needs a look' };
  return status.dockState != null ? { tone: 'ok', label: 'Dock OK' } : null;
}

// ─── Runs ───────────────────────────────────────────────────────────────

const RUN: Record<string, { tone: Tone; label: string }> = {
  COMPLETED: { tone: 'ok', label: 'Finished' },
  STUCK: { tone: 'problem', label: 'Stuck' },
  CANCELLED: { tone: 'neutral', label: 'Stopped early' },
};

/** A finished run's outcome (RoombaRun.status). */
export function runStatus(status: string | null | undefined): { tone: Tone; label: string } {
  if (!status) return { tone: 'neutral', label: 'Unknown' };
  return RUN[status.toUpperCase()] ?? { tone: 'neutral', label: humanize(status) };
}

const CYCLE: Record<string, string> = {
  clean: 'Cleaning run',
  quick: 'Quick clean',
  spot: 'Spot clean',
  dock: 'Returning to the dock',
  evac: 'Emptying the bin',
  train: 'Mapping run',
  none: 'None',
};

/** The robot's cycle code in words ("clean" → "Cleaning run"; B-126). */
export function cycleLabel(cycle: string | null | undefined): string {
  if (!cycle) return '';
  return CYCLE[cycle] ?? humanize(cycle);
}

const PAD: Record<string, string> = {
  padPlate: 'Pad plate only (no pad)',
  none: 'No pad',
  invalid: 'Not recognised',
  dispDry: 'Disposable dry pad',
  dispWet: 'Disposable wet pad',
  reusableDry: 'Reusable dry pad',
  reusableWet: 'Reusable wet pad',
};

/** What the robot detects on its mop mount (status.detectedPad: "padPlate" → words; B-126). */
export function padLabel(pad: string | null | undefined): string {
  if (!pad) return '';
  return PAD[pad] ?? humanize(pad);
}

const INITIATOR: Record<string, string> = {
  rmtApp: 'The iRobot app',
  localApp: 'The iRobot app',
  schedule: 'A schedule',
  manual: 'The button on the robot',
  cloud: 'The home app',
  voice: 'A voice assistant',
};

/** Who started a clean (status.initiator / run.initiator). */
export function initiatorLabel(v: string | null | undefined): string {
  if (!v) return '';
  return INITIATOR[v] ?? humanize(v);
}

// ─── Commands ───────────────────────────────────────────────────────────

const COMMAND: Record<string, string> = {
  start: 'Clean',
  clean_rooms: 'Clean rooms',
  clean_room: 'Clean a room',
  pause: 'Pause',
  resume: 'Resume',
  stop: 'Stop',
  dock: 'Send home',
  find: 'Find the robot',
  rename_room: 'Rename a room',
  split_room: 'Divide a room',
  merge_rooms: 'Merge rooms',
  list_schedules: 'Read schedules',
  skip_clean: 'Skip a clean',
  undo_skip: 'Undo a skip',
};

/** A queued command's name in words (B-120: never "clean_rooms"). */
export function commandLabel(command: string | null | undefined): string {
  if (!command) return '';
  return COMMAND[command] ?? humanize(command);
}

const COMMAND_STATE: Record<string, { tone: Tone; label: string }> = {
  PENDING: { tone: 'neutral', label: 'Queued' },
  SENT: { tone: 'info', label: 'Sending' },
  // OK: the robot was seen to react (pause, resume, stop, dock, a clean from the dock), or for
  // the rest the broker accepted it, which is not proof it acted.
  OK: { tone: 'ok', label: 'Sent to the robot' },
  FAILED: { tone: 'problem', label: 'Failed' },
};

/** A command's progress: Queued → Sending → Sent to the robot (not proof it acted) or Failed. */
export function commandState(status: string | null | undefined): { tone: Tone; label: string } {
  if (!status) return { tone: 'neutral', label: '' };
  return COMMAND_STATE[status.toUpperCase()] ?? { tone: 'neutral', label: humanize(status) };
}

// ─── Schedules ──────────────────────────────────────────────────────────

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const DAY_PLURAL = ['Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays', 'Sundays'];

/** Schedule days (1 = Monday … 7 = Sunday) in words: "Every day", "Mon – Fri", "Weekends", "Sundays", "Mon, Wed and Fri". */
export function scheduleDays(days: readonly number[]): string {
  const set = [...new Set(days)].filter((d) => d >= 1 && d <= 7).sort((a, b) => a - b);
  if (set.length === 0) return 'No days set';
  if (set.length === 7) return 'Every day';
  const key = set.join('');
  if (key === '12345') return 'Mon – Fri';
  if (key === '67') return 'Weekends';
  if (set.length === 1) return DAY_PLURAL[set[0] - 1];
  // A run of three or more days in a row reads as a range.
  const contiguous = set.every((d, i) => i === 0 || d === set[i - 1] + 1);
  if (contiguous && set.length >= 3) return `${DAY_NAMES[set[0] - 1]} – ${DAY_NAMES[set[set.length - 1] - 1]}`;
  const names = set.map((d) => DAY_NAMES[d - 1]);
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

const MODE: Record<number, string> = { 2: 'vacuum', 4: 'mop', 6: 'vacuum and mop' };

/** The schedule's operating modes in words ("vacuum and mop"); vendor codes 2 / 4 / 6. */
export function scheduleModes(modes: readonly number[]): string {
  if (modes.length === 0) return '';
  return modes.map((m) => MODE[m] ?? `mode ${m}`).join(', then ');
}

/** "Mon – Fri · 9:00 AM · vacuum · 3 rooms": a schedule in plain words. */
export function scheduleLine(s: Pick<RoombaNativeSchedule, 'days' | 'hour' | 'minute' | 'operatingModes' | 'roomCount'>): string {
  return [
    scheduleDays(s.days),
    s.hour != null && s.minute != null ? formatTime(wallClock(2026, 1, 5, s.hour, s.minute)) : null,
    scheduleModes(s.operatingModes) || null,
    s.roomCount > 0 ? plural(s.roomCount, 'room') : 'every room',
  ].filter(Boolean).join(' · ');
}

const pad2 = (n: number) => String(n).padStart(2, '0');
function wallClock(y: number, m: number, d: number, hh: number, mm: number): string {
  return `${y}-${pad2(m)}-${pad2(d)}T${pad2(hh)}:${pad2(mm)}`;
}

export interface NextClean {
  /** Home wall-clock "YYYY-MM-DDTHH:MM" (format it with format.ts). */
  at: string;
  name: string | null;
  /** Its schedule's operating modes (2 vacuum, 4 mop, 6 vacuum and mop), when known. */
  modes?: readonly number[];
}

/**
 * The next time an enabled schedule fires, in the home's time (schedule hours are the robot's
 * local time, which is the home's). Null when nothing is enabled. With `skips`, a skipped clean
 * is passed over, and a schedule switched off only for a skip still counts (it goes back on).
 */
export function nextScheduledClean(
  schedules: readonly (Pick<RoombaNativeSchedule, 'days' | 'hour' | 'minute' | 'enabled' | 'name'>
    & { householdScheduleId?: string; operatingModes?: readonly number[] })[] | null | undefined,
  now: Date | number = Date.now(),
  skips?: readonly RoombaScheduleSkip[] | null,
): NextClean | null {
  const today = homeClock(now);
  const key = homeDayKey(now);
  if (!today || !key || !schedules) return null;
  const nowMinutes = today.hour * 60 + today.minute;
  const held = heldSchedules(skips);
  const skipped = skippedCleans(skips);
  let best: { offset: number; minutes: number; s: (typeof schedules)[number] } | null = null;
  for (const s of schedules) {
    const id = s.householdScheduleId ?? '';
    if (!(s.enabled || held.has(id)) || s.hour == null || s.minute == null) continue;
    const minutes = s.hour * 60 + s.minute;
    // Two weeks: a weekly clean that is skipped is next seen a week on.
    for (let offset = 0; offset <= 14; offset++) {
      // 0 = Sunday in HomeClock; schedules count 1 = Monday … 7 = Sunday (or iRobot's 0).
      const wd = (today.weekday + offset) % 7;
      if (!runsOnWeekday(s.days, wd)) continue;
      if (offset === 0 && minutes <= nowMinutes) continue;
      if (skipped.size > 0) {
        const day = new Date(Date.UTC(today.year, today.month - 1, today.day + offset));
        if (skipped.has(`${id}|${wallClock(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), 0, 0).slice(0, 10)}`)) continue;
      }
      if (!best || offset < best.offset || (offset === best.offset && minutes < best.minutes)) best = { offset, minutes, s };
      break;
    }
  }
  if (!best) return null;
  const day = new Date(Date.UTC(today.year, today.month - 1, today.day + best.offset));
  return {
    at: wallClock(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), Math.floor(best.minutes / 60), best.minutes % 60),
    name: best.s.name,
    modes: best.s.operatingModes,
  };
}

/** "Tomorrow" / "Today" / "Thu, Nov 12" for a NextClean. */
export function nextCleanDay(next: NextClean, now: Date | number = Date.now()): string {
  return formatDayName(next.at, now);
}

/**
 * What the next clean waits on when the dock's complaint will stop it, for the Next clean tile:
 * "once the clean-water tank is refilled". A clean that mops needs the dock's water tanks (Nov 13
 * 2026: the 9:00 AM vacuum-and-mop clean never started with the clean-water tank empty), so the
 * tile mustn't promise it while the verdict above says the tank is empty. Null for a clean that
 * only vacuums, modes not known, or a complaint that isn't known to stop a clean (the bag, the
 * mop, a code nobody has decoded).
 */
export function nextCleanWaitsOn(next: Pick<NextClean, 'modes'> | null, issue: RoombaStatus['dockIssue']): string | null {
  if (!next || !issue?.kind || !(next.modes ?? []).some((m) => m === 4 || m === 6)) return null;
  switch (issue.kind) {
    case 'clean_water_empty':
      return 'once the clean-water tank is refilled';
    case 'clean_water_out':
      return 'once the clean-water tank is back in';
    case 'dirty_water_full':
      return 'once the dirty-water tank is emptied';
    case 'dirty_water_out':
      return 'once the dirty-water tank is back in';
    default:
      return null;
  }
}
