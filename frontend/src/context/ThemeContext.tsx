import { createContext, useContext, useEffect, useMemo, useState, useCallback, type ReactNode } from 'react';
import { isDaytime, nextSunChange } from '../utils/sun';

type Theme = 'dark' | 'light';
/**
 * What the user picked. 'auto' follows sunrise/sunset at the home; 'system' (no
 * choice stored) follows the device's own light/dark setting.
 */
export type ThemeMode = 'light' | 'dark' | 'auto' | 'system';

export interface PaletteOption {
  id: string;
  label: string;
  /** Swatch color shown in the picker UI, per mode. */
  swatch: { light: string; dark: string };
}

export const PALETTES: PaletteOption[] = [
  { id: 'default', label: 'Default', swatch: { light: '#047857', dark: '#34d399' } },
  { id: 'ocean', label: 'Ocean', swatch: { light: '#0369a1', dark: '#0284c7' } },
  { id: 'sunset', label: 'Sunset', swatch: { light: '#c2410c', dark: '#ea580c' } },
  { id: 'violet', label: 'Violet', swatch: { light: '#6d28d9', dark: '#7c3aed' } },
];
const PALETTE_IDS = PALETTES.map((p) => p.id);
const DEFAULT_PALETTE = 'default';

/**
 * Per-palette accent tones for multi-color decorative UI (e.g. the
 * Maintenance summary cards) that would otherwise hardcode a fixed
 * amber/sky/emerald/purple rainbow regardless of the chosen palette.
 * 6 tones per palette, in a consistent role order: [warm-1, cool-1,
 * success, warm-2, cool-2, distinct]. "success" (index 2) stays a
 * green/teal across every palette — a checkmark reading as anything
 * but "done" would be confusing — everything else is re-hued to fit
 * the palette's family. Split by mode (not just palette) so an exact
 * requested hex for one mode (e.g. dark Violet) doesn't also silently
 * change the other mode's already-approved look.
 */
export const KPI_TONES: Record<string, { light: string[]; dark: string[] }> = {
  default: {
    light: ['#f59e0b', '#0ea5e9', '#10b981', '#f59e0b', '#0ea5e9', '#a855f7'],
    dark:  ['#f59e0b', '#0ea5e9', '#10b981', '#f59e0b', '#0ea5e9', '#a855f7'],
  },
  ocean: {
    light: ['#06b6d4', '#0ea5e9', '#14b8a6', '#06b6d4', '#0ea5e9', '#6366f1'],
    dark:  ['#06b6d4', '#0ea5e9', '#14b8a6', '#06b6d4', '#0ea5e9', '#6366f1'],
  },
  sunset: {
    // Same tones in both modes on request — dark mode isn't a separate
    // brighter variant here, it should look like light Sunset.
    light: ['#f59e0b', '#f97316', '#10b981', '#f59e0b', '#f97316', '#fb7185'],
    dark:  ['#f59e0b', '#f97316', '#10b981', '#f59e0b', '#f97316', '#fb7185'],
  },
  violet: {
    // Same tones in both modes on request — dark mode isn't a separate
    // brighter variant here, it should look like light Violet.
    light: ['#d946ef', '#8b5cf6', '#10b981', '#d946ef', '#8b5cf6', '#ec4899'],
    dark:  ['#d946ef', '#8b5cf6', '#10b981', '#d946ef', '#8b5cf6', '#ec4899'],
  },
};

/**
 * Line-chart series colors for the Usage-vs-Temperature chart, per palette
 * and mode. `usage` tracks the palette's accent (so the kWh line is the theme
 * color — green default, blue Ocean, orange Sunset, violet Violet, matching
 * `--appaccent` / the PALETTES swatch). `temp` is the accent's COMPLEMENTARY
 * hue in every palette, so the temperature line always reads as a deliberate
 * contrast against its own usage line rather than defaulting to one shared
 * color:
 *   - Default: green usage ↔ amber temp
 *   - Ocean:   blue usage  ↔ orange temp
 *   - Sunset:  orange usage ↔ sky-blue temp
 *   - Violet:  violet usage ↔ yellow temp
 * Kept as explicit hex (not `var(--appaccent)`) because Recharts writes
 * `stroke` as an SVG *attribute*, where `var()` resolution is unreliable
 * across browsers (see DECISIONS.md) — same reason KPI_TONES above is
 * hardcoded rather than CSS-var-driven. Light-mode `usage`/`temp` values are
 * a notch deeper so both lines stay legible on the white chart background —
 * and since the °F legend chip uses `temp` as its TEXT color, every light
 * `temp` clears 4.5:1 on white (amber-600 #d97706 was 3.2:1 → amber-700;
 * yellow-600 #ca8a04 was 2.9:1 → yellow-700).
 */
