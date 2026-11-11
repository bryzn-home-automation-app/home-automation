import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Camera, CameraBatteryReading } from '../types';
import {
  BATTERY_LIVE_BUDGET_MS,
  ago,
  FULL_BATTERY_AXIS,
  batteryAxis,
  batteryLampTone,
  summaryDays,
  timeTicks,
  autoLive,
  batterySeries,
  batteryTone,
  chargeLabel,
  chargeState,
  combinedBatterySeries,
  dailySummary,
  latestEvent,
  nightWindows,
  shouldStream,
} from '../utils/cameras';
import { friendlyError, socketUrl, supportedCodecs } from '../utils/msePlayer';

const players = vi.hoisted(() => ({
  started: [] as string[],
  stopped: 0,
  handlers: [] as Array<{
    onPlaying?: () => void;
    onEnded?: () => void;
    onError?: (m: string) => void;
    onBlocked?: (blocked: boolean) => void;
  }>,
}));

vi.mock('../utils/msePlayer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/msePlayer')>();
  class FakePlayer {
    constructor(_video: HTMLVideoElement, handlers: (typeof players.handlers)[number]) {
      players.handlers.push(handlers);
    }
    start(url: string) {
      players.started.push(url);
    }
    stop() {
      players.stopped++;
    }
    diagnostics() {
      return {};
    }
  }
  return { ...actual, liveSupported: () => true, MsePlayer: FakePlayer };
});

vi.mock('../api/cameras', () => ({
  fetchCameraSnapshot: vi.fn().mockResolvedValue(new Blob(['jpg'], { type: 'image/jpeg' })),
  startCameraLive: vi.fn().mockResolvedValue({ url: '/camera-stream/t.s/ws', expiresAt: '' }),
  reportLiveDiagnostics: vi.fn().mockResolvedValue(undefined),
  goToCameraPreset: vi.fn().mockResolvedValue(undefined),
  nudgeCamera: vi.fn().mockResolvedValue(undefined),
  fetchCameras: vi.fn(),
  fetchCameraBattery: vi.fn(),
}));

import * as camerasApi from '../api/cameras';
import CameraTile, { PRESET_NOTE_MS } from '../components/CameraTile';
import CameraBatteryChart, { type BatteryTrackInput } from '../components/CameraBatteryChart';

const driveway: Camera = {
  id: 'cam-1',
  name: 'Driveway',
  available: true,
  powerSource: 'battery',
  batteryPercent: 64,
  charging: true,
  chargingStatus: 'Solar charging',
  batteryUpdatedAt: null,
  lastMotionAt: null,
  lastPersonAt: null,
  liveAvailable: true,
  lastSeenAt: null,
  presets: [],
  canPanTilt: false,
};
const indoor: Camera = { ...driveway, id: 'cam-2', name: 'Living Room', powerSource: 'wired', batteryPercent: null, charging: null, chargingStatus: null };

const reading = (at: string, percent: number, charging: boolean | null = null): CameraBatteryReading => ({
  at,
  percent,
  charging,
  chargingStatus: null,
});

