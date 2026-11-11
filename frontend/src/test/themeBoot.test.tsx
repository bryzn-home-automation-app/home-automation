import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { ThemeProvider, useTheme } from '../context/ThemeContext';
import { APP_COLOUR_TOKENS, deriveAppTokens, legacyFinishColour } from '../utils/appColour';
// The page itself, as text (this file runs in jsdom, where import.meta.url isn't a file URL).
import html from '../../index.html?raw';

/*
 * The inline script at the top of index.html paints the saved theme and app colour
 * before the first frame. Before it existed the stylesheet's default showed until
 * the bundle loaded, so a saved theme flashed the other one on every cold start.
 * It has to make the same call ThemeProvider makes a moment later, or the page
 * flips once React mounts; these run the real script and compare.
 */

const script = html.match(/<script id="theme-boot">([\s\S]*?)<\/script>/)?.[1] ?? '';

const root = document.documentElement;

function device(dark: boolean) {
  window.matchMedia = vi.fn((query: string) => ({
    matches: query.includes('dark') ? dark : !dark, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

/** What is painted on <html>: the theme and every app-colour token set inline. */
function painted() {
  const tokens: Record<string, string> = {};
  for (const name of APP_COLOUR_TOKENS) {
    const v = root.style.getPropertyValue(name);
    if (v) tokens[name] = v;
  }
  return { theme: root.getAttribute('data-theme'), tokens };
}

function reset() {
  root.removeAttribute('data-theme');
  root.removeAttribute('style');
}

function boot() {
  reset();
  new Function(script)();
  return painted();
}

/** What ThemeProvider sets on <html> once it has mounted. */
function provider() {
  reset();
  render(<ThemeProvider><span /></ThemeProvider>);
  const out = painted();
  cleanup();
  return out;
}

/** Choose a colour the way the picker does (which saves it and its tokens). */
function choose(hex: string | null) {
  function Pick() {
    const { setAppColour } = useTheme();
    return <button onClick={() => setAppColour(hex)}>pick</button>;
  }
  render(<ThemeProvider><Pick /></ThemeProvider>);
  act(() => screen.getByText('pick').click());
  cleanup();
  reset();
}

let meta: HTMLMetaElement;

beforeEach(() => {
  localStorage.clear();
  reset();
  meta = document.createElement('meta');
  meta.name = 'theme-color';
  meta.content = '#e9ecea';
  document.head.appendChild(meta);
});
afterEach(() => {
  meta.remove();
  reset();
  vi.restoreAllMocks();
});

describe('start-up theme script (index.html)', () => {
  it('is in the page head', () => {
    expect(script).toContain('data-theme');
    expect(html.indexOf('id="theme-boot"')).toBeLessThan(html.indexOf('src="/src/main.tsx"'));
  });

  it.each([
    ['nothing saved, on a dark phone', {}, true, 'light'],
    ['Light', { theme: 'light' }, true, 'light'],
    ['Dark', { theme: 'dark' }, false, 'dark'],
    ['Device, on a dark phone', { theme: 'system' }, true, 'dark'],
    ['Device, on a light phone', { theme: 'system' }, false, 'light'],
    ['a finish that no longer exists', { palette: 'neon' }, false, 'light'],
    ['Enamel saved by an older build', { palette: 'default' }, false, 'light'],
  ] as const)('%s: paints what ThemeProvider will show (Enamel, nothing inline)', (_, saved, dark, theme) => {
    for (const [k, v] of Object.entries(saved)) localStorage.setItem(k, v);
    device(dark);
    const before = boot();
    expect(before).toEqual({ theme, tokens: {} });
    expect(provider()).toEqual(before);
  });

  it.each([
    ['#1f4fbf', 'light'], ['#1f4fbf', 'dark'], ['#ffd400', 'light'], ['#ff2d95', 'dark'], ['#808080', 'dark'],
  ] as const)('a chosen colour (%s, %s): paints every derived token before the bundle, the same as ThemeProvider', (hex, theme) => {
    choose(hex);
    localStorage.setItem('theme', theme);
    device(false);
    const before = boot();
    expect(before.theme).toBe(theme);
    expect(before.tokens).toEqual(deriveAppTokens(hex, theme));
    expect(provider()).toEqual(before);
    expect(meta.content).toBe(deriveAppTokens(hex, theme)['--appbg']);
  });

  it('follows the theme for a colour: Auto paints the theme it last showed with that theme’s tokens', () => {
    choose('#1e7a4c');
    localStorage.setItem('theme', 'auto');
    localStorage.setItem('theme-resolved', 'dark');
    device(false);
    expect(boot()).toEqual({ theme: 'dark', tokens: deriveAppTokens('#1e7a4c', 'dark') });
  });

  it.each(['ocean', 'sunset', 'violet'])('a finish an older build saved (%s): paints its colour’s page tone, then the app moves it to a colour', (id) => {
    const hex = legacyFinishColour(id)!;
    for (const theme of ['light', 'dark'] as const) {
      localStorage.clear();
      localStorage.setItem('palette', id);
      localStorage.setItem('theme', theme);
      const before = boot();
      expect(before.tokens).toEqual({ '--appbg': deriveAppTokens(hex, theme)['--appbg'] });
      expect(meta.content).toBe(before.tokens['--appbg']);
      // ThemeProvider paints the whole colour, saves it, and retires the finish keys...
      expect(provider().tokens).toEqual(deriveAppTokens(hex, theme));
      expect(localStorage.getItem('app-colour')).toBe(hex);
      expect(localStorage.getItem('palette')).toBeNull();
      // ...so the next cold start paints all of it.
      expect(boot().tokens).toEqual(deriveAppTokens(hex, theme));
    }
  });

  it('adopts a finish an older build stored for only one mode', () => {
    localStorage.setItem('palette-light', 'default');
    localStorage.setItem('palette-dark', 'violet');
    device(false);
    expect(boot().tokens['--appbg']).toBe(deriveAppTokens(legacyFinishColour('violet')!, 'light')['--appbg']);
    expect(provider().tokens).toEqual(deriveAppTokens(legacyFinishColour('violet')!, 'light'));
  });

  it('paints Auto as the theme the app last showed (the sun maths is in the bundle)', () => {
    localStorage.setItem('theme', 'auto');
    localStorage.setItem('theme-resolved', 'dark');
    device(false);
    expect(boot().theme).toBe('dark');
    localStorage.removeItem('theme-resolved');
    device(true);
    expect(boot().theme).toBe('dark'); // never shown yet: the device, like ThemeProvider without a location
  });

  it('tints the browser chrome dark before the stylesheet loads', () => {
    localStorage.setItem('theme', 'dark');
    boot();
    expect(meta.content).toBe('#121416');
  });

  it('paints nothing from tokens that belong to another colour, or that are not JSON', () => {
    localStorage.setItem('app-colour', '#1f4fbf');
    localStorage.setItem('app-colour-tokens', JSON.stringify({ hex: '#ff0000', light: { '--appbg': '#ff0000' } }));
    expect(boot().tokens).toEqual({});
    localStorage.setItem('app-colour-tokens', '{not json');
    expect(boot().tokens).toEqual({});
  });

  it('falls back to light Enamel when storage is blocked', () => {
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    device(true);
    expect(boot()).toEqual({ theme: 'light', tokens: {} });
  });
});
