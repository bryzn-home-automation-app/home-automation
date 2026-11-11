import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { ThemeProvider } from '../context/ThemeContext';
// The page itself, as text (this file runs in jsdom, where import.meta.url isn't a file URL).
import html from '../../index.html?raw';

/*
 * The inline script at the top of index.html paints the saved theme and finish
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

function boot() {
  root.removeAttribute('data-theme');
  root.removeAttribute('data-palette');
  new Function(script)();
  return { theme: root.getAttribute('data-theme'), palette: root.getAttribute('data-palette') };
}

/** What ThemeProvider sets on <html> once it has mounted. */
function provider() {
  render(<ThemeProvider><span /></ThemeProvider>);
  const out = { theme: root.getAttribute('data-theme'), palette: root.getAttribute('data-palette') };
  cleanup();
  return out;
}

let meta: HTMLMetaElement;

beforeEach(() => {
  localStorage.clear();
  meta = document.createElement('meta');
  meta.name = 'theme-color';
  meta.content = '#e9ecea';
  document.head.appendChild(meta);
});
afterEach(() => {
  meta.remove();
  vi.restoreAllMocks();
});

describe('start-up theme script (index.html)', () => {
  it('is in the page head', () => {
    expect(script).toContain('data-theme');
    expect(html.indexOf('id="theme-boot"')).toBeLessThan(html.indexOf('src="/src/main.tsx"'));
  });

  it.each([
    ['nothing saved, on a dark phone', {}, true, 'light', 'default'],
    ['Light', { theme: 'light' }, true, 'light', 'default'],
    ['Dark', { theme: 'dark' }, false, 'dark', 'default'],
    ['Device, on a dark phone', { theme: 'system' }, true, 'dark', 'default'],
    ['Device, on a light phone', { theme: 'system' }, false, 'light', 'default'],
    ['a finish', { theme: 'dark', palette: 'ocean' }, false, 'dark', 'ocean'],
    ['a finish an older build saved for one mode', { 'palette-light': 'default', 'palette-dark': 'violet' }, false, 'light', 'violet'],
    ['a finish that no longer exists', { palette: 'neon' }, false, 'light', 'default'],
  ] as const)('%s: paints what ThemeProvider will show', (_, saved, dark, theme, palette) => {
    for (const [k, v] of Object.entries(saved)) localStorage.setItem(k, v);
    device(dark);
    const painted = boot();
    expect(painted).toEqual({ theme, palette });
    expect(provider()).toEqual(painted);
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

  it('falls back to light when storage is blocked', () => {
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    device(true);
    expect(boot()).toEqual({ theme: 'light', palette: 'default' });
  });
});
