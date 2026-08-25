import { useTheme, PALETTES } from '../context/ThemeContext';

export default function ThemePicker() {
  const { theme, toggleTheme, isDark, palette, setPalette } = useTheme();

  return (
    <div className="rounded-[28px] border border-appborder bg-appsurface-raised p-5 shadow-[0_10px_28px_var(--appshadow)] sm:p-6">
      <div className="mb-4 flex items-center justify-between gap-4">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-apptext-muted">Appearance</p>
          <h3 className="mt-2 text-lg font-semibold text-apptext">Theme &amp; color palette</h3>
        </div>
      </div>

      {/* Mode toggle */}
      <div className="mb-5 flex items-center gap-2">
        {(['light', 'dark'] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            onClick={() => { if (mode !== theme) toggleTheme(); }}
            className={`rounded-full px-4 py-2 text-sm font-medium capitalize transition-colors ${
              theme === mode
                ? 'border border-appaccent-border bg-appaccent-soft text-appaccent-text'
                : 'border border-transparent text-apptext-muted hover:border-appborder hover:text-apptext-soft'
            }`}
          >
            {mode === 'dark' ? '🌙 Dark' : '☀️ Light'}
          </button>
        ))}
      </div>

      {/* Palette swatches for the current mode */}
      <p className="mb-3 text-xs text-apptext-muted">
        Palette for {isDark ? 'dark' : 'light'} mode — your light and dark palette choices are remembered separately.
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
