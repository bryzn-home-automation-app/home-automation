// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  APP_COLOUR_PRESETS, APP_COLOUR_TOKENS, ENAMEL, GREY_CHROMA, deriveAppTokens, hexToHsv, hexToOklch, hsvToHex, legacyFinishColour, parseHex,
  type ThemeName, type Tokens,
} from '../utils/appColour';
import { CHART_SERIES, DATA_SERIES } from '../context/ThemeContext';

/*
 * The app colour's guarantees, checked over several hundred colours in both themes:
 * whatever hex comes in, every text colour the stylesheet defines keeps 4.5:1 on every
 * generated surface (and inside its own tinted badge), chart marks keep 3:1 on the
 * panel, the selection fill carries its label at 4.5:1 and stands off the grounds it
 * sits on at 3:1, and hairlines show at least as well as Enamel's. The fixed colours
 * are read from index.css here, and the contrast maths is this file's own, so neither
 * the module's copy of the colours nor its maths is trusted.
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
const LIGHT = block(':root, [data-theme="light"]');
const RAW: Record<ThemeName, Record<string, string>> = { light: LIGHT, dark: { ...LIGHT, ...block('[data-theme="dark"]') } };
/** The stylesheet's tokens for a theme with an app colour's inline values on top, var() resolved. */
function resolved(theme: ThemeName, inline: Tokens = {}): Record<string, string> {
  const raw = { ...RAW[theme], ...inline };
  const res = (v: string, d = 0): string => (d > 10 ? v : v.replace(/var\((--[a-z0-9-]+)\)/g, (_, n: string) => res(raw[n], d + 1)));
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, res(v)]));
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
const solid = (c: string): RGB => over(c, [0, 0, 0]);
const lum = ([r, g, b]: RGB) =>
  [r, g, b].map((v) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)).reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
const ratio = (a: RGB, b: RGB) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

// ── The sample: named edge cases, every preset, and a deterministic spread ──
const EDGES = [
  '#000000', '#ffffff', '#111111', '#808080', '#fefefe', '#010101', '#c9cfcb', '#7f7f80',
  '#ff0000', '#00ff00', '#0000ff', '#ffff00', '#00ffff', '#ff00ff', '#ffd400', '#ff2d95', '#39ff14', '#1f4fbf', '#1e7a4c',
  '#fff200', '#ccff00', '#ff6ec7', '#7df9ff', '#ff5f1f', '#4d4dff', '#bc13fe', '#0d0221', '#f5f5dc', '#ffe4e1', '#e6e6fa',
  '#3b2f2f', '#2f4f4f', '#b22222', '#ffa500', '#8b4513', '#006400', '#000080', '#800080', '#708090', '#d2b48c',
];
let seed = 0x5eed;
const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const SPREAD = Array.from({ length: 420 }, () => `#${Math.floor(rand() * 0xffffff).toString(16).padStart(6, '0')}`);
// The hue circle at full and half saturation and three brightnesses, so no hue band is missed.
const RING = Array.from({ length: 36 }, (_, i) => [1, 0.55].flatMap((s) => [1, 0.7, 0.35].map((v) => hsvToHex({ h: i * 10, s, v })))).flat();
const SAMPLE = [...new Set([...EDGES, ...APP_COLOUR_PRESETS.flatMap((p) => (p.hex ? [p.hex] : [])), ...RING, ...SPREAD])];
const THEMES: ThemeName[] = ['light', 'dark'];

// ── The fixed colours drawn on the generated ones, from the stylesheet ──
const fixed = (theme: ThemeName) => {
  const t = resolved(theme);
  const text = ['--apptext', '--apptext-soft', '--apptext-muted', '--apptext-dim', '--apptext-success', '--apptext-warning', '--apptext-danger', '--apptext-info'].map((n) => t[n]);
  const remap = theme === 'light' ? Object.values(block(':root:not([data-theme="dark"])')).map((v) => v.replace(/var\((--[a-z0-9-]+)\)/, (_, n: string) => t[n])) : [];
  const badges: Array<[string, string]> = [
    [t['--apptext-success'], t['--apptint-ok']], [t['--apptext-warning'], t['--apptint-warn']],
    [t['--apptext-danger'], t['--apptint-problem']], [t['--apptext-info'], t['--apptint-info']],
  ];
  const chart = [
    ...['--appchart-heat', '--appchart-cool', '--appchart-charge', '--appchart-ink', '--appchart-graphite', '--appchart-water', '--appchart-gas'].map((n) => t[n]),
    ...Object.values(CHART_SERIES.default[theme]), ...Object.values(DATA_SERIES[theme]),
  ];
  const ink = ['--apptext', '--apptext-soft', '--apptext-muted', '--apptext-dim'].map((n) => t[n]);
  return { text: [...text, ...remap], badges, chart, ink };
};
const FIXED = { light: fixed('light'), dark: fixed('dark') };