describe('battery helpers', () => {
  it('tones by threshold', () => {
    expect(batteryTone(80)).toBe('ok');
    expect(batteryTone(31)).toBe('ok');
    // Exactly at a threshold matches the backend alert (≤).
    expect(batteryTone(30)).toBe('low');
    expect(batteryTone(15)).toBe('critical');
    expect(batteryTone(14)).toBe('critical');
    expect(batteryTone(null)).toBe('unknown');
  });

  it('uses reported charging first, else the trend (hedged)', () => {
    expect(chargeState({ charging: true }, [])).toEqual({ state: 'charging', inferred: false });
    expect(chargeState({ charging: false }, [])).toEqual({ state: 'draining', inferred: false });
    const rising = [reading('2026-10-20T10:00:00Z', 60), reading('2026-10-20T11:00:00Z', 60), reading('2026-10-20T12:00:00Z', 62)];
    expect(chargeState({ charging: null }, rising)).toEqual({ state: 'charging', inferred: true });
    const flat = [reading('2026-10-20T10:00:00Z', 60), reading('2026-10-20T11:00:00Z', 60)];
    expect(chargeState({ charging: null }, flat).state).toBe('steady');
    expect(chargeState({ charging: null }, undefined)).toEqual({ state: 'unknown', inferred: false });
  });

  it('labels solar charging and hedges inferred charging', () => {
    expect(chargeLabel({ chargingStatus: 'Solar charging' }, 'charging', false)).toBe('Solar charging');
    expect(chargeLabel({ chargingStatus: null }, 'charging', false)).toBe('Charging');
    expect(chargeLabel({ chargingStatus: null }, 'charging', true)).toBe('Likely charging');
    expect(chargeLabel({ chargingStatus: null }, 'draining', false)).toBe('On battery');
    expect(chargeLabel({ chargingStatus: null }, 'unknown', false)).toBe('');
  });

  it('splits the series into charging and draining segments that join up', () => {
    const pts = batterySeries([
      reading('2026-10-20T10:00:00Z', 50),
      reading('2026-10-20T11:00:00Z', 55),
      reading('2026-10-20T12:00:00Z', 53),
    ]);
    expect(pts.map((p) => [p.charge, p.drain])).toEqual([
      [50, null],
      [55, 55],
      [null, 53],
    ]);
    // Reported charging wins over the trend.
    const reported = batterySeries([reading('2026-10-20T10:00:00Z', 50), reading('2026-10-20T11:00:00Z', 50, true)]);
    expect(reported[1].charge).toBe(50);
  });

  it('puts several cameras on one time axis, filling between readings so no line has holes', () => {
    const rows = combinedBatterySeries([
      [reading('2026-10-20T10:00:00Z', 50), reading('2026-10-20T12:00:00Z', 60), reading('2026-10-20T14:00:00Z', 56)],
      [reading('2026-10-20T11:00:00Z', 80), reading('2026-10-20T13:00:00Z', 70)],
    ]);
    expect(rows.map((r) => r.t)).toEqual(
      ['10', '11', '12', '13', '14'].map((h) => new Date(`2026-10-20T${h}:00:00Z`).getTime()),
    );
    // Camera 0 rose 10:00→12:00 (charging) and fell after; camera 1 only fell.
    expect(rows.map((r) => [r.v0, r.c0])).toEqual([
      [50, 50],
      [55, 55], // between its readings, on the straight line, inside a charging stretch
      [60, 60], // the top of the charge carries both, so the band ends on the line
      [58, null],
      [56, null],
    ]);
    expect(rows.map((r) => [r.v1, r.c1])).toEqual([
      [null, null], // before its first reading
      [80, null],
      [75, null],
      [70, null],
      [null, null], // after its last
    ]);
    // A reported charge wins over the trend, and an empty track stays empty.
    const reported = combinedBatterySeries([[reading('2026-10-20T10:00:00Z', 50), reading('2026-10-20T11:00:00Z', 50, true)], []]);
    expect(reported.map((r) => [r.c0, r.v1])).toEqual([[50, null], [50, null]]);
  });

  it("sums gains and use per day at home, newest first", () => {
    // Central daylight time: 11 PM on the 19th at home is already the 20th in UTC.
    const at = (h: number, d = 20) => `2026-10-${d}T${String(h).padStart(2, '0')}:00:00-05:00`;
    const days = dailySummary([
      reading(at(8, 19), 40),
      reading(at(14, 19), 58),
      reading(at(23, 19), 52),
      reading(at(9), 49),
      reading(at(15), 61),
    ]);
    expect(days).toEqual([
      { day: '2026-10-20', gained: 12, used: 3 },
      { day: '2026-10-19', gained: 18, used: 6 },
    ]);
  });

  it('computes night as the gaps between daylight windows', () => {
    const t = (iso: string) => new Date(iso).getTime();
    const nights = nightWindows(
      [{ from: '2026-10-20T12:30:00Z', to: '2026-10-20T23:50:00Z' }],
      t('2026-10-20T06:00:00Z'),
      t('2026-10-21T06:00:00Z'),
    );
    expect(nights).toEqual([
      { from: t('2026-10-20T06:00:00Z'), to: t('2026-10-20T12:30:00Z') },
      { from: t('2026-10-20T23:50:00Z'), to: t('2026-10-21T06:00:00Z') },
    ]);
    expect(nightWindows([], 0, 10)).toEqual([]);
  });

  it('lists only days that start inside the window (B-021)', () => {
    // Now is Mon Oct 19, 5 PM at home; the 24 h window starts Sun 5 PM, so Sunday is cut off.
    const now = new Date('2026-10-19T17:00:00-05:00').getTime();
    const readings = [
      reading('2026-10-18T18:00:00-05:00', 60),
      reading('2026-10-18T22:00:00-05:00', 58),
      reading('2026-10-19T10:00:00-05:00', 56),
      reading('2026-10-19T14:00:00-05:00', 66),
    ];
    expect(summaryDays(readings, now - 24 * 3_600_000).map((d) => d.day)).toEqual(['2026-10-19']);
    expect(summaryDays(readings, now - 168 * 3_600_000).map((d) => d.day)).toEqual(['2026-10-19', '2026-10-18']);
  });

  it('calls a gain sun only when it came in daylight (B-109)', () => {
    const daylight = [{ from: '2026-10-19T07:30:00-05:00', to: '2026-10-19T18:40:00-05:00' }];
    const sunny = summaryDays([reading('2026-10-19T10:00:00-05:00', 50), reading('2026-10-19T14:00:00-05:00', 60)], 0, daylight);
    expect(sunny[0]).toMatchObject({ gained: 10, solar: true });
    const cable = summaryDays([reading('2026-10-19T01:00:00-05:00', 50), reading('2026-10-19T03:00:00-05:00', 70)], 0, daylight);
    expect(cable[0]).toMatchObject({ gained: 20, solar: false });
  });

  it('lamps a battery on the camera alert thresholds, never while charging', () => {
    expect(batteryLampTone(31)).toBe('ok');
    expect(batteryLampTone(30)).toBe('headsup');
    expect(batteryLampTone(15)).toBe('problem');
    expect(batteryLampTone(12, true)).toBe('ok');
    expect(batteryLampTone(null)).toBe('neutral');
  });

  describe('batteryAxis (fitted y-axis)', () => {
    const check = (a: ReturnType<typeof batteryAxis>) => {
      const [lo, hi] = a.domain;
      expect(lo).toBeGreaterThanOrEqual(0);
      expect(hi).toBeLessThanOrEqual(100);
      expect(a.ticks[0]).toBe(lo);
      expect(a.ticks[a.ticks.length - 1]).toBe(hi);
      expect(a.ticks.length).toBeGreaterThanOrEqual(3);
      expect(a.ticks.length).toBeLessThanOrEqual(6);
      // The alert line is always inside, never on the edge.
      expect(lo).toBeLessThan(30);
      expect(hi).toBeGreaterThan(30);
    };

    it('zooms in on batteries that live under 50%', () => {
      const a = batteryAxis([27, 29, 33, 41, 45, null]);
      expect(a).toEqual({ domain: [20, 50], ticks: [20, 30, 40, 50], full: false });
      check(a);
    });

    it('fits very low batteries down to 0 and keeps the alert line in', () => {
      const a = batteryAxis([5, 8, 12]);
      expect(a).toEqual({ domain: [0, 40], ticks: [0, 10, 20, 30, 40], full: false });
      check(a);
    });

    it('goes to the whole scale when a camera is near full and another is low', () => {
      expect(batteryAxis([98, 4])).toEqual(FULL_BATTERY_AXIS);
      // 20–100% would hardly be a zoom: the plain scale reads better.
      expect(batteryAxis([98, 27])).toEqual(FULL_BATTERY_AXIS);
      // Near full and nothing low still has to reach down to the alert line.
      expect(batteryAxis([92, 97])).toEqual(FULL_BATTERY_AXIS);
    });

    it("doesn't magnify a flat line", () => {
      const a = batteryAxis([40, 40, 40]);
      expect(a.domain[1] - a.domain[0]).toBeGreaterThanOrEqual(20);
      expect(a.ticks.every((t) => t % 5 === 0)).toBe(true);
      check(a);
    });

    it('stretches to show the alert line when every reading is well above it', () => {
      const a = batteryAxis([62, 70]);
      expect(a).toEqual({ domain: [20, 80], ticks: [20, 40, 60, 80], full: false });
      check(a);
    });

    it('falls back to 0–100% with no readings', () => {
      expect(batteryAxis([])).toEqual(FULL_BATTERY_AXIS);
      expect(batteryAxis([null, undefined, NaN])).toEqual(FULL_BATTERY_AXIS);
    });
  });

  it('puts time ticks on whole hours at home (B-102)', () => {
    const from = new Date('2026-10-19T17:20:00-05:00').getTime();
    const day = timeTicks(from, from + 24 * 3_600_000, 24);
    expect(day[0]).toBe(new Date('2026-10-19T18:00:00-05:00').getTime());
    expect(day.every((t, i) => i === 0 || t - day[i - 1] === 3 * 3_600_000)).toBe(true);
    const week = timeTicks(from, from + 168 * 3_600_000, 168);
    expect(week).toHaveLength(7);
    expect(week[0]).toBe(new Date('2026-10-20T00:00:00-05:00').getTime());
  });
});