export const CHART_SERIES: Record<string, {
  light: { usage: string; temp: string };
  dark: { usage: string; temp: string };
}> = {
  default: {
    light: { usage: '#047857', temp: '#b45309' }, // green ↔ amber
    dark:  { usage: '#34d399', temp: '#f59e0b' },
  },
  ocean: {
    light: { usage: '#0369a1', temp: '#c2410c' }, // blue ↔ orange
    dark:  { usage: '#0284c7', temp: '#f97316' },
  },
  sunset: {
    light: { usage: '#c2410c', temp: '#0369a1' }, // orange ↔ sky-blue
    dark:  { usage: '#ea580c', temp: '#38bdf8' },
  },
  violet: {
    light: { usage: '#6d28d9', temp: '#a16207' }, // violet ↔ yellow
    dark:  { usage: '#7c3aed', temp: '#facc15' },
  },
};

/**
 * Palette-independent data-identity series (forecast actual/error lines, the
 * day-of-week over/under bars, gas and water charts), per mode. Dark values are
 * the hexes these charts always used; the dark-mode-tuned 400/500 shades were
 * 1.8-2.8:1 on the white light-mode chart, under the 3:1 minimum for chart
 * marks, so light gets the 600/700 step of the same hue (all >= 3.5:1;
 * `positive`/`caution` are also used as text and clear 4.5:1).
 */
export const DATA_SERIES: Record<'light' | 'dark', {
  positive: string;
  caution: string;
  gasLine: string;
  gasBar: string;
  water: string;
  sewer: string;
  refuse: string;
  tax: string;
  stormwater: string;
}> = {
  dark: {
    positive: '#22c55e', caution: '#f59e0b',
    gasLine: '#38bdf8', gasBar: '#0ea5e9',
    water: '#22d3ee', sewer: '#0ea5e9', refuse: '#6366f1', tax: '#a855f7', stormwater: '#14b8a6',
  },
  light: {
    positive: '#15803d', caution: '#b45309', // green-700, amber-700
    gasLine: '#0284c7', gasBar: '#0369a1', // sky-600, sky-700
    water: '#0891b2', sewer: '#0369a1', refuse: '#4f46e5', tax: '#9333ea', stormwater: '#0f766e',
  },
};

/**
 * The Predicted line next to Actual (always `DATA_SERIES.positive` green): the
 * palette's usage color, except on the green Default palette, where it's blue
 * so the two lines aren't both green.
 */
export function predictedColor(palette: string, theme: 'light' | 'dark'): string {
  return palette === 'default' ? DATA_SERIES[theme].gasLine : (CHART_SERIES[palette] ?? CHART_SERIES.default)[theme].usage;
}

/** Convert a `#rrggbb` hex color to an `rgba(...)` string at the given alpha. */
export function hexToRgba(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

interface ThemeContextValue {
  theme: Theme;
  /** The user's choice; `theme` is what it resolves to right now. */
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  /** Auto mode: when it flips next (null when unknown / not auto). */
  nextThemeChange: Date | null;
  /** Remember the home's coordinates (from /api/config) for Auto mode. */
  setSunLocation: (lat: number, lon: number) => void;
  /** Flip light/dark now — an explicit choice, so it leaves Auto. */
  toggleTheme: () => void;
  isLight: boolean;
  isDark: boolean;
  /** The active palette id. */
  palette: string;
  /** Set the palette (shared by light and dark mode). */
  setPalette: (id: string) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'dark',
  mode: 'system',
  setMode: () => {},
  nextThemeChange: null,
  setSunLocation: () => {},
  toggleTheme: () => {},
  isLight: false,
  isDark: true,
  palette: DEFAULT_PALETTE,
  setPalette: () => {},
});

const SUN_LOCATION_KEY = 'sun-location';

function readStoredMode(): ThemeMode {
  if (typeof window === 'undefined') return 'system';
  try {
    const stored = localStorage.getItem('theme');
    if (stored === 'light' || stored === 'dark' || stored === 'auto') return stored;
  } catch { /* localStorage blocked */ }
  return 'system';
}

function readSunLocation(): { lat: number; lon: number } | null {
  try {
    const v = JSON.parse(localStorage.getItem(SUN_LOCATION_KEY) ?? 'null');
    return v && Number.isFinite(v.lat) && Number.isFinite(v.lon) ? v : null;
  } catch {
    return null;
  }
}

