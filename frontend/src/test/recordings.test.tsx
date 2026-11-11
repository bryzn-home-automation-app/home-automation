import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { CameraRecording } from '../types';
import { dayLabel, formatDuration, groupByDay, recordingFileName } from '../utils/recordings';

const api = vi.hoisted(() => ({
  recordings: [] as CameraRecording[],
  videoCalls: [] as string[],
  days: [] as number[],
}));

vi.mock('../api/cameras', () => ({
  fetchCameraRecordings: async (days: number) => {
    api.days.push(days);
    return api.recordings;
  },
  fetchRecordingThumbnail: async () => new Blob(['jpg'], { type: 'image/jpeg' }),
  fetchRecordingVideo: async (id: string) => {
    api.videoCalls.push(id);
    return new Blob(['mp4'], { type: 'video/mp4' });
  },
}));

import CameraRecordings, { scrollRoot } from '../components/CameraRecordings';

function rec(id: string, startedAt: string, cameraName = 'Front', cameraId = 'cam-front'): CameraRecording {
  return { id, cameraId, cameraName, startedAt, endedAt: null, durationMs: 20_000, sizeBytes: 4_000_000, hasThumbnail: true };
}

describe('recording helpers', () => {
  // Times carry the home's offset (Central daylight time in October), so the days are the
  // home's whatever zone the test machine is in.
  const now = new Date('2026-10-21T09:00:00-05:00'); // Wed Oct 21 2026 at home

  it("groups by the home's day, newest day first, keeping order within a day", () => {
    const recs = [
      rec('3', '2026-10-21T08:00:00-05:00'),
      rec('2', '2026-10-20T19:47:00-05:00'),
      rec('1', '2026-10-20T06:32:00-05:00'),
      // 11:30 PM at home is already the next day in UTC: it stays on the 18th.
      rec('0', '2026-10-18T23:30:00-05:00'),
      rec('x', 'not a date'),
    ];
    const g = groupByDay(recs, now);
    expect(g.map((d) => d.label.split(',')[0])).toEqual(['Today', 'Yesterday', 'Sun']);
    expect(g[1].items.map((r) => r.id)).toEqual(['2', '1']);
  });

  it('labels and formats', () => {
    expect(dayLabel('2026-10-21', now)).toBe('Today');
    expect(dayLabel('2026-10-20', now)).toBe('Yesterday');
    expect(formatDuration(20_000)).toBe('0:20');
    expect(formatDuration(754_000)).toBe('12:34');
    expect(formatDuration(null)).toBe('');
    const r = rec('1', '2026-10-20T19:47:51-05:00', 'Front / Door');
    expect(recordingFileName(r)).toBe('Front Door 2026-10-20 19-47-51.mp4');
  });
});

describe('<CameraRecordings>', () => {
  afterEach(() => {
    api.recordings = [];
    api.videoCalls = [];
    api.days = [];
  });

  function renderView() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={client}>
        <CameraRecordings />
      </QueryClientProvider>,
    );
  }

  it('lists recordings, filters by camera, and plays one in the player', async () => {
    const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
    api.recordings = [rec('2', ago(1)), rec('1', ago(2), 'Backyard', 'cam-back')];
    renderView();

    expect(await screen.findByText('Today')).toBeInTheDocument();
    expect(screen.getByText('2 clips in the last 7 days, newest first')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^Backyard/ }));
    expect(screen.getByText('1 clip in the last 7 days, newest first')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^All cameras/ }));

    fireEvent.click(screen.getByRole('button', { name: /0:20.*Front$/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Front' });
    await waitFor(() => expect(dialog.querySelector('video')).not.toBeNull());
    expect(api.videoCalls).toEqual(['2']);
    expect(within(dialog).getByRole('link', { name: 'Download' })).toHaveAttribute('download');

    // Step to the older one, then close.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Older recording' }));
    await waitFor(() => expect(api.videoCalls).toEqual(['2', '1']));
    expect(within(dialog).getByRole('button', { name: 'Older recording' })).toBeDisabled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it("closes on the phone's back gesture, and the close button takes its history entry with it", async () => {
    api.recordings = [rec('1', new Date(Date.now() - 60_000).toISOString())];
    renderView();

    fireEvent.click(await screen.findByRole('button', { name: /0:20.*Front$/ }));
    await screen.findByRole('dialog');
    await waitFor(() => expect(window.history.state?.overlay).toBeTruthy());
    window.history.back();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(window.history.state?.overlay).toBeUndefined();

    fireEvent.click(screen.getByRole('button', { name: /0:20.*Front$/ }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(window.history.state?.overlay).toBeTruthy());
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(window.history.state?.overlay).toBeUndefined());
  });

  it('says when there are none, and reaches further back on request', async () => {
    renderView();
    expect(await screen.findByText('No recordings in the last 7 days.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show 14 days' }));
    await waitFor(() => expect(api.days).toEqual([7, 14]));
  });

  it('arrow keys inside the video seek it, not the clip list (B-118)', async () => {
    const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
    api.recordings = [rec('2', ago(1)), rec('1', ago(2))];
    renderView();
    fireEvent.click((await screen.findAllByRole('button', { name: /0:20.*Front$/ }))[0]);
    const dialog = await screen.findByRole('dialog', { name: 'Front' });
    const video = await waitFor(() => {
      const v = dialog.querySelector('video');
      expect(v).not.toBeNull();
      return v!;
    });
    fireEvent.keyDown(video, { key: 'ArrowLeft' });
    expect(api.videoCalls).toEqual(['2']);
    fireEvent.keyDown(dialog, { key: 'ArrowLeft' });
    await waitFor(() => expect(api.videoCalls).toEqual(['2', '1']));
  });

  it('keeps naming the days it shows while older ones load (B-115), and drops a filter whose camera is gone (B-114)', async () => {
    let release: () => void = () => {};
    api.recordings = [rec('1', new Date(Date.now() - 60_000).toISOString(), 'Backyard', 'cam-back')];
    renderView();
    fireEvent.click(await screen.findByRole('button', { name: /^Backyard/ }));
    expect(screen.getByRole('button', { name: /^Backyard/ })).toHaveAttribute('aria-pressed', 'true');

    // The 14-day load hangs: the list and its count still say 7 days.
    const pending = new Promise<void>((r) => (release = r));
    const original = api.recordings;
    api.recordings = [];
    vi.spyOn(await import('../api/cameras'), 'fetchCameraRecordings').mockImplementationOnce(async (days: number) => {
      api.days.push(days);
      await pending;
      return [];
    });
    fireEvent.click(screen.getByRole('button', { name: 'Show 14 days' }));
    expect(screen.getByText('1 clip in the last 7 days, newest first')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Loading…' })).toBeInTheDocument();
    release();
    // Loaded: nothing from the Backyard any more, so the filter lets go instead of leaving an empty list.
    expect(await screen.findByText('No recordings in the last 14 days.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Backyard/ })).toBeNull();
    api.recordings = original;
  });
});

describe('scrollRoot (B-116)', () => {
  it("observes thumbnails against the phone's page scroller, the window otherwise", () => {
    const box = document.createElement('div');
    box.setAttribute('data-page-scroller', '');
    box.style.overflowY = 'auto';
    const row = document.createElement('div');
    box.appendChild(row);
    document.body.appendChild(box);
    expect(scrollRoot(row)).toBe(box);
    box.style.overflowY = 'visible';
    expect(scrollRoot(row)).toBeNull();
    box.remove();
  });
});
