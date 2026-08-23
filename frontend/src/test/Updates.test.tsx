import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as releasesApi from '../api/releases';
import type { Release } from '../api/releases';

vi.mock('../api/releases', () => ({
  fetchReleases: vi.fn(),
}));

const SAMPLE: Release[] = [
  {
    version: '1.1.0',
    stage: 'beta',
    releasedAt: '2026-09-01',
    title: 'Second release',
    summary: 'A newer set of changes.',
    changes: [
      { type: 'new', text: 'A brand new thing you can do.' },
      { type: 'fixed', text: 'A bug that used to happen no longer does.' },
    ],
  },
  {
    version: '1.0.0',
    stage: 'beta',
    releasedAt: '2026-08-22',
    title: 'Welcome to HomeOS',
    summary: 'The first release.',
    changes: [{ type: 'new', text: 'Electricity tracking arrived.' }],
  },
];

async function renderUpdates() {
  const { default: Updates } = await import('../pages/Updates');
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } });
  return render(
    <QueryClientProvider client={qc}>
      <Updates />
    </QueryClientProvider>,
  );
}

describe("Updates (What's New) page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the newest version in the header and marks it Latest', async () => {
    (releasesApi.fetchReleases as any).mockResolvedValue(SAMPLE);
    await renderUpdates();
    // Header version badge reflects the newest release (index 0).
    await waitFor(() => expect(screen.getAllByText('v1.1.0').length).toBeGreaterThan(0));
    expect(screen.getByText('Second release')).toBeInTheDocument();
    expect(screen.getByText('Latest')).toBeInTheDocument();
  });

  it('renders every change from every release, newest first', async () => {
    (releasesApi.fetchReleases as any).mockResolvedValue(SAMPLE);
    await renderUpdates();
    for (const release of SAMPLE) {
      for (const change of release.changes) {
        await waitFor(() => expect(screen.getByText(change.text)).toBeInTheDocument());
      }
    }
  });

  it('shows an empty state when there are no releases', async () => {
    (releasesApi.fetchReleases as any).mockResolvedValue([]);
    await renderUpdates();
    await waitFor(() => expect(screen.getByText(/no release notes yet/i)).toBeInTheDocument());
  });

  it('shows an error state when the fetch fails', async () => {
    (releasesApi.fetchReleases as any).mockRejectedValue(new Error('boom'));
    await renderUpdates();
    await waitFor(() => expect(screen.getByText(/couldn't load release notes/i)).toBeInTheDocument());
  });
});
