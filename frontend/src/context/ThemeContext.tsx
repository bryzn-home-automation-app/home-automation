import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useState, useCallback, type ReactNode } from 'react';
import { isDaytime, nextSunChange } from '../utils/sun';

type Theme = 'dark' | 'light';
/**
 * What the user picked. 'auto' follows sunrise/sunset at the home; 'system'
 * follows the device's own light/dark setting. Nothing saved means the designed
 * default, light.
 */
export type ThemeMode = 'light' | 'dark' | 'auto' | 'system';

/** The theme someone who has never chosen gets: the light enamel faceplate. */
export const DEFAULT_MODE: ThemeMode = 'light';

export interface PaletteOption {
  id: string;
  label: string;
  /**
   * Swatch shown in the picker UI, per mode. A palette is an enamel finish (it
   * tints the surfaces only), so the swatch is a sample of that enamel and is
   * the same in both modes.
   */
  swatch: { light: string; dark: string };
}

/**
 * The finishes. The ids are what people's phones have saved (and what index.css
 * and the start-up script in index.html key on), so they keep their old names;
 * the labels are what people see. Swatches match --appfinish-* in index.css.
 */
export const PALETTES: PaletteOption[] = [
  { id: 'default', label: 'Enamel', swatch: { light: '#c9cfcb', dark: '#c9cfcb' } },
  { id: 'ocean', label: 'Sea glass', swatch: { light: '#b7c7d4', dark: '#b7c7d4' } },
  { id: 'sunset', label: 'Sandstone', swatch: { light: '#d8c6b0', dark: '#d8c6b0' } },
  { id: 'violet', label: 'Lilac', swatch: { light: '#c8c1d8', dark: '#c8c1d8' } },
];
const PALETTE_IDS = PALETTES.map((p) => p.id);
const DEFAULT_PALETTE = 'default';

/**
 * Six decorative tones, in a consistent role order: [warm-1, cool-1, success,
 * warm-2, cool-2, distinct]. Only the Maintenance summary cards use them, and
 * that page has not been converted to Faceplate yet. A palette used to re-hue
 * them; a palette is now an enamel finish and never changes a hue, so every
 * palette has the same tones. The per-palette shape stays so callers keep
 * working; drop this once Maintenance is converted.
 */
const DEFAULT_KPI_TONES = {
  light: ['#f59e0b', '#0ea5e9', '#10b981', '#f59e0b', '#0ea5e9', '#a855f7'],
  dark:  ['#f59e0b', '#0ea5e9', '#10b981', '#f59e0b', '#0ea5e9', '#a855f7'],
};
export const KPI_TONES: Record<string, { light: string[]; dark: string[] }> = Object.fromEntries(
  PALETTE_IDS.map((id) => [id, DEFAULT_KPI_TONES]),
);

/**
 * Line-chart series colors for the Usage-vs-Temperature chart, per palette and
 * mode. Faceplate draws the primary series in ink and gives a second series a
 * hue only when the two must be told apart: usage is ink, temperature is the
 * heat hue. They are the same for every palette (a palette never changes chart
 * colours); the per-palette shape stays so callers keep working.
 * Kept as explicit hex (not `var(--apptext)`) because Recharts writes `stroke`
 * as an SVG *attribute*, where `var()` resolution is unreliable across browsers
 * (see DECISIONS.md). Values match --appchart-ink / --appchart-heat in index.css.
 * Both clear 3:1 on the panel (paletteContrast.test.ts).
 */
const DEFAULT_CHART_SERIES = {
  light: { usage: '#15181a', temp: '#d9480f' },
  dark:  { usage: '#eef1ef', temp: '#ff8a4c' },
};
export const CHART_SERIES: Record<string, {
  light: { usage: string; temp: string };
  dark: { usage: string; temp: string };
}> = Object.fromEntries(PALETTE_IDS.map((id) => [id, DEFAULT_CHART_SERIES]));

/**
 * Palette-independent data-identity series (forecast actual/predicted/error
 * lines, the day-of-week over/under bars, gas and water charts), per mode, from
 * the Faceplate chart tokens: actual = ink, predicted = graphite (drawn dashed),
 * hue only where parts must be told apart. All >= 3:1 on the panel the charts
 * sit on; `positive`/`caution` are also used as text and clear 4.5:1.
 * Stacking orders: gas fixed/used/taxes; water water/sewer/refuse/tax/stormwater.
 */
