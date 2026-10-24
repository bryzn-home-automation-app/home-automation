import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

// Every endpoint answers empty; the page should still lay out its tabs.
vi.mock('../api/client', () => ({
  default: {
    get: vi.fn((url: string) =>
      Promise.resolve({
        data: url.includes('summary')
          ? { total24h: 5, errors24h: 3, warns24h: 1 }
          : url.includes('/db/stats')
            ? { databaseSize: '1 MB', rowCounts: {} }
            : [],
      }),
    ),
    post: vi.fn().mockResolvedValue({ data: {} }),
  },
}));

import DebugDashboard from '../pages/admin/DebugDashboard';

function Where() {
  const loc = useLocation();
  return <p data-testid="where">{loc.search}</p>;
}

function renderAt(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            path="/admin/debug"
            element={
              <>
                <DebugDashboard />
                <Where />
              </>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Debug sub-tabs', () => {
  it('opens on Overview and shows one group at a time, remembering the tab in the address', async () => {
    renderAt('/admin/debug');
    expect(screen.getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByText('Run Sync Jobs')).not.toBeInTheDocument();
    expect(screen.queryByText('Test sleep')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: 'Sync' }));
    expect(screen.getByText('Run Sync Jobs')).toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent('?tab=sync');

    fireEvent.click(screen.getByRole('tab', { name: 'Overview' }));
    expect(screen.getByTestId('where')).toHaveTextContent(/^$/);
  });

  it('opens the tab named in the address, and flags errors on Events', async () => {
    renderAt('/admin/debug?tab=tools');
    expect(screen.getByText('Test sleep')).toBeInTheDocument();
    expect(screen.getByText('Query Console')).toBeInTheDocument();
    expect(await screen.findByLabelText('3 errors in the last 24 hours')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: /Events/ }));
    expect(screen.getByText('Diagnostic Log')).toBeInTheDocument();
  });
});