describe('live-view policy', () => {
  const base = { requested: false, pageVisible: true, idle: false, failed: false };

  it('every camera, battery ones included, goes live on its own', () => {
    expect(autoLive(indoor)).toBe(true);
    expect(autoLive(driveway)).toBe(true);
    expect(shouldStream({ ...base, camera: indoor })).toBe(true);
    expect(shouldStream({ ...base, camera: driveway })).toBe(true);
  });

  it('never streams when nobody is looking', () => {
    for (const off of [{ pageVisible: false }, { idle: true }, { failed: true }]) {
      expect(shouldStream({ ...base, requested: true, camera: indoor, ...off })).toBe(false);
    }
    expect(shouldStream({ ...base, camera: { ...indoor, available: false } })).toBe(false);
    expect(shouldStream({ ...base, camera: { ...indoor, liveAvailable: false } })).toBe(false);
  });

  it('prefers person over a simultaneous motion event', () => {
    expect(latestEvent({ lastMotionAt: '2026-10-20T12:00:02Z', lastPersonAt: '2026-10-20T12:00:00Z' })?.kind).toBe('person');
    expect(latestEvent({ lastMotionAt: '2026-10-20T12:10:00Z', lastPersonAt: '2026-10-20T12:00:00Z' })?.kind).toBe('motion');
    expect(latestEvent({ lastMotionAt: null, lastPersonAt: null })).toBeNull();
  });

  it('formats elapsed time', () => {
    const now = new Date('2026-10-20T12:00:00Z').getTime();
    expect(ago('2026-10-20T11:59:40Z', now)).toBe('just now');
    expect(ago('2026-10-20T11:56:00Z', now)).toBe('4 min ago');
    expect(ago('2026-10-20T09:00:00Z', now)).toBe('3 hr ago');
  });
});

