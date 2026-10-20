// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CHART_SERIES, DATA_SERIES } from '../context/ThemeContext';

/*
 * WCAG contrast guard for the theme tokens in index.css. Light mode used to map
 * the dark-tuned pastel classes (text-amber-300, …) to 500/600 shades that
 * measured 1.2-3.8:1 on white; this keeps the semantic text/fill/chart tokens
 * from drifting back under the minimums (4.5:1 text, 3:1 chart marks).
 */

const css = readFileSync(fileURLToPath(new URL('../index.css', import.meta.url)), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

function block(selector: string): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (m[1].trim().replace(/\s+/g, ' ') !== selector) continue;
    for (const d of m[2].matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) vars[d[1]] = d[2].trim();
  }
  return vars;
}
const BASE = { dark: block(':root, [data-theme="dark"]'), light: block('[data-theme="light"]') };
const tokens = (theme: 'dark' | 'light', palette = 'default') => ({
  ...BASE[theme],
  ...(palette === 'default' ? {} : block(`[data-theme="${theme}"][data-palette="${palette}"]`)),
});

type RGB = [number, number, number];
function rgba(c: string): [number, number, number, number] {
  if (c.startsWith('#')) {
    const n = parseInt(c.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  const p = c.match(/rgba?\(([^)]+)\)/)![1].split(',').map(Number);
  return [p[0], p[1], p[2], p[3] ?? 1];
}
const over = (fg: string, bg: RGB): RGB => {
  const [r, g, b, a] = rgba(fg);
  return [r * a + bg[0] * (1 - a), g * a + bg[1] * (1 - a), b * a + bg[2] * (1 - a)];
};
const lum = ([r, g, b]: RGB) =>
  [r, g, b].map((v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
const ratio = (a: RGB, b: RGB) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};
const solid = (c: string): RGB => over(c, [0, 0, 0]);

/** Card, inset tile, and page surfaces as actually composited. */
function surfaces(t: Record<string, string>): RGB[] {
  const bg = solid(t['--appbg']);
  const raised = over(t['--appsurface-raised'], bg);
  return [bg, solid(t['--appsurface']), raised, over(t['--appinset'], raised)];
}

const THEMES = ['dark', 'light'] as const;
const PALETTES = ['default', 'ocean', 'sunset', 'violet'];

describe('theme token contrast (WCAG 2.2)', () => {
  it.each(THEMES.flatMap((th) => PALETTES.map((p) => [th, p] as const)))('%s/%s: text tokens >= 4.5:1 on every surface', (th, p) => {
    const t = tokens(th, p);
    for (const name of ['--apptext', '--apptext-soft', '--apptext-muted', '--apptext-dim', '--apptext-success', '--apptext-warning', '--apptext-danger', '--apptext-info']) {
      for (const s of surfaces(t)) expect(ratio(solid(t[name]), s), `${name} ${t[name]}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each(THEMES.flatMap((th) => PALETTES.map((p) => [th, p] as const)))('%s/%s: labels on solid accent / danger fills >= 4.5:1', (th, p) => {
    const t = tokens(th, p);
    expect(ratio(solid(t['--appaccent-fg']), solid(t['--appaccent']))).toBeGreaterThanOrEqual(4.5);
    expect(ratio(solid(t['--appdanger-fg']), solid(t['--appdanger']))).toBeGreaterThanOrEqual(4.5);
  });

  it.each(THEMES)('%s: chart series >= 3:1 on --appchart-bg', (th) => {
    const t = tokens(th);
    const chart = solid(t['--appchart-bg']);
    for (const name of ['--appchart-heat', '--appchart-cool', '--appchart-charge']) {
      expect(ratio(solid(t[name]), chart), name).toBeGreaterThanOrEqual(3);
    }
    for (const [pal, modes] of Object.entries(CHART_SERIES)) {
      for (const c of Object.values(modes[th])) expect(ratio(solid(c), chart), `${pal} ${c}`).toBeGreaterThanOrEqual(3);
    }
    for (const [key, c] of Object.entries(DATA_SERIES[th])) expect(ratio(solid(c), chart), `${key} ${c}`).toBeGreaterThanOrEqual(3);
  });
});
