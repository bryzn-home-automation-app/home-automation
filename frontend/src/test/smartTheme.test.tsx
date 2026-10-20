import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { isDaytime, nextSunChange, sunTimes } from '../utils/sun';
import { ThemeProvider, resolveTheme, useTheme } from '../context/ThemeContext';

// Dallas, TX — the home.
const LAT = 32.78;
const LON = -96.8;

const near = (actual: Date, expectedIso: string) =>
  expect(Math.abs(actual.getTime() - new Date(expectedIso).getTime())).toBeLessThan(5 * 60_000);

describe('sun times', () => {
  it('matches the almanac for the solstices (within minutes)', () => {
    const june = sunTimes(new Date(2026, 5, 21, 12), LAT, LON)!;
    near(june.sunrise, '2026-06-21T11:20:00Z'); // 6:20 AM CDT
    near(june.sunset, '2026-06-22T01:38:00Z'); //  8:38 PM CDT
    const dec = sunTimes(new Date(2026, 11, 21, 12), LAT, LON)!;
    near(dec.sunrise, '2026-12-21T13:25:00Z'); // 7:25 AM CST
    near(dec.sunset, '2026-12-21T23:25:00Z'); //  5:25 PM CST
  });

  it('knows day from night and when the next switch is', () => {
    const noon = new Date('2026-10-20T17:00:00Z'); // noon CDT
    const night = new Date('2026-10-21T04:00:00Z'); // 11 PM CDT
    expect(isDaytime(noon, LAT, LON)).toBe(true);
    expect(isDaytime(night, LAT, LON)).toBe(false);
    expect(isDaytime(noon, null, null)).toBeNull();
    near(nextSunChange(noon, LAT, LON)!, '2026-10-20T23:49:00Z'); // tonight's sunset
    near(nextSunChange(night, LAT, LON)!, '2026-10-21T12:31:00Z'); // tomorrow's sunrise
  });
});

describe('Auto theme', () => {
  beforeEach(() => {
    localStorage.clear();
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    }) as unknown as typeof window.matchMedia;
  });
  afterEach(() => vi.useRealTimers());

  it('resolves light by day and dark by night; falls back to the device without a location', () => {
    const loc = { lat: LAT, lon: LON };
    expect(resolveTheme('auto', loc, new Date('2026-10-20T17:00:00Z'))).toBe('light');
    expect(resolveTheme('auto', loc, new Date('2026-10-21T04:00:00Z'))).toBe('dark');
    expect(resolveTheme('auto', null, new Date('2026-10-20T17:00:00Z'))).toBe('dark'); // device = dark
    expect(resolveTheme('light', loc)).toBe('light');
  });

  function Probe() {
    const { theme, mode, setMode, toggleTheme, setSunLocation } = useTheme();
    return (
      <div>
        <span data-testid="theme">{theme}</span>
        <span data-testid="mode">{mode}</span>
        <button onClick={() => setSunLocation(LAT, LON)}>loc</button>
        <button onClick={() => setMode('auto')}>auto</button>
        <button onClick={toggleTheme}>toggle</button>
      </div>
    );
  }

  it('flips at sunset on its own, and a manual toggle leaves Auto', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-20T23:40:00Z')); // ~9 min before sunset
    render(<ThemeProvider><Probe /></ThemeProvider>);

    act(() => screen.getByText('loc').click());
    act(() => screen.getByText('auto').click());
    expect(screen.getByTestId('theme').textContent).toBe('light');
    expect(localStorage.getItem('theme')).toBe('auto');

    act(() => { vi.advanceTimersByTime(15 * 60_000); });
    expect(screen.getByTestId('theme').textContent).toBe('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');

    act(() => screen.getByText('toggle').click());
    expect(screen.getByTestId('theme').textContent).toBe('light');
    expect(screen.getByTestId('mode').textContent).toBe('light');
    expect(localStorage.getItem('theme')).toBe('light');
  });

  it('remembers the home location for next time', () => {
    render(<ThemeProvider><Probe /></ThemeProvider>);
    act(() => screen.getByText('loc').click());
    expect(JSON.parse(localStorage.getItem('sun-location')!)).toEqual({ lat: LAT, lon: LON });
  });
});
