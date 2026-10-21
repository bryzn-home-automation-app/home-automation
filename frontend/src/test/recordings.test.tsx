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

import CameraRecordings from '../components/CameraRecordings';

function rec(id: string, startedAt: string, cameraName = 'Front', cameraId = 'cam-front'): CameraRecording {
  return { id, cameraId, cameraName, startedAt, endedAt: null, durationMs: 20_000, sizeBytes: 4_000_000, hasThumbnail: true };
}

describe('recording helpers', () => {
  const now = new Date(2026, 9, 21, 9, 0); // Wed Oct 21 2026, local

  it('groups by local day, newest day first, keeping order within a day', () => {
    const recs = [
      rec('3', new Date(2026, 9, 21, 8, 0).toISOString()),
      rec('2', new Date(2026, 9, 20, 19, 47).toISOString()),
      rec('1', new Date(2026, 9, 20, 6, 32).toISOString()),
      rec('0', new Date(2026, 9, 18, 12, 0).toISOString()),
      rec('x', 'not a date'),
    ];
    const g = groupByDay(recs, now);
    expect(g.map((d) => d.label.split(',')[0])).toEqual(['Today', 'Yesterday', 'Sunday']);
    expect(g[1].items.map((r) => r.id)).toEqual(['2', '1']);
  });

  it('labels and formats', () => {
    expect(dayLabel('2026-10-21', now)).toBe('Today');
    expect(dayLabel('2026-10-20', now)).toBe('Yesterday');
    expect(formatDuration(20_000)).toBe('0:20');
    expect(formatDuration(754_000)).toBe('12:34');
    expect(formatDuration(null)).toBe('');
    const r = rec('1', new Date(2026, 9, 20, 19, 47, 51).toISOString(), 'Front / Door');
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
    const today = new Date();
    const at = (h: number) => new Date(today.getFullYear(), today.getMonth(), today.getDate(), h).toISOString();
    api.recordings = [rec('2', at(10)), rec('1', at(9), 'Backyard', 'cam-back')];
    renderView();

    expect(await screen.findByText('Today')).toBeInTheDocument();
    expect(screen.getByText('2 in the last 7 days')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Backyard' }));
    expect(screen.getByText('1 in the last 7 days')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'All cameras' }));

    fireEvent.click(screen.getByRole('button', { name: /Front · 0:20/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Front recording' });
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

  it('says when there are none, and reaches further back on request', async () => {
    renderView();
    expect(await screen.findByText('No recordings in the last 7 days.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Show older/ }));
    await waitFor(() => expect(api.days).toEqual([7, 14]));
  });
});