describe('mse player helpers', () => {
  it('builds a same-origin ws url', () => {
    expect(socketUrl('/camera-stream/a.b/ws', { protocol: 'http:', host: '192.168.4.228' })).toBe('ws://192.168.4.228/camera-stream/a.b/ws');
    expect(socketUrl('/x', { protocol: 'https:', host: 'home.example' })).toBe('wss://home.example/x');
  });

  it('explains codec mismatches in plain words', () => {
    expect(friendlyError('codecs not matched: video:H265')).toMatch(/H\.265/);
    expect(friendlyError(undefined)).toBe('The camera did not start');
  });

  it('offers only codecs the browser can play', () => {
    expect(supportedCodecs((t) => t.includes('avc1.640029') || t.includes('mp4a.40.2'))).toBe('avc1.640029,mp4a.40.2');
  });
});

describe('CameraTile', () => {
  const charge = { state: 'charging' as const, inferred: false };

  function renderTile(camera: Camera, props: Partial<{ pageVisible: boolean; idle: boolean }> = {}) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const ui = (p: typeof props) => (
      <QueryClientProvider client={client}>
        <CameraTile camera={camera} pageVisible={p.pageVisible ?? true} idle={p.idle ?? false} onWake={() => {}} charge={charge} />
      </QueryClientProvider>
    );
    const utils = render(ui(props));
    return { ...utils, update: (p: typeof props) => utils.rerender(ui(p)) };
  }

  beforeEach(() => {
    players.started = [];
    players.stopped = 0;
    players.handlers = [];
    vi.mocked(camerasApi.startCameraLive).mockClear();
    URL.createObjectURL = vi.fn(() => 'blob:snap');
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows battery + solar state and starts a battery camera live without a tap', async () => {
    renderTile(driveway);
    expect(screen.getByText(/64%/)).toBeInTheDocument();
    expect(screen.getByText(/Solar charging/)).toBeInTheDocument();
    expect(await screen.findByAltText('Latest snapshot from Driveway')).toBeInTheDocument();
    expect(screen.getByText('Waking camera…')).toBeInTheDocument();
    await waitFor(() => expect(players.started).toEqual(['/camera-stream/t.s/ws']));
  });

  it('stops a battery stream at the budget and asks "Still watching?"', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { update } = renderTile(driveway);
    await waitFor(() => expect(players.started).toHaveLength(1));

    await act(async () => {
      vi.advanceTimersByTime(BATTERY_LIVE_BUDGET_MS + 10);
    });
    expect(players.stopped).toBe(1);
    expect(screen.getByText(/Still watching\?/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Keep watching' }));
    await waitFor(() => expect(players.started).toHaveLength(2));

    // Paused at the budget, then a later visit: it starts live again, not on the prompt.
    await act(async () => {
      vi.advanceTimersByTime(BATTERY_LIVE_BUDGET_MS + 10);
    });
    expect(screen.getByText(/Still watching\?/)).toBeInTheDocument();
    update({ pageVisible: false });
    update({ pageVisible: true });
    await waitFor(() => expect(players.started).toHaveLength(3));
    expect(screen.queryByText(/Still watching\?/)).not.toBeInTheDocument();
  });

  it('reconnects a battery stream the bridge ended, instead of asking "Still watching?"', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderTile(driveway);
    await waitFor(() => expect(players.started).toHaveLength(1));
    act(() => players.handlers[players.handlers.length - 1].onEnded?.());
    await act(async () => {
      vi.advanceTimersByTime(2_100);
    });
    await waitFor(() => expect(players.started).toHaveLength(2));
    expect(screen.queryByText(/Still watching\?/)).not.toBeInTheDocument();
  });

  it('a wired camera streams by itself and stops when the tab is hidden', async () => {
    const { update } = renderTile(indoor);
    expect(screen.getByText('Wired power')).toBeInTheDocument();
    await waitFor(() => expect(players.started).toHaveLength(1));

    update({ pageVisible: false });
    expect(players.stopped).toBe(1);

    update({ pageVisible: true });
    await waitFor(() => expect(players.started).toHaveLength(2));

    update({ idle: true });
    expect(players.stopped).toBe(2);
    expect(screen.getByText(/nobody was watching/)).toBeInTheDocument();
  });

  it('asks for a tap when the phone holds the picture back, and plays it from that tap', async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    renderTile(driveway);
    await waitFor(() => expect(players.started).toHaveLength(1));
    const player = players.handlers[players.handlers.length - 1];

    act(() => player.onBlocked?.(true));
    expect(screen.queryByText('Waking camera…')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(play).toHaveBeenCalled();

    act(() => player.onBlocked?.(false));
    expect(screen.getByText('Waking camera…')).toBeInTheDocument();
    act(() => player.onPlaying?.());
    expect(screen.getByText('Live')).toBeInTheDocument();
    play.mockRestore();
  });

  it('shows a retry when live view fails, without looping', async () => {
    vi.mocked(camerasApi.startCameraLive).mockRejectedValueOnce(new Error('502'));
    renderTile(indoor);
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(camerasApi.startCameraLive).toHaveBeenCalledTimes(1);
  });

  it('shows saved positions and moves the camera to one', async () => {
    renderTile({ ...driveway, presets: [{ index: 0, name: 'Home' }, { index: 2, name: 'Position 2' }], canPanTilt: true });
    fireEvent.click(screen.getByRole('button', { name: 'Position 2' }));
    await waitFor(() => expect(camerasApi.goToCameraPreset).toHaveBeenCalledWith('cam-1', 2));
    expect(await screen.findByText(/Moving to Position 2/)).toBeInTheDocument();
    // Already live on its own, so there's nothing to offer.
    expect(screen.queryByRole('button', { name: 'Watch live' })).not.toBeInTheDocument();
  });

  it('pan/tilt arrows appear only while live', async () => {
    const cam = { ...indoor, canPanTilt: true };
    renderTile(cam);
    expect(screen.queryByRole('button', { name: /Pan left/ })).toBeNull();
    await waitFor(() => expect(players.handlers.length).toBeGreaterThan(0));
    act(() => players.handlers[players.handlers.length - 1].onPlaying?.());
    fireEvent.click(await screen.findByRole('button', { name: 'Pan left Living Room' }));
    await waitFor(() => expect(camerasApi.nudgeCamera).toHaveBeenCalledWith('cam-2', 'left'));
  });

  it('Stop really stops a live battery camera, and Play starts it again (B-022)', async () => {
    renderTile(driveway);
    await waitFor(() => expect(players.started).toHaveLength(1));
    act(() => players.handlers[players.handlers.length - 1].onPlaying?.());
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(players.stopped).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: 'Watch Driveway live' }));
    await waitFor(() => expect(players.started).toHaveLength(2));
  });

  it('drops Live the moment a stream ends, while it reconnects (B-111)', async () => {
    renderTile(indoor);
    await waitFor(() => expect(players.started).toHaveLength(1));
    act(() => players.handlers[players.handlers.length - 1].onPlaying?.());
    expect(screen.getByText('Live')).toBeInTheDocument();
    act(() => players.handlers[players.handlers.length - 1].onEnded?.());
    expect(screen.queryByText('Live')).not.toBeInTheDocument();
    expect(screen.getByText('Connecting…')).toBeInTheDocument();
  });

  it('a live-view error is forgotten when the app is left and reopened (B-112)', async () => {
    vi.mocked(camerasApi.startCameraLive).mockRejectedValueOnce(new Error('502'));
    const { update } = renderTile(indoor);
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
    update({ pageVisible: false });
    update({ pageVisible: true });
    await waitFor(() => expect(camerasApi.startCameraLive).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });

  it('the "Moving to" note clears once the camera has had time to get there (B-119)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderTile({ ...driveway, presets: [{ index: 2, name: 'Position 2' }] });
    fireEvent.click(screen.getByRole('button', { name: 'Position 2' }));
    expect(await screen.findByText(/Moving to Position 2/)).toBeInTheDocument();
    await act(async () => {
      vi.advanceTimersByTime(PRESET_NOTE_MS + 10);
    });
    expect(screen.queryByText(/Moving to Position 2/)).not.toBeInTheDocument();
  });

  it('a cable charge shows no sun (B-109)', () => {
    renderTile({ ...driveway, chargingStatus: 'Charging' });
    expect(screen.getByText(/Charging/)).toBeInTheDocument();
    expect(screen.queryByText(/Solar/)).not.toBeInTheDocument();
  });

  it('highlights a recent person detection', () => {
    renderTile({ ...driveway, lastPersonAt: new Date(Date.now() - 10_000).toISOString() });
    expect(screen.getByText(/Person · just now/)).toBeInTheDocument();
  });
});

