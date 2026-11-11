import type { CameraRecording } from '../types';
import { formatDayName, formatTime, homeClock, homeDayKey } from './format';

// Presentation helpers for the Recordings view. React-free so they're unit-tested
// directly (see src/test/recordings.test.tsx).

/** How far back the list reaches; "Show older" steps through these. */
export const RECORDING_DAY_STEPS = [7, 14, 30, 60] as const;

export interface RecordingDay {
  /** The home's calendar day, "2026-10-20". */
  key: string;
  /** "Today", "Yesterday", or "Sun, Oct 18". */
  label: string;
  items: CameraRecording[];
}

/** "Today", "Yesterday", or "Sun, Oct 18": the day at home, wherever the phone is. */
export function dayLabel(key: string, now: Date = new Date()): string {
  return formatDayName(key, now);
}

/** Recordings grouped by the home's calendar day, newest day first; order within a day is kept (newest first). */
export function groupByDay(recs: CameraRecording[], now: Date = new Date()): RecordingDay[] {
  const days = new Map<string, CameraRecording[]>();
  for (const r of recs) {
    const key = homeDayKey(r.startedAt);
    if (!key) continue;
    const list = days.get(key);
    if (list) list.push(r);
    else days.set(key, [r]);
  }
  return [...days.entries()]
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([key, items]) => ({ key, label: dayLabel(key, now), items }));
}

/** 20 000 → "0:20", 754 000 → "12:34"; null → "". */
export function formatDuration(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '';
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** "4:58 PM" at home. */
export function formatClock(iso: string): string {
  return formatTime(iso);
}

/** "Front 2026-10-20 19-47-51.mp4" — sortable, and safe on every OS. */
export function recordingFileName(r: CameraRecording): string {
  // The home's clock, like the list, so the file name matches the time the family saw.
  const c = homeClock(r.startedAt);
  const pad = (n: number) => String(n).padStart(2, '0');
  const t = c ? `${pad(c.hour)}-${pad(c.minute)}-${pad(c.second)}` : '00-00-00';
  const name = r.cameraName.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Camera';
  return `${name} ${homeDayKey(r.startedAt) ?? 'unknown-day'} ${t}.mp4`;
}

/** Whether this browser says it can play H.265 in MP4 (Safari yes; others depend on hardware). */
export function canPlayHevc(): boolean | null {
  if (typeof document === 'undefined') return null;
  const v = document.createElement('video');
  if (typeof v.canPlayType !== 'function') return null;
  return v.canPlayType('video/mp4; codecs="hvc1.1.6.L150.B0"') !== '' || v.canPlayType('video/mp4; codecs="hvc1"') !== '';
}
