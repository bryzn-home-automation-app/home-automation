/**
 * The app colour: one hex the owner picks in Profile > Appearance, turned into the
 * surface family (page, panel, wells, keys, hairlines, unlit lamp, map floor) and the
 * selection colour (selected keys, primary buttons, focus ring, switches) for the
 * light and the dark theme.
 *
 * Contrast is guaranteed by construction, whatever hex comes in (black, white, neon
 * yellow, a grey): every generated value is checked against the fixed colours that sit
 * on it, and anything that fails is moved (lighter or darker, never by trusting the
 * input) until it passes, falling back to the Enamel value, which the stylesheet tests
 * already hold to the same rules. Ink, status and chart colours are never generated:
 * they stay fixed so meaning never changes. appColour.test.ts checks the guarantees
 * over several hundred colours in both themes.
 *
 * Pure: no DOM, no storage. ThemeContext applies the result as inline custom
 * properties on <html>, and the start-up script in index.html paints a cached copy.
 */

export type ThemeName = 'light' | 'dark';
export type Tokens = Record<string, string>;
type RGB = [number, number, number]; // sRGB, 0..1, gamma-encoded
type RGBA = [number, number, number, number];

// ── hex ──────────────────────────────────────────────────────────────────────

/** '#1f4fbf' for '#1F4FBF', '1f4fbf', '#14b' or ' #14B '; null for anything else. */
export function parseHex(input: string | null | undefined): string | null {
  if (typeof input !== 'string') return null;
  const s = input.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(s)) return `#${s.split('').map((c) => c + c).join('')}`.toLowerCase();
  if (/^[0-9a-f]{6}$/i.test(s)) return `#${s}`.toLowerCase();
  return null;
}

export function hexToRgb(hex: string): RGB {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function rgbToHex([r, g, b]: RGB): string {
  const to = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

/** rgba() string or hex to [r,g,b,a] (0..1 channels). */
function parseColour(c: string): RGBA {
  if (c.startsWith('#')) return [...hexToRgb(c), 1] as RGBA;
  const p = c.match(/rgba?\(([^)]+)\)/)![1].split(',').map(Number);
  return [p[0] / 255, p[1] / 255, p[2] / 255, p[3] ?? 1];
}

const rgba = ([r, g, b]: RGB, a: number) =>
  `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${+a.toFixed(3)})`;

// ── WCAG ─────────────────────────────────────────────────────────────────────

const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const toGamma = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);

