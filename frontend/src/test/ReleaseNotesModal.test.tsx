import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import * as releasesApi from '../api/releases';
import type { Release } from '../api/releases';

vi.mock('../api/releases', () => ({ fetchReleases: vi.fn() }));
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: { userId: 7, username: 'bry', displayName: 'Bry', role: 'USER' } }),
}));

const LATEST: Release = {
  version: '1.1.0',
  stage: 'beta',
  releasedAt: '2026-09-01',
  title: 'A shiny new version',
  summary: 'Some things changed.',
  changes: [{ type: 'new', text: 'A brand new capability landed.' }],
};

async function renderModal() {
  const { default: ReleaseNotesModal } = await import('../components/ReleaseNotesModal');
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ReleaseNotesModal />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const SEEN_KEY = 'homeos:seenReleaseVersion:7';

describe('ReleaseNotesModal', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    (releasesApi.fetchReleases as any).mockResolvedValue([LATEST]);
  });

  it('pops up the newest release when the user has not seen this version', async () => {
    await renderModal();
    await waitFor(() => expect(screen.getByText(LATEST.title)).toBeInTheDocument());
    expect(screen.getByText(LATEST.changes[0].text)).toBeInTheDocument();
  });

  it('records the version and closes when dismissed', async () => {
    await renderModal();
    await waitFor(() => expect(screen.getByText(LATEST.title)).toBeInTheDocument());
    fireEvent.click(screen.getByText('Got it'));
    await waitFor(() => expect(screen.queryByText(LATEST.title)).not.toBeInTheDocument());
    expect(localStorage.getItem(SEEN_KEY)).toBe('1.1.0');
  });

  it('stays hidden when the newest version was already seen', async () => {
    localStorage.setItem(SEEN_KEY, '1.1.0');
    await renderModal();
    // Give the query + effect a chance to run, then assert it never opened.
    await waitFor(() => expect(releasesApi.fetchReleases).toHaveBeenCalled());
    expect(screen.queryByText(LATEST.title)).not.toBeInTheDocument();
  });
});
