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

/** A device whose light/dark setting is `dark` (matchMedia answers per query). */
function device(dark: boolean) {
  window.matchMedia = vi.fn((query: string) => ({
    matches: query.includes('dark') ? dark : !dark, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

describe('Auto theme', () => {
  beforeEach(() => {
    localStorage.clear();
    device(false);
  });
  afterEach(() => vi.useRealTimers());

  it('resolves light by day and dark by night; falls back to the device without a location', () => {
    const loc = { lat: LAT, lon: LON };
    expect(resolveTheme('auto', loc, new Date('2026-10-20T17:00:00Z'))).toBe('light');
    expect(resolveTheme('auto', loc, new Date('2026-10-21T04:00:00Z'))).toBe('dark');
    device(true);
    expect(resolveTheme('auto', null, new Date('2026-10-20T17:00:00Z'))).toBe('dark'); // device = dark
    device(false);
    expect(resolveTheme('auto', null, new Date('2026-10-20T17:00:00Z'))).toBe('light'); // device = light
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

describe('theme choice', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('data-palette');
  });

  function Probe() {
    const { theme, mode, setMode } = useTheme();
    return (
      <div>
        <span data-testid="theme">{theme}</span>
        <span data-testid="mode">{mode}</span>
        <button onClick={() => setMode('light')}>light</button>
        <button onClick={() => setMode('system')}>device</button>
      </div>
    );
  }
  const shown = () => [screen.getByTestId('theme').textContent, screen.getByTestId('mode').textContent];

  it('is light for someone who never chose, even on a dark phone, and saves nothing for them', () => {
    device(true);
    render(<ThemeProvider><Probe /></ThemeProvider>);
    expect(shown()).toEqual(['light', 'light']);
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(localStorage.getItem('theme')).toBeNull();
  });

  it('keeps a choice made before the light default', () => {
    device(false);
    localStorage.setItem('theme', 'dark');
    render(<ThemeProvider><Probe /></ThemeProvider>);
    expect(shown()).toEqual(['dark', 'dark']);
  });

  it('can go back to following the device after picking a theme, and remembers that', () => {
    let onChange: ((e: { matches: boolean }) => void) | undefined;
    let dark = true;
    window.matchMedia = vi.fn((query: string) => ({
      matches: query.includes('dark') ? dark : !dark,
      media: query,
      addEventListener: (_: string, fn: (e: { matches: boolean }) => void) => { onChange = fn; },
      removeEventListener: vi.fn(),
    })) as unknown as typeof window.matchMedia;
    render(<ThemeProvider><Probe /></ThemeProvider>);

    act(() => screen.getByRole('button', { name: 'light' }).click());
    expect(shown()).toEqual(['light', 'light']);
    act(() => screen.getByRole('button', { name: 'device' }).click());
    expect(shown()).toEqual(['dark', 'system']);
    expect(localStorage.getItem('theme')).toBe('system');

    // The phone switches to light while the app is open.
    dark = false;
    act(() => onChange?.({ matches: false }));
    expect(shown()).toEqual(['light', 'system']);
  });

  it('sets the attributes as it mounts and saves the theme it showed for the start-up script', () => {
    device(false);
    localStorage.setItem('theme', 'dark');
    localStorage.setItem('palette', 'violet');
    render(<ThemeProvider><Probe /></ThemeProvider>);
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(document.documentElement.getAttribute('data-palette')).toBe('violet');
    expect(localStorage.getItem('theme-resolved')).toBe('dark');
  });

  it('points the browser theme-color at the page colour', () => {
    device(false);
    const meta = document.createElement('meta');
    meta.name = 'theme-color';
    meta.content = '#e9ecea';
    document.head.appendChild(meta);
    // Stands in for index.css, which tests don't load: the dark enamel.
    document.documentElement.style.setProperty('--appbg', '#121416');
    try {
      localStorage.setItem('theme', 'dark');
      render(<ThemeProvider><Probe /></ThemeProvider>);
      expect(meta.content).toBe('#121416');
    } finally {
      meta.remove();
      document.documentElement.style.removeProperty('--appbg');
    }
  });
});
