import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';

type Theme = 'dark' | 'light';

export interface PaletteOption {
  id: string;
  label: string;
  /** Swatch color shown in the picker UI, per mode. */
  swatch: { light: string; dark: string };
}

export const PALETTES: PaletteOption[] = [
  { id: 'default', label: 'Default', swatch: { light: '#047857', dark: '#34d399' } },
  { id: 'ocean', label: 'Ocean', swatch: { light: '#0369a1', dark: '#38bdf8' } },
  { id: 'sunset', label: 'Sunset', swatch: { light: '#c2410c', dark: '#fda172' } },
  { id: 'violet', label: 'Violet', swatch: { light: '#6d28d9', dark: '#8f00ff' } },
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
    light: ['#f59e0b', '#f97316', '#10b981', '#f59e0b', '#f97316', '#fb7185'],
    // #FDA172 is the exact hex requested for dark Sunset's accent.
    dark:  ['#fda172', '#f97316', '#10b981', '#fda172', '#f97316', '#fb7185'],
  },
  violet: {
    light: ['#d946ef', '#8b5cf6', '#10b981', '#d946ef', '#8b5cf6', '#ec4899'],
    // #8F00FF is the exact hex requested for dark Violet's accent.
    dark:  ['#b24dff', '#8f00ff', '#10b981', '#b24dff', '#8f00ff', '#d946ef'],
  },
};

/** Convert a `#rrggbb` hex color to an `rgba(...)` string at the given alpha. */
export function hexToRgba(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

interface ThemeContextValue {
  theme: Theme;
  toggleTheme: () => void;
  isLight: boolean;
  isDark: boolean;
  /** The active palette id for the current mode. */
  palette: string;
  /** Set the palette for the current mode (light/dark palettes are remembered independently). */
  setPalette: (id: string) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: 'dark',
  toggleTheme: () => {},
  isLight: false,
  isDark: true,
  palette: DEFAULT_PALETTE,
  setPalette: () => {},
});

function readStoredTheme(): Theme {
  if (typeof window === 'undefined') return 'dark';
  try {
    const stored = localStorage.getItem('theme');
    if (stored === 'light' || stored === 'dark') return stored;
  } catch { /* localStorage blocked */ }
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function readStoredPalette(mode: Theme): string {
  if (typeof window === 'undefined') return DEFAULT_PALETTE;
  try {
    const stored = localStorage.getItem(`palette-${mode}`);
    if (stored && PALETTE_IDS.includes(stored)) return stored;
  } catch { /* localStorage blocked */ }
  return DEFAULT_PALETTE;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(readStoredTheme);
  const [lightPalette, setLightPalette] = useState(() => readStoredPalette('light'));
  const [darkPalette, setDarkPalette] = useState(() => readStoredPalette('dark'));

  const palette = theme === 'light' ? lightPalette : darkPalette;

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem('theme', theme);
    } catch { /* quota exceeded */ }
  }, [theme]);

  useEffect(() => {
    document.documentElement.setAttribute('data-palette', palette);
  }, [palette]);

  // Follow OS preference changes when no explicit choice has been made
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const handler = (e: MediaQueryListEvent) => {
      setTheme((prev) => {
        // Only auto-switch if the user hasn't explicitly chosen a theme
        const stored = localStorage.getItem('theme');
        if (stored === 'light' || stored === 'dark') return prev;
        return e.matches ? 'light' : 'dark';
      });
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  }, []);

  const setPalette = useCallback((id: string) => {
    if (!PALETTE_IDS.includes(id)) return;
    setTheme((currentTheme) => {
      if (currentTheme === 'light') {
        setLightPalette(id);
        try { localStorage.setItem('palette-light', id); } catch { /* quota exceeded */ }
      } else {
        setDarkPalette(id);
        try { localStorage.setItem('palette-dark', id); } catch { /* quota exceeded */ }
      }
      return currentTheme;
    });
  }, []);

  return (
    <ThemeContext.Provider
      value={{
        theme,
        toggleTheme,
        isLight: theme === 'light',
        isDark: theme === 'dark',
        palette,
        setPalette,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
