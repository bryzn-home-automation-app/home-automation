import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, MemoryRouter, Route, Routes } from 'react-router-dom';
import { ROUTES, canSee, routeForPath, visibleRoutes, type Role } from '../routes';
import { tabKey, tabLabel } from '../utils/tabs';
import { houseStatus } from '../components/shell/houseStatus';
import { initialsOf } from '../components/shell/ShellAvatar';
import PageSkeleton from '../components/PageSkeleton';

// ── The shell's outside world, mocked ──
let health: () => Promise<unknown> = () => Promise.resolve({ status: 'UP', database: 'connected' });
vi.mock('../api/client', () => ({
  default: {
    get: vi.fn((url: string) => (url === '/health' ? health().then((data) => ({ data })) : Promise.resolve({ data: {} }))),
    post: vi.fn().mockResolvedValue({ data: {} }),
  },
}));
vi.mock('../api/notifications', () => ({ fetchUnreadCount: vi.fn().mockResolvedValue(3) }));
vi.mock('../api/releases', () => ({ fetchReleases: vi.fn().mockResolvedValue([]) }));
vi.mock('../api/activity', () => ({
  recordTab: vi.fn().mockResolvedValue(undefined),
  primeCameras: vi.fn().mockResolvedValue(undefined),
  fetchTabUsage: vi.fn(),
}));

let role: Role = 'ADMIN';
const logout = vi.fn();
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({
    user: { userId: 1, username: 'bryan', displayName: 'Bryan', role, accentColor: '#0ea5e9' },
    token: 't',
    isLoading: false,
    isAdmin: role === 'ADMIN',
    isUser: role === 'USER',
    isGuest: role === 'GUEST',
    logout,
  }),
}));
const setMode = vi.fn();
vi.mock('../context/ThemeContext', () => ({
  useTheme: () => ({
    toggleTheme: vi.fn(),
    isDark: false,
    mode: 'light',
    setMode,
    setSunLocation: vi.fn(),
  }),
}));

// Sleep on demand: the real hook needs ten idle minutes.
let setAsleep: (v: boolean) => void = () => {};
vi.mock('../hooks/useAppSleep', async () => {
  const React = await import('react');
  return {
    useAppSleep: () => {
      const [asleep, set] = React.useState(false);
      setAsleep = set;
      return { asleep, secondsLeft: null, warningSeconds: 60, testing: false, wake: () => set(false) };
    },
  };
});

import App from '../App';