describe('CameraBatteryChart', () => {
  const backyard: Camera = { ...driveway, id: 'cam-3', name: 'Backyard', batteryPercent: 41, charging: false, chargingStatus: null };
  const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();
  const history = (levels: number[]) => ({
    readings: levels.map((p, i) => reading(hoursAgo(levels.length - i), p)),
    daylight: [],
  });
  const track = (camera: Camera, over: Partial<BatteryTrackInput> = {}): BatteryTrackInput => ({
    camera,
    history: history([50, 55, 60]),
    loading: false,
    failed: false,
    refetch: vi.fn(),
    ...over,
  });

  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('draws every battery camera on one chart, each named with its level, under one range', () => {
    const onRange = vi.fn();
    render(<CameraBatteryChart tracks={[track(driveway), track(backyard, { history: history([60, 50, 41]) })]} range={24} onRangeChange={onRange} />);
    const legend = screen.getByRole('list', { name: 'Cameras on the chart' });
    expect(legend).toHaveTextContent('Driveway 64% · Solar charging');
    expect(legend).toHaveTextContent('Backyard 41% · On battery');
    expect(screen.getAllByRole('img', { name: /Battery level over the last 24 hours/ })).toHaveLength(1);
    expect(screen.getByRole('img', { name: /Driveway \(solid line\) now 64%.*Backyard \(dashed line\) now 41%/ })).toBeInTheDocument();
    expect(screen.getByText(/Charging \(wide band under the line\)/)).toBeInTheDocument();
    expect(screen.getAllByRole('group', { name: 'Battery range' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '7 days' }));
    expect(onRange).toHaveBeenCalledWith(168);
  });

  it('fits the scale to the batteries, says so, and can show 0–100%', () => {
    render(
      <CameraBatteryChart
        tracks={[track(driveway, { history: history([31, 36, 45]) }), track(backyard, { history: history([40, 33, 27]) })]}
        range={24}
        onRangeChange={() => {}}
      />,
    );
    expect(screen.getByText('Scale 20–50%')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /Scale 20–50%\.$/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Fit' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: '0–100%' }));
    expect(screen.queryByText('Scale 20–50%')).not.toBeInTheDocument();
    expect(screen.getByRole('img', { name: /Scale 0–100%\.$/ })).toBeInTheDocument();
  });

  it('offers no scale switch when the readings need the whole scale', () => {
    render(<CameraBatteryChart tracks={[track(driveway, { history: history([96, 98]) }), track(backyard, { history: history([20, 12]) })]} range={24} onRangeChange={() => {}} />);
    expect(screen.queryByRole('group', { name: 'Battery scale' })).not.toBeInTheDocument();
    expect(screen.queryByText(/^Scale /)).not.toBeInTheDocument();
  });

  it('keeps the day-by-day detail, grouped per camera', () => {
    render(<CameraBatteryChart tracks={[track(driveway), track(backyard, { history: history([60, 50, 41]) })]} range={24} onRangeChange={() => {}} />);
    expect(screen.getByRole('region', { name: 'Driveway, day by day' })).toHaveTextContent(/\+10% charged/);
    expect(screen.getByRole('region', { name: 'Backyard, day by day' })).toHaveTextContent(/−19% used/);
  });

  it('shows the cameras that loaded and names the one that did not', () => {
    const refetch = vi.fn();
    render(
      <CameraBatteryChart
        tracks={[track(driveway), track(backyard, { history: undefined, failed: true, refetch })]}
        range={24}
        onRangeChange={() => {}}
      />,
    );
    expect(screen.getByText("Couldn't load the Backyard battery history")).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Cameras on the chart' })).toHaveTextContent('Backyard 41% · not loaded');
    expect(screen.getByRole('img', { name: /Driveway/ })).not.toHaveAccessibleName(/Backyard/);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(refetch).toHaveBeenCalled();
  });

  it('loads, fails and waits through the kit states', () => {
    const { rerender } = render(
      <CameraBatteryChart tracks={[track(driveway, { history: undefined, loading: true }), track(backyard)]} range={24} onRangeChange={() => {}} />,
    );
    expect(screen.getByText('Loading the battery history')).toBeInTheDocument();
    rerender(
      <CameraBatteryChart
        tracks={[track(driveway, { history: undefined, failed: true }), track(backyard, { history: undefined, failed: true })]}
        range={24}
        onRangeChange={() => {}}
      />,
    );
    expect(screen.getByText("Couldn't load the battery history")).toBeInTheDocument();
    rerender(<CameraBatteryChart tracks={[track(driveway, { history: history([50]) })]} range={24} onRangeChange={() => {}} />);
    expect(screen.getByText('Collecting data')).toBeInTheDocument();
  });
});
