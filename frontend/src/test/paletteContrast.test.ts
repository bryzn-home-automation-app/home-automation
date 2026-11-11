// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CHART_SERIES, DATA_SERIES, KPI_TONES } from '../context/ThemeContext';

/*
 * WCAG contrast guard for the theme tokens in index.css. Light mode used to map
 * the dark-tuned pastel classes (text-amber-300, …) to 500/600 shades that
 * measured 1.2-3.8:1 on white; this keeps the semantic text/fill/chart tokens
 * from drifting back under the minimums (4.5:1 text, 3:1 chart marks) on the
 * Faceplate surfaces (enamel, panel, wells) in both themes and every finish.
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

const THEMES = ['dark', 'light'] as const;
type Theme = (typeof THEMES)[number];
const PALETTES = ['default', 'ocean', 'sunset', 'violet'];

// :root carries the light theme, so dark is the light block with the dark block on top.
const LIGHT = block(':root, [data-theme="light"]');
const BASE: Record<Theme, Record<string, string>> = { light: LIGHT, dark: { ...LIGHT, ...block('[data-theme="dark"]') } };
const finish = (theme: Theme, palette: string) => (palette === 'default' ? {} : block(`[data-theme="${theme}"][data-palette="${palette}"]`));

/** Every token for a theme + finish, with var() aliases resolved. */
function tokens(theme: Theme, palette = 'default'): Record<string, string> {
  const raw = { ...BASE[theme], ...finish(theme, palette) };
  const resolve = (v: string, depth = 0): string => {
    expect(depth, `alias loop in ${v}`).toBeLessThan(10);
    return v.replace(/var\((--[a-z0-9-]+)\)/g, (_, name: string) => {
      expect(raw[name], `${name} is not defined`).toBeDefined();
      return resolve(raw[name], depth + 1);
    });
  };
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, resolve(v)]));
}

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

/** Page, panel, raised panel, and the two wells (as composited on a panel). */
function surfaces(t: Record<string, string>): Array<[string, RGB]> {
  const bg = solid(t['--appbg']);
  const raised = over(t['--appsurface-raised'], bg);
  return [
    ['page', bg],
    ['panel', solid(t['--appsurface'])],
    ['raised', raised],
    ['well', over(t['--appinset'], raised)],
    ['well-strong', over(t['--appinset-strong'], raised)],
  ];
}

const CASES = THEMES.flatMap((th) => PALETTES.map((p) => [th, p] as const));
const TEXT = ['--apptext', '--apptext-soft', '--apptext-muted', '--apptext-dim', '--apptext-success', '--apptext-warning', '--apptext-danger', '--apptext-info'];
const STATUS: Array<[string, string]> = [
  ['--apptext-success', '--apptint-ok'],
  ['--apptext-warning', '--apptint-warn'],
  ['--apptext-danger', '--apptint-problem'],
  ['--apptext-info', '--apptint-info'],
];

describe('theme token contrast (WCAG 2.2)', () => {
  it.each(CASES)('%s/%s: text tokens >= 4.5:1 on every surface and well', (th, p) => {
    const t = tokens(th, p);
    for (const name of TEXT) {
      for (const [where, s] of surfaces(t)) expect(ratio(solid(t[name]), s), `${name} ${t[name]} on ${where}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  // A badge sits on the page, a panel or a well; never on a hovered (strong) well.
  it.each(CASES)('%s/%s: status text >= 4.5:1 inside its own tinted badge', (th, p) => {
    const t = tokens(th, p);
    for (const [text, tint] of STATUS) {
      for (const [where, s] of surfaces(t).filter(([w]) => w !== 'well-strong')) {
        expect(ratio(solid(t[text]), over(t[tint], s)), `${text} on ${tint} over ${where}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it.each(CASES)('%s/%s: labels on solid accent (ink key) / danger fills >= 4.5:1', (th, p) => {
    const t = tokens(th, p);
    expect(ratio(solid(t['--appaccent-fg']), solid(t['--appaccent']))).toBeGreaterThanOrEqual(4.5);
    expect(ratio(solid(t['--appdanger-fg']), solid(t['--appdanger']))).toBeGreaterThanOrEqual(4.5);
    // The ink key itself has to stand off the panel it sits on.
    expect(ratio(solid(t['--appaccent']), solid(t['--appsurface']))).toBeGreaterThanOrEqual(4.5);
  });

  it.each(CASES)('%s/%s: chart series >= 3:1 on --appchart-bg', (th, p) => {
    const t = tokens(th, p);
    const chart = solid(t['--appchart-bg']);
    for (const name of ['--appchart-heat', '--appchart-cool', '--appchart-charge', '--appchart-ink', '--appchart-graphite', '--appchart-water', '--appchart-gas']) {
      expect(ratio(solid(t[name]), chart), name).toBeGreaterThanOrEqual(3);
    }
    for (const [pal, modes] of Object.entries(CHART_SERIES)) {
      for (const c of Object.values(modes[th])) expect(ratio(solid(c), chart), `${pal} ${c}`).toBeGreaterThanOrEqual(3);
    }
    for (const [key, c] of Object.entries(DATA_SERIES[th])) expect(ratio(solid(c), chart), `${key} ${c}`).toBeGreaterThanOrEqual(3);
  });

  it.each(PALETTES)('light/%s: the remapped pastel text steps (text-amber-300, …) >= 4.5:1 on every surface', (p) => {
    const t = tokens('light', p);
    const remap = block(':root:not([data-theme="dark"])');
    expect(Object.keys(remap).length).toBeGreaterThan(40);
    for (const [name, raw] of Object.entries(remap)) {
      const c = raw.replace(/var\((--[a-z0-9-]+)\)/, (_, n: string) => t[n]);
      for (const [where, s] of surfaces(t)) expect(ratio(solid(c), s), `${name} ${c} on ${where}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('palettes are finishes', () => {
  // A finish may tint the surfaces and the hairlines drawn on them, nothing else:
  // never ink, status, lamps or chart colours.
  const SURFACE_ONLY = new Set([
    '--appbg', '--appsurface', '--appsurface-raised', '--appinset', '--appinset-strong', '--appkey', '--appkey-hover',
    '--appmap-floor', '--applamp-off', '--appborder', '--appborder-light', '--appborder-strong',
  ]);

  it.each(CASES.filter(([, p]) => p !== 'default'))('%s/%s tints surfaces only', (th, p) => {
    const declared = Object.keys(finish(th, p));
    expect(declared.length).toBeGreaterThan(0);
    for (const name of declared) expect(SURFACE_ONLY.has(name), `${name} in ${th}/${p}`).toBe(true);
  });

  it('the JS chart colours are the same for every palette', () => {
    for (const modes of Object.values(CHART_SERIES)) expect(modes).toEqual(CHART_SERIES.default);
    for (const modes of Object.values(KPI_TONES)) expect(modes).toEqual(KPI_TONES.default);
  });
});
