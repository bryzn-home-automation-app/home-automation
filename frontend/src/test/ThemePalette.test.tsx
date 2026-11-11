import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen, fireEvent } from '@testing-library/react';
import { ThemeProvider, useTheme } from '../context/ThemeContext';
import { APP_COLOUR_TOKENS, deriveAppTokens, legacyFinishColour } from '../utils/appColour';

/*
 * The app colour in ThemeProvider: one colour for both themes, applied as inline
 * custom properties on <html>, re-derived when the theme flips, saved per device
 * (with the start-up script's copy of its tokens), a saved finish moved to its
 * colour, and Reset back to the stylesheet's Enamel.
 */

function Probe() {
  const { appColour, theme, setAppColour, previewAppColour, setMode } = useTheme();
  return (
    <div>
      <span data-testid="colour">{appColour ?? 'enamel'}</span>
      <span data-testid="theme">{theme}</span>
      <button onClick={() => setAppColour('#1F4FBF')}>blue</button>
      <button onClick={() => setAppColour('#14b')}>short</button>
      <button onClick={() => setAppColour('nope')}>bad</button>
      <button onClick={() => setAppColour(null)}>reset</button>
      <button onClick={() => previewAppColour('#ff2d95')}>preview</button>
      <button onClick={() => setMode('light')}>light</button>
      <button onClick={() => setMode('dark')}>dark</button>
    </div>
  );
}

const root = document.documentElement;
const renderProbe = () => render(<ThemeProvider><Probe /></ThemeProvider>);
const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }));
const inline = () => Object.fromEntries(APP_COLOUR_TOKENS.map((k) => [k, root.style.getPropertyValue(k)]).filter(([, v]) => v));
const saved = () => localStorage.getItem('app-colour');

describe('app colour', () => {
  beforeEach(() => {
    localStorage.clear();
    root.removeAttribute('style');
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {},
    }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    root.removeAttribute('style');
  });

  it('is Enamel for someone who never chose: nothing inline, nothing saved', () => {
    renderProbe();
    expect(screen.getByTestId('colour')).toHaveTextContent('enamel');
    expect(inline()).toEqual({});
    expect(saved()).toBeNull();
  });

  it('applies the derived tokens on <html>, saves the colour and the start-up copy of its tokens', () => {
    renderProbe();
    click('blue');
    expect(screen.getByTestId('colour')).toHaveTextContent('#1f4fbf');
    expect(inline()).toEqual(deriveAppTokens('#1f4fbf', 'light'));
    expect(saved()).toBe('#1f4fbf');
    expect(JSON.parse(localStorage.getItem('app-colour-tokens')!)).toEqual({
      hex: '#1f4fbf', light: deriveAppTokens('#1f4fbf', 'light'), dark: deriveAppTokens('#1f4fbf', 'dark'),
    });
  });

  it('is one colour for both themes, re-derived when the theme flips', () => {
    renderProbe();
    click('dark');
    click('blue');
    expect(inline()).toEqual(deriveAppTokens('#1f4fbf', 'dark'));
    click('light');
    expect(screen.getByTestId('theme')).toHaveTextContent('light');
    expect(inline()).toEqual(deriveAppTokens('#1f4fbf', 'light'));
    expect(saved()).toBe('#1f4fbf');
  });

  it('takes #RGB, and ignores something that is not a colour', () => {
    renderProbe();
    click('short');
    expect(saved()).toBe('#1144bb');
    click('bad');
    expect(saved()).toBe('#1144bb');
    expect(screen.getByTestId('colour')).toHaveTextContent('#1144bb');
  });

  it('reset goes back to the stylesheet (Enamel) and forgets the colour', () => {
    localStorage.setItem('app-colour', '#1f4fbf');
    renderProbe();
    expect(inline()).toEqual(deriveAppTokens('#1f4fbf', 'light'));
    click('reset');
    expect(screen.getByTestId('colour')).toHaveTextContent('enamel');
    expect(inline()).toEqual({});
    expect(saved()).toBeNull();
    expect(localStorage.getItem('app-colour-tokens')).toBeNull();
  });

  it('a preview paints without saving or re-rendering; the saved colour comes back on the next flip', () => {
    localStorage.setItem('app-colour', '#1f4fbf');
    renderProbe();
    click('preview');
    expect(inline()).toEqual(deriveAppTokens('#ff2d95', 'light'));
    expect(saved()).toBe('#1f4fbf');
    expect(screen.getByTestId('colour')).toHaveTextContent('#1f4fbf');
    click('dark');
    expect(inline()).toEqual(deriveAppTokens('#1f4fbf', 'dark'));
  });

  it('suppresses transitions while the colour flips, for two frames', () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
    try {
      renderProbe();
      act(() => { vi.advanceTimersToNextFrame(); vi.advanceTimersToNextFrame(); });
      expect(root.classList.contains('theme-switching')).toBe(false);
      click('preview');
      expect(root.classList.contains('theme-switching')).toBe(true);
      act(() => { vi.advanceTimersToNextFrame(); vi.advanceTimersToNextFrame(); });
      expect(root.classList.contains('theme-switching')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    ['palette', 'violet'],
    ['palette', 'ocean'],
    ['palette-dark', 'sunset'],
  ])('moves a finish an older build saved (%s = %s) to its preset colour', (key, id) => {
    localStorage.setItem(key, id);
    localStorage.setItem('palette-light', 'default');
    renderProbe();
    const hex = legacyFinishColour(id)!;
    expect(screen.getByTestId('colour')).toHaveTextContent(hex);
    expect(inline()).toEqual(deriveAppTokens(hex, 'light'));
    expect(saved()).toBe(hex);
    for (const k of ['palette', 'palette-dark', 'palette-light']) expect(localStorage.getItem(k)).toBeNull();
  });

  it('a saved colour wins over an old finish', () => {
    localStorage.setItem('app-colour', '#ff2d95');
    localStorage.setItem('palette', 'ocean');
    renderProbe();
    expect(screen.getByTestId('colour')).toHaveTextContent('#ff2d95');
    expect(localStorage.getItem('palette')).toBeNull();
  });

  it('a saved Enamel finish stays Enamel', () => {
    localStorage.setItem('palette', 'default');
    renderProbe();
    expect(screen.getByTestId('colour')).toHaveTextContent('enamel');
    expect(inline()).toEqual({});
    expect(localStorage.getItem('palette')).toBeNull();
  });

  it('points theme-color at the colour’s page', () => {
    const meta = document.createElement('meta');
    meta.name = 'theme-color';
    document.head.appendChild(meta);
    try {
      renderProbe();
      click('blue');
      expect(meta.content).toBe(deriveAppTokens('#1f4fbf', 'light')['--appbg']);
      click('dark');
      expect(meta.content).toBe(deriveAppTokens('#1f4fbf', 'dark')['--appbg']);
    } finally {
      meta.remove();
    }
  });
});
