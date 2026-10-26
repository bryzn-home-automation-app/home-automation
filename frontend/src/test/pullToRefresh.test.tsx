import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PullToRefresh, { PULL_THRESHOLD, pullDistance } from '../components/PullToRefresh';

function setup() {
  const client = new QueryClient();
  const refetch = vi.spyOn(client, 'refetchQueries').mockResolvedValue(undefined);
  render(<QueryClientProvider client={client}><PullToRefresh /></QueryClientProvider>);
  return refetch;
}

/** A one-finger drag from (x, 20) down by dy, then release. */
function drag(dy: number, dx = 0) {
  fireEvent.touchStart(document, { touches: [{ clientX: 100, clientY: 20 }] });
  for (let step = 1; step <= 4; step++) {
    fireEvent.touchMove(document, { touches: [{ clientX: 100 + (dx * step) / 4, clientY: 20 + (dy * step) / 4 }] });
  }
  fireEvent.touchEnd(document, { touches: [] });
}

describe('pull to refresh', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('resists: the chip moves about half as far as the finger, up to a cap', () => {
    expect(pullDistance(-20)).toBe(0);
    expect(pullDistance(100)).toBeGreaterThan(40);
    expect(pullDistance(100)).toBeLessThan(50);
    expect(pullDistance(2000)).toBe(110);
  });

  it('a long pull at the top refetches what is on screen, then says Updated', async () => {
    const refetch = setup();
    await act(async () => drag(240));
    expect(pullDistance(240)).toBeGreaterThanOrEqual(PULL_THRESHOLD);
    expect(refetch).toHaveBeenCalledWith({ type: 'active' });
    expect(await screen.findByText('Updated')).toBeInTheDocument();
  });

  it('a short pull, a sideways swipe, or a pull from partway down the page does nothing', async () => {
    const refetch = setup();
    await act(async () => drag(60));
    await act(async () => drag(30, 200));
    Object.defineProperty(window, 'scrollY', { value: 300, configurable: true });
    await act(async () => drag(240));
    expect(refetch).not.toHaveBeenCalled();
  });

  it('ignores drags inside a dialog', async () => {
    const refetch = setup();
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    document.body.appendChild(dialog);
    await act(async () => {
      fireEvent.touchStart(dialog, { touches: [{ clientX: 100, clientY: 20 }] });
      fireEvent.touchMove(dialog, { touches: [{ clientX: 100, clientY: 260 }] });
      fireEvent.touchEnd(dialog, { touches: [] });
    });
    expect(refetch).not.toHaveBeenCalled();
    dialog.remove();
  });
});
