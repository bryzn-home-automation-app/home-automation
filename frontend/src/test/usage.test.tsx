import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, renderHook, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { minutesLabel, tabKey, tabLabel } from '../utils/tabs';

vi.mock('../api/activity', () => ({
  recordTab: vi.fn().mockResolvedValue(undefined),
  primeCameras: vi.fn().mockResolvedValue(undefined),
  fetchTabUsage: vi.fn(),
}));

import * as activityApi from '../api/activity';
import { HEARTBEAT_MS, useAppPresence } from '../hooks/useAppPresence';
import TabUsage from '../pages/admin/TabUsage';

describe('tab names', () => {
  it('maps routes to the tab they belong to', () => {
    expect(tabKey('/')).toBe('home');
    expect(tabKey('/utility')).toBe('utility');
    expect(tabKey('/cameras/')).toBe('cameras');
    expect(tabKey('/admin/debug')).toBe('admin/debug');
    expect(tabKey('/admin')).toBe('admin');
    expect(tabKey('/%20weird')).toBeNull();
    expect(tabLabel('notifications')).toBe('Alerts');
    expect(tabLabel('somewhere-new')).toBe('somewhere-new');
  });

  it('reads minutes as hours past an hour', () => {
    expect(minutesLabel(45)).toBe('45 min');
    expect(minutesLabel(60)).toBe('1 h');
    expect(minutesLabel(185)).toBe('3 h 5 min');
  });
});

describe('useAppPresence', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(activityApi.recordTab).mockClear();
    vi.mocked(activityApi.primeCameras).mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('records the visit, primes the cameras right away, then reports each active minute', () => {
    const { rerender } = renderHook(({ path }) => useAppPresence(path, true), { initialProps: { path: '/' } });
    expect(activityApi.recordTab).toHaveBeenCalledWith('home', 'view');
    expect(activityApi.primeCameras).toHaveBeenCalledTimes(1);

    rerender({ path: '/climate' });
    expect(activityApi.recordTab).toHaveBeenLastCalledWith('climate', 'view');

    act(() => {
      vi.advanceTimersByTime(HEARTBEAT_MS);
    });
    expect(activityApi.recordTab).toHaveBeenLastCalledWith('climate', 'active');
    expect(activityApi.primeCameras).toHaveBeenCalledTimes(2);
  });

  it('sends nothing for a guest', () => {
    renderHook(() => useAppPresence('/', false));
    act(() => {
      vi.advanceTimersByTime(HEARTBEAT_MS * 2);
    });
    expect(activityApi.recordTab).not.toHaveBeenCalled();
    expect(activityApi.primeCameras).not.toHaveBeenCalled();
  });

  it('stops reporting while the app is in the background', () => {
    renderHook(() => useAppPresence('/', true));
    vi.mocked(activityApi.primeCameras).mockClear();
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    act(() => {
      vi.advanceTimersByTime(HEARTBEAT_MS * 2);
    });
    expect(activityApi.primeCameras).not.toHaveBeenCalled();
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
  });
});

describe('TabUsage page', () => {
  it('shows the household totals and each member, busiest first', async () => {
    vi.mocked(activityApi.fetchTabUsage).mockResolvedValue({
      days: 30,
      household: [
        { tab: 'cameras', visits: 4, activeMinutes: 72 },
        { tab: 'home', visits: 9, activeMinutes: 3 },
      ],
      members: [
        {
          userId: 2,
          username: 'sam',
          displayName: 'Sam',
          role: 'USER',
          lastActiveAt: new Date().toISOString(),
          visits: 13,
          activeMinutes: 75,
          tabs: [{ tab: 'cameras', visits: 4, activeMinutes: 72 }],
        },
      ],
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <TabUsage />
      </QueryClientProvider>,
    );
    expect(await screen.findByText('Sam')).toBeInTheDocument();
    expect(screen.getByText(/1 h 15 min active · 13 visits/)).toBeInTheDocument();
    expect(screen.getAllByText('Cameras')).toHaveLength(2);
    expect(screen.getByText(/Last active just now/)).toBeInTheDocument();
    expect(activityApi.fetchTabUsage).toHaveBeenCalledWith(30);
  });
});