export const DATA_SERIES: Record<'light' | 'dark', {
  positive: string;
  caution: string;
  predicted: string;
  gasLine: string;
  gasFixed: string;
  gasUsed: string;
  gasTaxes: string;
  water: string;
  sewer: string;
  refuse: string;
  tax: string;
  stormwater: string;
}> = {
  dark: {
    positive: '#eef1ef', caution: '#ffb627', // ink, heads-up text
    predicted: '#9aa2a7', // graphite
    gasLine: '#e0b341',
    gasFixed: '#eef1ef', gasUsed: '#e0b341', gasTaxes: '#9aa2a7', // ink, gas, graphite
    water: '#3cc6da', sewer: '#eef1ef', refuse: '#a7aeb3', tax: '#80888d', stormwater: '#6fb6ff',
  },
  light: {
    positive: '#15181a', caution: '#794f00', // ink, heads-up text
    predicted: '#6a7277', // graphite
    gasLine: '#b8860b',
    gasFixed: '#15181a', gasUsed: '#b8860b', gasTaxes: '#6a7277', // ink, gas, graphite
    water: '#1098ad', sewer: '#15181a', refuse: '#6a7277', tax: '#828a8f', stormwater: '#1c7ed6',
  },
};

/** The Predicted line next to Actual: graphite, drawn dashed, in every palette. */
export function predictedColor(_palette: string, theme: 'light' | 'dark'): string {
  return DATA_SERIES[theme].predicted;
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
  /** The active palette (finish) id. */
  palette: string;
  /** Set the palette (shared by light and dark mode). */
  setPalette: (id: string) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'light',
  mode: DEFAULT_MODE,
  setMode: () => {},
  nextThemeChange: null,
  setSunLocation: () => {},
  toggleTheme: () => {},
  isLight: true,
  isDark: false,
  palette: DEFAULT_PALETTE,
  setPalette: () => {},
});

const MODE_KEY = 'theme';
/**
 * The theme the app last showed. The start-up script in index.html paints Auto
 * with it before any JavaScript bundle (and the sun maths) has loaded.
 */
const RESOLVED_KEY = 'theme-resolved';
const SUN_LOCATION_KEY = 'sun-location';
const MODES: ThemeMode[] = ['light', 'dark', 'auto', 'system'];

function readStoredMode(): ThemeMode {
  if (typeof window === 'undefined') return DEFAULT_MODE;
  try {
    const stored = localStorage.getItem(MODE_KEY) as ThemeMode | null;
    if (stored && MODES.includes(stored)) return stored;
  } catch { /* localStorage blocked */ }
  return DEFAULT_MODE;
}

function readSunLocation(): { lat: number; lon: number } | null {
  try {
    const v = JSON.parse(localStorage.getItem(SUN_LOCATION_KEY) ?? 'null');
    return v && Number.isFinite(v.lat) && Number.isFinite(v.lon) ? v : null;
  } catch {
    return null;
  }
}

/** The device's light/dark setting. Light unless the device asks for dark. */
function systemTheme(): Theme {
  if (typeof window === 'undefined' || !window.matchMedia) return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
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
 * adopt whichever of those was actually chosen. index.html reads the same keys.
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

/**
 * Point the browser chrome at the page colour: Safari's tab bar, Android's status
 * bar and the desktop PWA title bar tint from <meta name="theme-color">. It was a
 * fixed dark navy, so a light page sat under a navy toolbar. Read from the
 * resolved --appbg so it follows the theme and the finish without a second copy
 * of the colours here. (The iPhone Home Screen app ignores it while the status
 * bar is "black-translucent"; index.css handles that bar.)
 */
function syncThemeColorMeta() {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (!meta) return;
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--appbg').trim();
  if (bg) meta.setAttribute('content', bg);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(readStoredMode);
  const [sunLocation, setSunLocationState] = useState(readSunLocation);
  const [theme, setTheme] = useState<Theme>(() => resolveTheme(readStoredMode(), readSunLocation()));
  const [nextThemeChange, setNextThemeChange] = useState<Date | null>(null);
  const [palette, setPaletteState] = useState(readStoredPalette);

  // Suppress transitions during a theme/palette swap so the whole page repaints
  // once instead of animating every card's `transition-colors` for 300ms at
  // once (which read as a laggy full-page repaint). Declared BEFORE the attribute
  // effects below so the guard class is applied before the CSS vars flip; the
  // double-rAF re-enables transitions only after the new colors have painted.
  useLayoutEffect(() => {
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

  // Layout effects, not effects: the attributes land before the browser paints
  // the first React frame. The start-up script in index.html set them before the
  // first paint of all; these keep them right from then on.
  useLayoutEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem(RESOLVED_KEY, theme); } catch { /* quota exceeded */ }
  }, [theme]);

  useLayoutEffect(() => {
    document.documentElement.setAttribute('data-palette', palette);
  }, [palette]);

  useLayoutEffect(syncThemeColorMeta, [theme, palette]);

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

  // Follow the device's light/dark setting in 'system' mode (and for Auto until
  // the home's location is known).
  useEffect(() => {
    if (mode !== 'system' && !(mode === 'auto' && !sunLocation)) return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => setTheme(e.matches ? 'dark' : 'light');
    setTheme(systemTheme());
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [mode, sunLocation]);

  // Saved only when someone actually chooses, 'system' included (it is a choice:
  // "follow my phone"), so the designed default can still change for people who
  // never have.
  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    if (next === 'light' || next === 'dark') setTheme(next);
    try { localStorage.setItem(MODE_KEY, next); } catch { /* quota exceeded */ }
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