function renderShell(path: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route element={<App />}>
            <Route path="*" element={<p>Page body</p>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('route registry', () => {
  it('names every page once, with the usage key its URL records', () => {
    for (const r of ROUTES) expect(tabKey(r.path)).toBe(r.id);
    expect(new Set(ROUTES.map((r) => r.id)).size).toBe(ROUTES.length);
  });

  it('agrees with the router in main.tsx', () => {
    const main = readFileSync(resolve(__dirname, '../main.tsx'), 'utf8');
    for (const r of ROUTES) {
      if (r.path === '/') expect(main).toContain('<Route index');
      else expect(main).toContain(`path="${r.path.slice(1)}"`);
    }
  });

  it('finds the page for a URL, including paths under it', () => {
    expect(routeForPath('/')?.title).toBe('Home');
    expect(routeForPath('/utility')?.title).toBe('Utilities');
    expect(routeForPath('/climate/')?.title).toBe('Climate');
    expect(routeForPath('/admin/nuc')?.title).toBe('Server health');
    expect(routeForPath('/admin/debug/anything')?.title).toBe('Diagnostics');
    expect(routeForPath('/nowhere')).toBeUndefined();
  });

  it('gates pages the way the guards do', () => {
    const ids = (r: Role) => visibleRoutes(r).map((x) => x.id);
    expect(ids('GUEST')).not.toContain('cameras');
    expect(ids('GUEST')).not.toContain('maintenance');
    expect(ids('GUEST').some((id) => id.startsWith('admin/'))).toBe(false);
    expect(ids('USER')).toContain('cameras');
    expect(ids('USER').some((id) => id.startsWith('admin/'))).toBe(false);
    expect(ids('ADMIN')).toContain('admin/nuc');
    expect(canSee(ROUTES[0], null)).toBe(false);
  });

  it('gives App usage a plain name for every page (Server health was "admin/nuc")', () => {
    expect(tabLabel('admin/nuc')).toBe('Server health');
    expect(tabLabel('climate')).toBe('Climate');
    expect(tabLabel('gas')).toBe('Gas');
    for (const r of ROUTES) expect(tabLabel(r.id)).not.toBe(r.id);
  });
});

describe('House lamp', () => {
  it('says Checking until the first answer, not Offline', () => {
    expect(houseStatus({ isPending: true, isError: false })).toBe('checking');
  });

  it('goes Offline when a later check fails, even with an old good answer cached', () => {
    expect(houseStatus({ isPending: false, isError: true, data: { status: 'UP' } })).toBe('offline');
  });

  it('is OK only when the server and its database answer', () => {
    expect(houseStatus({ isPending: false, isError: false, data: { status: 'UP', database: 'connected' } })).toBe('ok');
    expect(houseStatus({ isPending: false, isError: false, data: { status: 'UP', database: 'disconnected' } })).toBe('problem');
    expect(houseStatus({ isPending: false, isError: false, data: { status: 'DOWN' } })).toBe('offline');
  });
});

describe('shell avatar initials', () => {
  it('matches profile/Avatar: one word one letter, two words two', () => {
    expect(initialsOf('Bryan')).toBe('B');
    expect(initialsOf('Mai Tran')).toBe('MT');
    expect(initialsOf('')).toBe('?');
  });
});

describe('PageSkeleton', () => {
  it('inside the shell is only the page body, announced as loading', () => {
    const { container } = render(<PageSkeleton variant="stats-charts" />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
    expect(container.innerHTML).not.toMatch(/min-h-screen|min-h-\[100dvh\]/);
  });

  it('on a public page paints the whole page', () => {
    const { container } = render(<PageSkeleton variant="form" fullPage />);
    expect(container.firstElementChild).toHaveClass('bg-appbg');
  });
});

describe('the shell', () => {
  beforeEach(() => {
    role = 'ADMIN';
    health = () => Promise.resolve({ status: 'UP', database: 'connected' });
    logout.mockClear();
  });
  afterEach(() => {
    document.title = '';
  });

  it('renders one title from the registry, in the header and the browser tab', async () => {
    renderShell('/utility');
    expect(screen.getByRole('heading', { level: 1, name: 'Utilities' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByText('Everyday')).toBeInTheDocument();
    expect(screen.getByText('Page body')).toBeInTheDocument();
    await waitFor(() => expect(document.title).toBe('Utilities · HomeOS'));
  });

  it('drops the old header chips, header art and footer', () => {
    renderShell('/');
    expect(screen.queryByText('Backend')).not.toBeInTheDocument();
    expect(screen.queryByText('Access')).not.toBeInTheDocument();
    expect(screen.queryByText(/Phase 1/)).not.toBeInTheDocument();
    expect(screen.queryByRole('contentinfo')).not.toBeInTheDocument();
  });

  it('shows the House lamp as Checking while the first health check runs, then OK', async () => {
    let answer: (v: unknown) => void = () => {};
    health = () => new Promise((r) => (answer = r));
    renderShell('/');
    const plate = screen.getByRole('link', { name: /House status/ });
    expect(plate).toHaveTextContent('Checking');
    expect(plate).not.toHaveTextContent('Offline');
    await act(async () => answer({ status: 'UP', database: 'connected' }));
    await waitFor(() => expect(plate).toHaveTextContent('OK'));
  });

  it('shows the House lamp Offline when the server does not answer', async () => {
    health = () => Promise.reject(new Error('502'));
    renderShell('/');
    await waitFor(() => expect(screen.getByRole('link', { name: /House status/ })).toHaveTextContent('Offline'));
  });

  it('labels the navigation, marks the open page, and shows the unread count on Alerts', async () => {
    renderShell('/climate');
    const navs = screen.getAllByRole('navigation', { name: 'Main' });
    expect(navs.length).toBeGreaterThan(0);
    const column = navs[0];
    expect(within(column).getByRole('link', { name: 'Climate' })).toHaveAttribute('aria-current', 'page');
    expect(await within(column).findByRole('link', { name: 'Alerts, 3 unread' })).toBeInTheDocument();
    // The strip's Alerts plate and the column's Alerts key both carry the count.
    const alerts = screen.getAllByRole('link', { name: 'Alerts, 3 unread' });
    expect(alerts).toHaveLength(2);
    for (const a of alerts) expect(a).toHaveAttribute('href', '/notifications');
    // Icons, not emoji: no tab name is read with a pictograph in front of it.
    expect(column.textContent).not.toMatch(/\p{Extended_Pictographic}/u);
  });

  it('shows Admin keys to admins only, and hides Cameras from guests', () => {
    const { unmount } = renderShell('/');
    expect(screen.getAllByRole('link', { name: 'Server' }).length).toBeGreaterThan(0);
    unmount();

    role = 'USER';
    const member = renderShell('/');
    expect(screen.queryByRole('link', { name: 'Server' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Cameras' }).length).toBeGreaterThan(0);
    member.unmount();

    role = 'GUEST';
    renderShell('/');
    expect(screen.queryByRole('link', { name: 'Cameras' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Maintenance' })).not.toBeInTheDocument();
  });

  it('opens the More sheet as a dialog, closes it on Escape and returns focus to More', async () => {
    renderShell('/');
    const more = await screen.findByRole('button', { name: /^More/ });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(more);
    const sheet = screen.getByRole('dialog', { name: 'More' });
    expect(sheet).toHaveAttribute('aria-modal', 'true');
    expect(more).toHaveAttribute('aria-expanded', 'true');
    expect(within(sheet).getByRole('heading', { name: 'Admin' })).toBeInTheDocument();
    expect(within(sheet).getByRole('link', { name: "Who's home" })).toHaveAttribute('href', '/admin/presence');
    await waitFor(() => expect(sheet.contains(document.activeElement)).toBe(true));

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'More' })).not.toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toBe(more));
  });

  it('switches the theme and signs out from the More sheet', () => {
    renderShell('/');
    fireEvent.click(screen.getByRole('button', { name: /^More/ }));
    const sheet = screen.getByRole('dialog', { name: 'More' });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Dark' }));
    expect(setMode).toHaveBeenCalledWith('dark');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Sign out' }));
    expect(logout).toHaveBeenCalled();
  });

  it('closes the More sheet when the app falls asleep, so nothing covers the night-light', async () => {
    renderShell('/');
    fireEvent.click(screen.getByRole('button', { name: /^More/ }));
    expect(screen.getByRole('dialog', { name: 'More' })).toBeInTheDocument();
    act(() => setAsleep(true));
    expect(screen.getByRole('dialog', { name: 'App is asleep' })).toBeInTheDocument();
    expect(document.querySelector('.fp-dialog')).toBeNull();
    // Waking doesn't bring it back.
    act(() => setAsleep(false));
    expect(screen.queryByRole('dialog', { name: 'More' })).not.toBeInTheDocument();
  });

  it('closes the More sheet when the window widens past the key-row breakpoint', () => {
    let listener: (() => void) | null = null;
    const mq = { matches: false, addEventListener: (_: string, l: () => void) => (listener = l), removeEventListener: () => {} };
    const original = window.matchMedia;
    window.matchMedia = vi.fn(() => mq) as unknown as typeof window.matchMedia;
    try {
      renderShell('/');
      fireEvent.click(screen.getByRole('button', { name: /^More/ }));
      expect(screen.getByRole('dialog', { name: 'More' })).toBeInTheDocument();
      mq.matches = true;
      act(() => listener?.());
      expect(screen.queryByRole('dialog', { name: 'More' })).not.toBeInTheDocument();
    } finally {
      window.matchMedia = original;
    }
  });

  it("choosing a page in the More sheet leaves one history entry, not the sheet's as well", async () => {
    // Earlier tests closed sheets whose history.back() jsdom runs asynchronously: let them land,
    // then push, which drops any forward entries, so length counts the entries up to here.
    await act(() => new Promise((r) => setTimeout(r, 50)));
    window.history.pushState(null, '', '/roomba');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <BrowserRouter>
          <Routes>
            <Route element={<App />}>
              <Route path="*" element={<p>Page body</p>} />
            </Route>
          </Routes>
        </BrowserRouter>
      </QueryClientProvider>,
    );
    const before = window.history.length;
    fireEvent.click(screen.getByRole('button', { name: /^More/ }));
    // useBackToClose pushes the sheet's Back entry a tick after it opens.
    await waitFor(() => expect(window.history.state?.overlay).toBeTruthy());
    fireEvent.click(within(screen.getByRole('dialog', { name: 'More' })).getByRole('link', { name: 'Guest Wi-Fi' }));
    await waitFor(() => expect(window.location.pathname).toBe('/wifi'));
    expect(screen.queryByRole('dialog', { name: 'More' })).not.toBeInTheDocument();
    expect(window.history.length).toBe(before + 1);
  });

  it('keeps the phone page scroll box and an unblurred, touch-none key row', () => {
    const { container } = renderShell('/');
    const box = container.querySelector('[data-page-scroller]');
    expect(box).toHaveClass('max-lg:h-[100dvh]', 'max-lg:overflow-y-auto');
    const row = container.querySelector('.fp-keyrow');
    expect(row).toHaveClass('touch-none');
    expect(row?.className).not.toMatch(/backdrop-blur/);
  });
});
