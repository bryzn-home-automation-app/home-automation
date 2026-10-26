import { useTheme, PALETTES, type ThemeMode } from '../context/ThemeContext';

const MODES: Array<{ mode: ThemeMode; label: string }> = [
  { mode: 'light', label: '☀️ Light' },
  { mode: 'dark', label: '🌙 Dark' },
  // Short so all three fit on a phone row; the line below explains sunset.
  { mode: 'auto', label: '🌗 Auto' },
];

/** "Switches to dark at 6:52 PM" / "… tomorrow at 7:21 AM". */
function nextChangeText(theme: 'light' | 'dark', next: Date | null): string {
  if (!next) return 'Follows sunrise and sunset at home once the app has loaded the home location.';
  const target = theme === 'light' ? 'dark' : 'light';
  const time = next.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const tomorrow = next.getDate() !== new Date().getDate();
  return `Follows sunrise and sunset at home — switches to ${target} ${tomorrow ? 'tomorrow ' : ''}at ${time}.`;
}

export default function ThemePicker() {
  const { theme, mode, setMode, nextThemeChange, isDark, palette, setPalette } = useTheme();

  return (
    <div className="rounded-[28px] border border-appborder bg-appsurface-raised p-5 shadow-[0_10px_28px_var(--appshadow)] sm:p-6">
      <div className="mb-4 flex items-center justify-between gap-4">
        <div>
          <p className="text-2xs font-medium uppercase tracking-[0.18em] text-apptext-muted">Appearance</p>
          <h3 className="mt-2 text-xl font-semibold text-apptext">Theme &amp; color palette</h3>
        </div>
      </div>

      {/* Mode: Light / Dark / Auto (follows sunrise & sunset at home) */}
      <div className="mb-2 flex flex-wrap items-center gap-2" role="radiogroup" aria-label="Theme">
        {MODES.map(({ mode: m, label }) => {
          // 'system' (never chosen) highlights whichever theme it resolved to.
          const active = mode === m || (mode === 'system' && m === theme);
          return (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setMode(m)}
              className={`rounded-full px-4 py-2 text-sm font-medium transition-colors ${
                active
                  ? 'border border-appaccent-border bg-appaccent-soft text-appaccent-text'
                  : 'border border-transparent text-apptext-muted hover:border-appborder hover:text-apptext-soft'
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>
      <p className="mb-5 min-h-4 text-xs text-apptext-muted">
        {mode === 'auto' ? nextChangeText(theme, nextThemeChange) : mode === 'system' ? 'Following your device setting.' : ''}
      </p>

      {/* Palette swatches (one palette for both modes; shown in the current mode) */}
      <p className="mb-3 text-xs text-apptext-muted">
        Applies in both light and dark mode.
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {PALETTES.map((p) => {
          const active = p.id === palette;
          const swatchColor = isDark ? p.swatch.dark : p.swatch.light;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => setPalette(p.id)}
              aria-pressed={active}
              className={`flex flex-col items-center gap-2 rounded-2xl border p-3 transition-colors ${
                active
                  ? 'border-appaccent-border bg-appaccent-soft'
                  : 'border-appborder bg-appinset hover:border-appborder-hover hover:bg-appinset-strong'
              }`}
            >
              <span
                className="h-8 w-8 rounded-full shadow-[0_2px_8px_rgba(0,0,0,0.25)]"
                style={{ backgroundColor: swatchColor, outline: active ? `2px solid ${swatchColor}` : 'none', outlineOffset: '2px' }}
              />
              <span className={`text-xs font-medium ${active ? 'text-appaccent-text' : 'text-apptext-soft'}`}>
                {p.label}{active ? ' ✓' : ''}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