/** WCAG relative luminance of an sRGB colour. */
export function luminance(c: RGB | string): number {
  const [r, g, b] = typeof c === 'string' ? hexToRgb(c) : c;
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/** WCAG contrast ratio, 1..21. */
export function contrast(a: RGB | string, b: RGB | string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** A (possibly translucent) colour composited over an opaque one, as the browser paints it. */
export function over(fg: string, bg: RGB | string): RGB {
  const [r, g, b, a] = parseColour(fg);
  const base = typeof bg === 'string' ? hexToRgb(bg) : bg;
  return [r * a + base[0] * (1 - a), g * a + base[1] * (1 - a), b * a + base[2] * (1 - a)];
}

// ── OKLab / OKLCH (Björn Ottosson) ───────────────────────────────────────────

function linearToOklab([r, g, b]: RGB): RGB {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function oklabToLinear([L, a, b]: RGB): RGB {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

export interface Oklch { L: number; C: number; h: number }

export function hexToOklch(hex: string): Oklch {
  const [L, a, b] = linearToOklab(hexToRgb(hex).map(toLinear) as RGB);
  const C = Math.hypot(a, b);
  const h = ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
  return { L, C, h };
}

function lchToLinear(L: number, C: number, h: number): RGB {
  const rad = (h * Math.PI) / 180;
  return oklabToLinear([L, C * Math.cos(rad), C * Math.sin(rad)]);
}

const inGamut = (lin: RGB) => lin.every((v) => v >= -1e-5 && v <= 1 + 1e-5);

/** The colour at L/h with as much of chroma C as sRGB can show (chroma is clamped, never L or h). */
function lchToRgb(L: number, C: number, h: number): RGB {
  let lin = lchToLinear(L, C, h);
  if (!inGamut(lin)) {
    let lo = 0;
    let hi = C;
    for (let i = 0; i < 24; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(lchToLinear(L, mid, h))) lo = mid;
      else hi = mid;
    }
    lin = lchToLinear(L, lo, h);
  }
  return lin.map((v) => toGamma(Math.min(1, Math.max(0, v)))) as RGB;
}

export const lchToHex = (L: number, C: number, h: number) => rgbToHex(lchToRgb(L, C, h));

// ── HSV (the picker's wheel) ─────────────────────────────────────────────────

export interface Hsv { h: number; s: number; v: number } // h 0..360, s and v 0..1

export function hexToHsv(hex: string): Hsv {
  const [r, g, b] = hexToRgb(hex);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
  }
  return { h, s: max ? d / max : 0, v: max };
}

export function hsvToHex({ h, s, v }: Hsv): string {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return rgbToHex([f(5), f(3), f(1)]);
}

// ── Enamel: today's neutral tokens (index.css), the base every colour starts from ──

/**
 * The tokens an app colour owns, with their Enamel values. They mirror index.css
 * (appColour.test.ts checks every one), so a grey, which has no hue to give, comes
 * out as exactly today's Enamel.
 */
export const ENAMEL: Record<ThemeName, Tokens> = {
  light: {
    '--appbg': '#e9ecea',
    '--appsurface': '#f7f8f7',
    '--appinset': '#dfe3e0',
    '--appinset-strong': '#d3d8d5',
    '--appkey': '#fdfdfc',
    '--appkey-hover': '#f1f3f2',
    '--applamp-off': '#c9cfcb',
    '--appmap-floor': '#f1f3f2',
    '--appborder': 'rgba(21, 24, 26, 0.14)',
    '--appborder-light': 'rgba(21, 24, 26, 0.08)',
    '--appborder-strong': 'rgba(21, 24, 26, 0.26)',
    '--approw-hover': 'rgba(21, 24, 26, 0.04)',
    '--appaccent': '#15181a',
    '--appaccent-fg': '#f7f8f7',
    '--appaccent-soft': 'rgba(21, 24, 26, 0.08)',
    '--appaccent-border': 'rgba(21, 24, 26, 0.34)',
    '--appfocus': '#15181a',
  },
  dark: {
    '--appbg': '#121416',
    '--appsurface': '#1b1e21',
    '--appinset': '#0d0f10',
    '--appinset-strong': '#070809',
    '--appkey': '#262a2e',
    '--appkey-hover': '#2e3337',
    '--applamp-off': '#33393d',
    '--appmap-floor': '#16191b',
    '--appborder': 'rgba(238, 241, 239, 0.13)',
    '--appborder-light': 'rgba(238, 241, 239, 0.07)',
    '--appborder-strong': 'rgba(238, 241, 239, 0.24)',
    '--approw-hover': 'rgba(238, 241, 239, 0.04)',
    '--appaccent': '#eef1ef',
    '--appaccent-fg': '#15181a',
    '--appaccent-soft': 'rgba(238, 241, 239, 0.08)',
    '--appaccent-border': 'rgba(238, 241, 239, 0.34)',
    '--appfocus': '#eef1ef',
  },
};

/** Every custom property an app colour sets (and ThemeContext clears on reset). */
export const APP_COLOUR_TOKENS = Object.keys(ENAMEL.light);

// ── The fixed colours that sit on the generated ones (index.css) ─────────────

/** Ink steps: text on every surface, well and key face. */
const INK: Record<ThemeName, string[]> = {
  light: ['#15181a', '#33393d', '#4e555a', '#52595e'],
  dark: ['#eef1ef', '#cdd2d5', '#a7aeb3', '#969da2'],
};

/**
 * Other text that must hold 4.5:1 on the page, panel and wells: status text, and in
 * light the text-safe steps the old pages' pastel classes are remapped to.
 */
const OTHER_TEXT: Record<ThemeName, string[]> = {
  light: [
    '#0e6637', '#794f00', '#aa241d', '#1c56ad',
    '#166534', '#115e59', '#824b0e', '#9a3412', '#991b1b', '#9d174d', '#86198f', '#155e75', '#1e40af', '#4338ca', '#6d28d9', '#6b21a8',
  ],
  dark: ['#3ddc84', '#ffb627', '#ff6b5e', '#6fa8ff'],
};

/** Status text inside a 10% badge of its own hue: [text, tint]. */
const BADGES: Record<ThemeName, Array<[string, string]>> = {
  light: [
    ['#0e6637', 'rgba(34, 163, 90, 0.10)'],
    ['#794f00', 'rgba(224, 161, 0, 0.13)'],
    ['#aa241d', 'rgba(224, 72, 59, 0.10)'],
    ['#1c56ad', 'rgba(59, 130, 246, 0.09)'],
  ],
  dark: [
    ['#3ddc84', 'rgba(61, 220, 132, 0.08)'],
    ['#ffb627', 'rgba(255, 182, 39, 0.09)'],
    ['#ff6b5e', 'rgba(255, 107, 94, 0.09)'],
    ['#6fa8ff', 'rgba(111, 168, 255, 0.08)'],
  ],
};

/** Chart marks drawn on panels (>= 3:1): the --appchart-* hues and the JS series. */
const CHART: Record<ThemeName, string[]> = {
  light: ['#d9480f', '#1c7ed6', '#1e9150', '#15181a', '#6a7277', '#1098ad', '#b8860b', '#794f00', '#828a8f'],
  dark: ['#ff8a4c', '#6fb6ff', '#3ddc84', '#eef1ef', '#9aa2a7', '#3cc6da', '#e0b341', '#ffb627', '#a7aeb3', '#80888d'],
};

// ── Recipe ───────────────────────────────────────────────────────────────────

/** Below this OKLCH chroma a colour is a grey: it has no hue to lend, so it is Enamel. */
export const GREY_CHROMA = 0.02;

type SurfaceKey = '--appbg' | '--appsurface' | '--appinset' | '--appinset-strong' | '--appkey' | '--appkey-hover' | '--applamp-off' | '--appmap-floor';
const SURFACES: SurfaceKey[] = ['--appbg', '--appsurface', '--appinset', '--appinset-strong', '--appkey', '--appkey-hover', '--applamp-off', '--appmap-floor'];

/**
 * OKLCH chroma each surface takes at full strength. The page and wells carry the
 * colour; panels and key faces carry less, so text keeps a clean ground; the unlit
 * lamp stays quiet so a lit lamp still reads as the only signal.
 */
const CHROMA: Record<ThemeName, Record<SurfaceKey, number>> = {
  light: {
    '--appbg': 0.06, '--appsurface': 0.024, '--appinset': 0.055, '--appinset-strong': 0.062,
    '--appkey': 0.012, '--appkey-hover': 0.03, '--applamp-off': 0.035, '--appmap-floor': 0.032,
  },
  dark: {
    '--appbg': 0.05, '--appsurface': 0.045, '--appinset': 0.035, '--appinset-strong': 0.028,
    '--appkey': 0.055, '--appkey-hover': 0.06, '--applamp-off': 0.05, '--appmap-floor': 0.04,
  },
};

/** Where each surface's text checks apply. */
const TEXT_GROUND: SurfaceKey[] = ['--appbg', '--appsurface', '--appinset', '--appinset-strong'];
const BADGE_GROUND: SurfaceKey[] = ['--appbg', '--appsurface', '--appinset'];
const KEY_FACES: SurfaceKey[] = ['--appkey', '--appkey-hover'];
/** What a selected key / primary button / focus ring sits on. */
const SELECTION_GROUND: SurfaceKey[] = ['--appbg', '--appsurface', '--appinset', '--appinset-strong'];

const ok = (ratio: number, min: number) => ratio >= min;

/** Does a candidate surface hold every fixed colour that is drawn on it? */
function surfaceHolds(key: SurfaceKey, c: RGB, theme: ThemeName): boolean {
  if (TEXT_GROUND.includes(key) || KEY_FACES.includes(key)) {
    for (const t of INK[theme]) if (!ok(contrast(t, c), 4.5)) return false;
  }
  if (TEXT_GROUND.includes(key)) {
    for (const t of OTHER_TEXT[theme]) if (!ok(contrast(t, c), 4.5)) return false;
  }
  if (BADGE_GROUND.includes(key)) {
    for (const [t, tint] of BADGES[theme]) if (!ok(contrast(t, over(tint, c)), 4.5)) return false;
  }
  if (key === '--appsurface') {
    for (const t of CHART[theme]) if (!ok(contrast(t, c), 3)) return false;
  }
  return true;
}

/** The lightest (light theme) / darkest (dark theme) colour at hue h, chroma C whose luminance is on the safe side of Y. */
function atLuminance(Y: number, C: number, h: number, theme: ThemeName): RGB {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 32; i++) {
    const mid = (lo + hi) / 2;
    if (luminance(lchToRgb(mid, C, h)) < Y) lo = mid;
    else hi = mid;
  }
  return hexToRgb(lchToHex(theme === 'light' ? hi : lo, C, h));
}

/**
 * A surface tinted with the hue at Enamel's luminance (so the value structure of page,
 * panel and wells, and every contrast against them, stays as designed), moved toward
 * white (light) or black (dark) until everything drawn on it passes; Enamel if nothing does.
 */
function tintSurface(key: SurfaceKey, h: number, strength: number, theme: ThemeName): string {
  const base = ENAMEL[theme][key];
  const C = CHROMA[theme][key] * strength;
  let Y = luminance(base);
  for (let i = 0; i < 60; i++) {
    const c = atLuminance(Y, C, h, theme);
    if (surfaceHolds(key, c, theme)) return rgbToHex(c);
    Y = theme === 'light' ? Math.min(1, Y + 0.005) : Math.max(0, Y - 0.001);
  }
  return base;
}

/**
 * Hairlines in the hue: a dark (light theme) or light (dark theme) tinted ink at
 * Enamel's opacity, made more opaque until it shows against the page and the panel at
 * least as well as Enamel's own hairline does.
 */
function tintLine(enamelLine: string, h: number, strength: number, theme: ThemeName, grounds: RGB[], enamelGrounds: RGB[]): string {
  const ink = hexToRgb(theme === 'light' ? lchToHex(0.27, 0.07 * strength, h) : lchToHex(0.94, 0.035 * strength, h));
  const alpha0 = parseColour(enamelLine)[3];
  const need = enamelGrounds.map((g) => contrast(over(enamelLine, g), g));
  for (let a = alpha0; a <= 0.6; a += 0.01) {
    const line = rgba(ink, a);
    if (grounds.every((g, i) => contrast(over(line, g), g) >= need[i] - 1e-9)) return line;
  }
  return enamelLine;
}

/**
 * The selection colour: the chosen colour itself if it can carry a label (>= 4.5:1
 * with white or ink) and stand off every ground it sits on (>= 3:1). Otherwise its
 * hue and chroma at the nearest lightness that can: darker in the light theme (a deep
 * key with white lettering, like today's ink key), lighter in the dark theme.
 */
function selection(input: Oklch, theme: ThemeName, grounds: RGB[]): { fill: string; fg: string } | null {
  const fgs = theme === 'light' ? ['#ffffff', '#15181a'] : ['#15181a', '#ffffff'];
  const step = theme === 'light' ? -0.005 : 0.005;
  for (let L = input.L; L >= 0 && L <= 1; L += step) {
    const fill = lchToHex(L, input.C, input.h);
    if (!grounds.every((g) => contrast(fill, g) >= 3)) continue;
    const fg = fgs.find((f) => contrast(fill, f) >= 4.5);
    if (fg) return { fill, fg };
  }
  return null;
}

/**
 * The --app* token values for one app colour in one theme. A grey (or anything that is
 * not a hex) gives Enamel exactly. `strength` comes from the input's chroma: a muted
 * colour tints gently, a vivid one fully.
 */
export function deriveAppTokens(hex: string | null, theme: ThemeName): Tokens {
  const parsed = parseHex(hex);
  const enamel = ENAMEL[theme];
  if (!parsed) return { ...enamel };
  const input = hexToOklch(parsed);
  if (input.C < GREY_CHROMA) return { ...enamel };
  const strength = Math.min(1, (input.C - GREY_CHROMA) / 0.08 + 0.15);
  const h = input.h;

  const out: Tokens = { ...enamel };
  for (const key of SURFACES) out[key] = tintSurface(key, h, strength, theme);

  const page = hexToRgb(out['--appbg']);
  const panel = hexToRgb(out['--appsurface']);
  const ePage = hexToRgb(enamel['--appbg']);
  const ePanel = hexToRgb(enamel['--appsurface']);
  for (const key of ['--appborder', '--appborder-light', '--appborder-strong']) {
    out[key] = tintLine(enamel[key], h, strength, theme, [page, panel], [ePage, ePanel]);
  }
  const lineInk = parseColour(out['--appborder']);
  out['--approw-hover'] = rgba([lineInk[0], lineInk[1], lineInk[2]], parseColour(enamel['--approw-hover'])[3] + 0.01);

  const sel = selection(input, theme, SELECTION_GROUND.map((k) => hexToRgb(out[k])));
  if (sel) {
    const fill = hexToRgb(sel.fill);
    out['--appaccent'] = sel.fill;
    out['--appaccent-fg'] = sel.fg;
    out['--appfocus'] = sel.fill;
    out['--appaccent-soft'] = rgba(fill, theme === 'light' ? 0.12 : 0.16);
    out['--appaccent-border'] = rgba(fill, 0.55);
  }
  return out;
}

// ── Presets ──────────────────────────────────────────────────────────────────

export interface AppColourPreset {
  /** null = Enamel, the neutral faceplate (no app colour). */
  hex: string | null;
  label: string;
  /** The finish id an older build saved for this colour, if any. */
  legacyId?: string;
}

/**
 * The first four are the old finishes (Enamel / Sea glass / Sandstone / Lilac) as
 * colours; a phone that saved one of those ids moves to its colour here.
 */
export const APP_COLOUR_PRESETS: AppColourPreset[] = [
  { hex: null, label: 'Enamel', legacyId: 'default' },
  { hex: '#3a7ca5', label: 'Sea glass', legacyId: 'ocean' },
  { hex: '#b07a4a', label: 'Sandstone', legacyId: 'sunset' },
  { hex: '#7b68b5', label: 'Lilac', legacyId: 'violet' },
  { hex: '#1f4fbf', label: 'Cobalt' },
  { hex: '#2b7a4b', label: 'Fern' },
  { hex: '#c23a6b', label: 'Rose' },
  { hex: '#c75b2a', label: 'Terracotta' },
];

/** The colour for a finish id an older build saved ('ocean' -> Sea glass); undefined if it isn't one. */
export function legacyFinishColour(id: string | null): string | null | undefined {
  if (!id) return undefined;
  const preset = APP_COLOUR_PRESETS.find((p) => p.legacyId === id);
  return preset ? preset.hex : undefined;
}

/** The swatch shown for a colour in the picker (Enamel's is its unlit-lamp grey). */
export const ENAMEL_SWATCH = '#c9cfcb';
