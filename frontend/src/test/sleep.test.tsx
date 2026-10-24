import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { SLEEP_AFTER_MS, SLEEP_WARNING_MS, useAppSleep } from '../hooks/useAppSleep';
import { SleepScreen } from '../components/SleepScreen';

vi.mock('../api/activity', () => ({
  recordTab: vi.fn().mockResolvedValue(undefined),
  primeCameras: vi.fn().mockResolvedValue(undefined),
  fetchTabUsage: vi.fn(),
}));

import * as activityApi from '../api/activity';
import { HEARTBEAT_MS, useAppPresence } from '../hooks/useAppPresence';

const setVisibility = (v: 'visible' | 'hidden') => {
  Object.defineProperty(document, 'visibilityState', { value: v, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
};

describe('useAppSleep', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    setVisibility('visible');
    vi.useRealTimers();
  });

  const advance = (ms: number) =>
    act(() => {
      vi.advanceTimersByTime(ms);
    });

  it('counts down in the last minute, and any movement cancels it', () => {
    const { result } = renderHook(() => useAppSleep(true));
    advance(SLEEP_AFTER_MS - SLEEP_WARNING_MS - 2_000);
    expect(result.current.secondsLeft).toBeNull();
    advance(3_000);
    expect(result.current.secondsLeft).toBeGreaterThanOrEqual(58);
    expect(result.current.secondsLeft).toBeLessThanOrEqual(60);

    act(() => {
      window.dispatchEvent(new Event('pointermove'));
    });
    expect(result.current.secondsLeft).toBeNull();
    advance(SLEEP_AFTER_MS - SLEEP_WARNING_MS - 2_000);
    expect(result.current.asleep).toBe(false);
  });

  it('sleeps after 10 untouched minutes; a nudge does not wake it, a key does', () => {
    const { result } = renderHook(() => useAppSleep(true));
    advance(SLEEP_AFTER_MS + 1_000);
    expect(result.current.asleep).toBe(true);

    act(() => {
      window.dispatchEvent(new Event('pointermove'));
      window.dispatchEvent(new Event('scroll'));
    });
    expect(result.current.asleep).toBe(true);

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));
    });
    expect(result.current.asleep).toBe(false);
  });

  it('never sleeps while hidden, and coming back wakes it', () => {
    const { result } = renderHook(() => useAppSleep(true));
    act(() => setVisibility('hidden'));
    advance(SLEEP_AFTER_MS * 3);
    expect(result.current.asleep).toBe(false);
    act(() => setVisibility('visible'));
    advance(SLEEP_AFTER_MS - SLEEP_WARNING_MS - 2_000);
    expect(result.current.secondsLeft).toBeNull();

    advance(SLEEP_AFTER_MS);
    expect(result.current.asleep).toBe(true);
    act(() => setVisibility('hidden'));
    act(() => setVisibility('visible'));
    expect(result.current.asleep).toBe(false);
  });

  it('does nothing when signed out', () => {
    const { result } = renderHook(() => useAppSleep(false));
    advance(SLEEP_AFTER_MS * 2);
    expect(result.current.asleep).toBe(false);
  });

  it('an asleep app stops the camera warm-up and active minutes', () => {
    vi.mocked(activityApi.primeCameras).mockClear();
    vi.mocked(activityApi.recordTab).mockClear();
    const { rerender } = renderHook(({ asleep }) => useAppPresence('/cameras', true, asleep), { initialProps: { asleep: false } });
    expect(activityApi.primeCameras).toHaveBeenCalledTimes(1);
    rerender({ asleep: true });
    advance(HEARTBEAT_MS * 3);
    expect(activityApi.primeCameras).toHaveBeenCalledTimes(1);
    expect(activityApi.recordTab).not.toHaveBeenCalledWith('cameras', 'active');
    rerender({ asleep: false });
    expect(activityApi.primeCameras).toHaveBeenCalledTimes(2);
  });
});

describe('SleepScreen', () => {
  it('wakes on a tap', () => {
    const onWake = vi.fn();
    render(<SleepScreen onWake={onWake} />);
    expect(screen.getByRole('dialog', { name: 'App is asleep' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Tap to wake' }));
    expect(onWake).toHaveBeenCalled();
  });
});