function systemTheme(): Theme {
  if (typeof window === 'undefined' || !window.matchMedia) return 'dark';
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

/** The theme a mode means right now. Auto without a known location falls back to the device setting. */
export function resolveTheme(mode: ThemeMode, loc: { lat: number; lon: number } | null, now = new Date()): Theme {
  if (mode === 'light' || mode === 'dark') return mode;
  if (mode === 'auto') {
    const day = isDaytime(now, loc?.lat ?? null, loc?.lon ?? null);
    if (day != null) return day ? 'light' : 'dark';
  }
  return systemTheme();
}

const PALETTE_KEY = 'palette';

/**
 * One palette for both modes. Older builds stored one per mode, so a palette
 * picked in dark mode left light mode (e.g. daytime under Auto) on Default;
 * adopt whichever of those was actually chosen.
 */
function readStoredPalette(): string {
  if (typeof window === 'undefined') return DEFAULT_PALETTE;
  try {
    const candidates = [PALETTE_KEY, 'palette-dark', 'palette-light'].map((k) => localStorage.getItem(k));
    const chosen = candidates.find((id) => id && id !== DEFAULT_PALETTE && PALETTE_IDS.includes(id));
    if (chosen) return chosen;
  } catch { /* localStorage blocked */ }
  return DEFAULT_PALETTE;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(readStoredMode);
  const [sunLocation, setSunLocationState] = useState(readSunLocation);
  const [theme, setTheme] = useState<Theme>(() => resolveTheme(readStoredMode(), readSunLocation()));
  const [nextThemeChange, setNextThemeChange] = useState<Date | null>(null);
  const [palette, setPaletteState] = useState(readStoredPalette);

  // Suppress transitions during a theme/palette swap so the whole page repaints
  // once instead of animating every card's `transition-colors` for 300ms at
  // once (which read as a laggy full-page repaint). Runs BEFORE the attribute
  // effects below so the guard class is applied before the CSS vars flip; the
  // double-rAF re-enables transitions only after the new colors have painted.
  useEffect(() => {
    const el = document.documentElement;
    el.classList.add('theme-switching');
    let inner = 0;
    const outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => el.classList.remove('theme-switching'));
    });
    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
      el.classList.remove('theme-switching');
    };
  }, [theme, palette]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  // Persist the choice (not the resolved theme): 'system' stores nothing, so the
  // device setting keeps applying.
  useEffect(() => {
    try {
      if (mode === 'system') localStorage.removeItem('theme');
      else localStorage.setItem('theme', mode);
    } catch { /* quota exceeded */ }
  }, [mode]);

  // Auto: resolve now, then wake exactly at the next sunrise/sunset. Also re-check
  // when the app comes back to the foreground — a phone asleep through sunset
  // (timers don't fire while suspended) is right the moment it wakes.
  useEffect(() => {
    if (mode !== 'auto') {
      setNextThemeChange(null);
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const apply = () => {
      const now = new Date();
      setTheme(resolveTheme('auto', sunLocation, now));
      const next = nextSunChange(now, sunLocation?.lat ?? null, sunLocation?.lon ?? null);
      setNextThemeChange(next);
      clearTimeout(timer);
      // Cap the wait so a clock change or a long-lived tab still re-checks.
      if (next) timer = setTimeout(apply, Math.min(next.getTime() - now.getTime() + 1_000, 3_600_000));
    };
    apply();
    const onVisible = () => {
      if (document.visibilityState === 'visible') apply();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [mode, sunLocation]);

  useEffect(() => {
    document.documentElement.setAttribute('data-palette', palette);
  }, [palette]);

  // Follow the device's light/dark setting while no explicit choice is made (and
  // for Auto until the home's location is known).
  useEffect(() => {
    if (mode !== 'system' && !(mode === 'auto' && !sunLocation)) return;
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const handler = (e: MediaQueryListEvent) => setTheme(e.matches ? 'light' : 'dark');
    setTheme(systemTheme());
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [mode, sunLocation]);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    if (next === 'light' || next === 'dark') setTheme(next);
  }, []);

  const toggleTheme = useCallback(() => setMode(theme === 'dark' ? 'light' : 'dark'), [theme, setMode]);

  const setSunLocation = useCallback((lat: number, lon: number) => {
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) return;
    setSunLocationState((prev) => {
      if (prev && Math.abs(prev.lat - lat) < 1e-6 && Math.abs(prev.lon - lon) < 1e-6) return prev;
      try { localStorage.setItem(SUN_LOCATION_KEY, JSON.stringify({ lat, lon })); } catch { /* quota exceeded */ }
      return { lat, lon };
    });
  }, []);

  const setPalette = useCallback((id: string) => {
    if (!PALETTE_IDS.includes(id)) return;
    setPaletteState(id);
    try {
      localStorage.setItem(PALETTE_KEY, id);
      localStorage.removeItem('palette-light');
      localStorage.removeItem('palette-dark');
    } catch { /* quota exceeded */ }
  }, []);

  // Stable context value — otherwise a fresh object every render forces all
  // consumers to re-render. toggleTheme/setPalette are already useCallback'd.
  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      mode,
      setMode,
      nextThemeChange,
      setSunLocation,
      toggleTheme,
      isLight: theme === 'light',
      isDark: theme === 'dark',
      palette,
      setPalette,
    }),
    [theme, mode, setMode, nextThemeChange, setSunLocation, palette, toggleTheme, setPalette],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
