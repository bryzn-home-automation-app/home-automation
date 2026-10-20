import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Camera, CameraBatteryReading } from '../types';
import {
  BATTERY_LIVE_BUDGET_MS,
  ago,
  autoLive,
  batterySeries,
  batteryTone,
  chargeLabel,
  chargeState,
  dailySummary,
  latestEvent,
  nightWindows,
  shouldStream,
} from '../utils/cameras';
import { friendlyError, socketUrl, supportedCodecs } from '../utils/msePlayer';

const players = vi.hoisted(() => ({
  started: [] as string[],
  stopped: 0,
  handlers: [] as Array<{ onPlaying?: () => void; onEnded?: () => void; onError?: (m: string) => void }>,
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
  }
  return { ...actual, liveSupported: () => true, MsePlayer: FakePlayer };
});

vi.mock('../api/cameras', () => ({
  fetchCameraSnapshot: vi.fn().mockResolvedValue(new Blob(['jpg'], { type: 'image/jpeg' })),
  startCameraLive: vi.fn().mockResolvedValue({ url: '/camera-stream/t.s/ws', expiresAt: '' }),
  fetchCameras: vi.fn(),
  fetchCameraBattery: vi.fn(),
}));

import * as camerasApi from '../api/cameras';
import CameraTile from '../components/CameraTile';

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
    expect(batteryTone(29)).toBe('low');
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

  it('sums gains and use per local day, newest first', () => {
    const at = (h: number, d = 20) => new Date(2026, 9, d, h).toISOString();
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
});

describe('live-view policy', () => {
  const base = { requested: false, pageVisible: true, onScreen: true, idle: false, failed: false };

  it('wired cameras stream on their own; battery cameras only when tapped', () => {
    expect(autoLive(indoor)).toBe(true);
    expect(autoLive(driveway)).toBe(false);
    expect(shouldStream({ ...base, camera: indoor })).toBe(true);
    expect(shouldStream({ ...base, camera: driveway })).toBe(false);
    expect(shouldStream({ ...base, camera: driveway, requested: true })).toBe(true);
  });

  it('never streams when nobody is looking', () => {
    for (const off of [{ pageVisible: false }, { onScreen: false }, { idle: true }, { failed: true }]) {
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

  it('shows battery + solar state and waits for a tap on a battery camera', async () => {
    renderTile(driveway);
    expect(screen.getByText(/64%/)).toBeInTheDocument();
    expect(screen.getByText(/Solar charging/)).toBeInTheDocument();
    expect(await screen.findByAltText('Latest snapshot from Driveway')).toBeInTheDocument();
    expect(camerasApi.startCameraLive).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Watch Driveway live' }));
    await waitFor(() => expect(players.started).toEqual(['/camera-stream/t.s/ws']));
  });

  it('stops a battery stream at the budget and asks "Still watching?"', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderTile(driveway);
    fireEvent.click(screen.getByRole('button', { name: 'Watch Driveway live' }));
    await waitFor(() => expect(players.started).toHaveLength(1));

    await act(async () => {
      vi.advanceTimersByTime(BATTERY_LIVE_BUDGET_MS + 10);
    });
    expect(players.stopped).toBe(1);
    expect(screen.getByText(/Still watching\?/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Keep watching' }));
    await waitFor(() => expect(players.started).toHaveLength(2));
  });

  it('a wired camera streams by itself and stops when the tab is hidden', async () => {
    const { update } = renderTile(indoor);
    expect(screen.getByText('🔌 Wired power')).toBeInTheDocument();
    await waitFor(() => expect(players.started).toHaveLength(1));

    update({ pageVisible: false });
    expect(players.stopped).toBe(1);

    update({ pageVisible: true });
    await waitFor(() => expect(players.started).toHaveLength(2));

    update({ idle: true });
    expect(players.stopped).toBe(2);
    expect(screen.getByText(/nobody was watching/)).toBeInTheDocument();
  });

  it('shows a retry when live view fails, without looping', async () => {
    vi.mocked(camerasApi.startCameraLive).mockRejectedValueOnce(new Error('502'));
    renderTile(indoor);
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(camerasApi.startCameraLive).toHaveBeenCalledTimes(1);
  });

  it('highlights a recent person detection', () => {
    renderTile({ ...driveway, lastPersonAt: new Date(Date.now() - 30_000).toISOString() });
    expect(screen.getByText(/Person · just now/)).toBeInTheDocument();
  });
});
