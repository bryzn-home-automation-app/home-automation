import type { CameraRecording } from '../types';

// Presentation helpers for the Recordings view. React-free so they're unit-tested
// directly (see src/test/recordings.test.tsx).

/** How far back the list reaches; "Show older" steps through these. */
export const RECORDING_DAY_STEPS = [7, 14, 30, 60] as const;

export interface RecordingDay {
  /** Local calendar day, "2026-10-20". */
  key: string;
  label: string;
  items: CameraRecording[];
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** "Today", "Yesterday", or "Sunday, Oct 18" — in the viewer's time zone. */
export function dayLabel(key: string, now: Date = new Date()): string {
  if (key === dayKey(now)) return 'Today';
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  if (key === dayKey(y)) return 'Yesterday';
  const [yr, mo, da] = key.split('-').map(Number);
  return new Date(yr, mo - 1, da).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
}

/** Recordings grouped by local day, newest day first; order within a day is kept (newest first). */
export function groupByDay(recs: CameraRecording[], now: Date = new Date()): RecordingDay[] {
  const days = new Map<string, CameraRecording[]>();
  for (const r of recs) {
    const at = new Date(r.startedAt);
    if (Number.isNaN(at.getTime())) continue;
    const key = dayKey(at);
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

export function formatClock(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** "Front 2026-10-20 19-47-51.mp4" — sortable, and safe on every OS. */
export function recordingFileName(r: CameraRecording): string {
  const at = new Date(r.startedAt);
  const t = `${String(at.getHours()).padStart(2, '0')}-${String(at.getMinutes()).padStart(2, '0')}-${String(at.getSeconds()).padStart(2, '0')}`;
  const name = r.cameraName.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'Camera';
  return `${name} ${dayKey(at)} ${t}.mp4`;
}

/** Whether this browser says it can play H.265 in MP4 (Safari yes; others depend on hardware). */
export function canPlayHevc(): boolean | null {
  if (typeof document === 'undefined') return null;
  const v = document.createElement('video');
  if (typeof v.canPlayType !== 'function') return null;
  return v.canPlayType('video/mp4; codecs="hvc1.1.6.L150.B0"') !== '' || v.canPlayType('video/mp4; codecs="hvc1"') !== '';
}