/** Enamel's hairline visibility, the floor every colour's hairlines must reach. */
const enamelLine = (theme: ThemeName, line: string, ground: string) => {
  const t = resolved(theme);
  const g = solid(t[ground]);
  return ratio(over(t[line], g), g);
};

const derived = THEMES.flatMap((theme) => SAMPLE.map((hex) => ({ theme, hex, t: resolved(theme, deriveAppTokens(hex, theme)) })));

describe('the app colour holds its contrast for any colour', () => {
  it(`samples a wide set (${SAMPLE.length} colours x 2 themes)`, () => {
    expect(SAMPLE.length).toBeGreaterThan(500);
    expect(new Set(SAMPLE.map((h) => Math.floor(hexToOklch(h).h / 30))).size).toBe(12);
  });

  it('only sets the tokens it owns, each a solid hex or an rgba hairline', () => {
    for (const theme of THEMES) {
      for (const hex of SAMPLE.slice(0, 80)) {
        const t = deriveAppTokens(hex, theme);
        expect(Object.keys(t).sort()).toEqual([...APP_COLOUR_TOKENS].sort());
        for (const [k, v] of Object.entries(t)) expect(v, `${theme} ${hex} ${k}`).toMatch(/^#[0-9a-f]{6}$|^rgba\(\d+, \d+, \d+, [\d.]+\)$/);
      }
    }
  });

  it('every text colour >= 4.5:1 on the page, panel and wells', () => {
    for (const { theme, hex, t } of derived) {
      for (const ground of ['--appbg', '--appsurface', '--appsurface-raised', '--appinset', '--appinset-strong']) {
        const g = solid(t[ground]);
        for (const c of FIXED[theme].text) expect(ratio(solid(c), g), `${theme} ${hex}: ${c} on ${ground} ${t[ground]}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('ink text >= 4.5:1 on the key faces', () => {
    for (const { theme, hex, t } of derived) {
      for (const ground of ['--appkey', '--appkey-hover']) {
        const g = solid(t[ground]);
        for (const c of FIXED[theme].ink) expect(ratio(solid(c), g), `${theme} ${hex}: ${c} on ${ground}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('status text >= 4.5:1 inside its own tinted badge on the page, panel and well', () => {
    for (const { theme, hex, t } of derived) {
      for (const ground of ['--appbg', '--appsurface', '--appinset']) {
        for (const [text, tint] of FIXED[theme].badges) {
          expect(ratio(solid(text), over(tint, solid(t[ground]))), `${theme} ${hex}: ${text} in ${tint} on ${ground}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });

  it('chart marks >= 3:1 on the panel the charts sit on', () => {
    for (const { theme, hex, t } of derived) {
      const g = solid(t['--appchart-bg']);
      for (const c of FIXED[theme].chart) expect(ratio(solid(c), g), `${theme} ${hex}: ${c}`).toBeGreaterThanOrEqual(3);
    }
  });

  it('the selection fill carries its label >= 4.5:1 and stands off every ground >= 3:1', () => {
    for (const { theme, hex, t } of derived) {
      const fill = solid(t['--appaccent']);
      expect(ratio(solid(t['--appaccent-fg']), fill), `${theme} ${hex}: label on ${t['--appaccent']}`).toBeGreaterThanOrEqual(4.5);
      expect(t['--appfocus']).toBe(t['--appaccent']);
      for (const ground of ['--appbg', '--appsurface', '--appinset', '--appinset-strong']) {
        expect(ratio(fill, solid(t[ground])), `${theme} ${hex}: ${t['--appaccent']} on ${ground} ${t[ground]}`).toBeGreaterThanOrEqual(3);
      }
      // Text on the soft selection wash (the old pages' selected tab) stays readable.
      const wash = over(t['--appaccent-soft'], solid(t['--appsurface']));
      expect(ratio(solid(t['--apptext']), wash), `${theme} ${hex}: ink on the soft wash`).toBeGreaterThanOrEqual(4.5);
      // The counter on a lit key inverts: accent lettering on an fg plate.
      expect(ratio(fill, solid(t['--appaccent-fg']))).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('hairlines show at least as well as Enamel’s on the page and the panel', () => {
    for (const { theme, hex, t } of derived) {
      for (const line of ['--appborder', '--appborder-light', '--appborder-strong']) {
        for (const ground of ['--appbg', '--appsurface']) {
          const g = solid(t[ground]);
          expect(ratio(over(t[line], g), g), `${theme} ${hex}: ${line} on ${ground}`).toBeGreaterThanOrEqual(enamelLine(theme, line, ground) - 1e-6);
        }
      }
    }
  });

  it('keeps the page, panel and wells in their designed order (wells recessed, panel raised)', () => {
    for (const { theme, hex, t } of derived) {
      const L = (n: string) => lum(solid(t[n]));
      if (theme === 'light') {
        expect(L('--appsurface'), `${hex} panel above page`).toBeGreaterThan(L('--appbg'));
        expect(L('--appbg'), `${hex} page above well`).toBeGreaterThan(L('--appinset'));
      } else {
        expect(L('--appsurface'), `${hex} panel above page`).toBeGreaterThan(L('--appbg'));
        expect(L('--appbg'), `${hex} page above well`).toBeGreaterThan(L('--appinset'));
      }
      expect(L('--appinset'), `${theme} ${hex} well above strong well`).toBeGreaterThan(L('--appinset-strong'));
    }
  });
});

describe('the app colour is visibly the chosen colour', () => {
  const vivid = SAMPLE.filter((h) => hexToOklch(h).C >= 0.1);
  const hueGap = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

  it('tints the page and wells clearly, in the chosen hue', () => {
    expect(vivid.length).toBeGreaterThan(200);
    for (const theme of THEMES) {
      for (const hex of vivid) {
        const t = deriveAppTokens(hex, theme);
        const want = hexToOklch(hex).h;
        for (const k of ['--appbg', '--appinset']) {
          const c = hexToOklch(t[k]);
          expect(c.C, `${theme} ${hex} ${k} ${t[k]} chroma`).toBeGreaterThanOrEqual(theme === 'light' ? 0.02 : 0.015);
          expect(hueGap(c.h, want), `${theme} ${hex} ${k} ${t[k]} hue`).toBeLessThan(25);
        }
      }
    }
  });

  it('selects in a strong shade of the chosen hue', () => {
    for (const theme of THEMES) {
      for (const hex of vivid) {
        const c = hexToOklch(deriveAppTokens(hex, theme)['--appaccent']);
        expect(c.C, `${theme} ${hex}`).toBeGreaterThanOrEqual(0.05);
        expect(hueGap(c.h, hexToOklch(hex).h), `${theme} ${hex}`).toBeLessThan(20);
      }
    }
  });

  it('uses the exact hex for selection where it already passes (a deep blue in light, hot pink in dark)', () => {
    expect(deriveAppTokens('#1f4fbf', 'light')['--appaccent']).toBe('#1f4fbf');
    expect(deriveAppTokens('#ff2d95', 'dark')['--appaccent']).toBe('#ff2d95');
    expect(deriveAppTokens('#ffd400', 'dark')['--appaccent']).toBe('#ffd400');
    // Yellow cannot carry a label or stand off light enamel: a deep shade of it does.
    const y = deriveAppTokens('#ffd400', 'light');
    expect(y['--appaccent']).not.toBe('#ffd400');
    expect(y['--appaccent-fg']).toBe('#ffffff');
  });
});

describe('greys are Enamel', () => {
  it('ENAMEL mirrors index.css, token for token', () => {
    for (const theme of THEMES) {
      const t = resolved(theme);
      for (const k of APP_COLOUR_TOKENS) expect(ENAMEL[theme][k], `${theme} ${k}`).toBe(t[k]);
    }
  });

  it.each(['#000000', '#111111', '#808080', '#ffffff', '#c9cfcb', '#7f7f80', '#fefefe'])('%s gives exactly Enamel in both themes', (hex) => {
    expect(hexToOklch(hex).C).toBeLessThan(GREY_CHROMA);
    for (const theme of THEMES) expect(deriveAppTokens(hex, theme)).toEqual(ENAMEL[theme]);
  });

  it('no colour (or something that is not one) is Enamel too', () => {
    for (const theme of THEMES) {
      expect(deriveAppTokens(null, theme)).toEqual(ENAMEL[theme]);
      expect(deriveAppTokens('blue', theme)).toEqual(ENAMEL[theme]);
    }
  });
});

describe('hex and the wheel', () => {
  it('parses #RGB and #RRGGBB, with or without #, any case, padded; rejects the rest', () => {
    expect(parseHex('#1F4FBF')).toBe('#1f4fbf');
    expect(parseHex('1f4fbf')).toBe('#1f4fbf');
    expect(parseHex(' #14B ')).toBe('#1144bb');
    expect(parseHex('abc')).toBe('#aabbcc');
    for (const bad of ['', '#', '#12', '#1234', '#12345', '#1234567', '#ggg', 'red', 'rgb(1,2,3)', null, undefined]) expect(parseHex(bad)).toBeNull();
  });

  it('round-trips HSV for every sampled colour', () => {
    for (const hex of SAMPLE) expect(hsvToHex(hexToHsv(hex))).toBe(hex);
  });

  it('maps the old finish ids to their preset colours', () => {
    expect(legacyFinishColour('ocean')).toBe(APP_COLOUR_PRESETS.find((p) => p.label === 'Sea glass')!.hex);
    expect(legacyFinishColour('sunset')).toBe(APP_COLOUR_PRESETS.find((p) => p.label === 'Sandstone')!.hex);
    expect(legacyFinishColour('violet')).toBe(APP_COLOUR_PRESETS.find((p) => p.label === 'Lilac')!.hex);
    expect(legacyFinishColour('default')).toBeNull();
    expect(legacyFinishColour('neon')).toBeUndefined();
  });
});
