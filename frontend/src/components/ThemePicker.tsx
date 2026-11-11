import { useId, type CSSProperties, type KeyboardEvent } from 'react';
import { useTheme, PALETTES, type ThemeMode } from '../context/ThemeContext';
import { Icon, type IconName } from './ui/Icon';

const MODES: Array<{ mode: ThemeMode; label: string; icon: IconName }> = [
  { mode: 'light', label: 'Light', icon: 'sun' },
  { mode: 'dark', label: 'Dark', icon: 'moon' },
  // Short so all four fit on a phone row; the line below explains each.
  { mode: 'auto', label: 'Auto', icon: 'contrast' },
  // Follows the phone's own light/dark setting. Without it, picking any theme
  // once meant the app could never follow the phone again.
  { mode: 'system', label: 'Device', icon: 'phone' },
];

/** "Switches to dark at 6:52 PM" / "… tomorrow at 7:21 AM". */
function nextChangeText(theme: 'light' | 'dark', next: Date | null): string {
  if (!next) return 'Follows sunrise and sunset at home once the app has loaded the home location.';
  const target = theme === 'light' ? 'dark' : 'light';
  const time = next.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const tomorrow = next.getDate() !== new Date().getDate();
  return `Follows sunrise and sunset at home. Switches to ${target} ${tomorrow ? 'tomorrow ' : ''}at ${time}.`;
}

function modeHelp(mode: ThemeMode, theme: 'light' | 'dark', next: Date | null): string {
  switch (mode) {
    case 'light': return 'Always light.';
    case 'dark': return 'Always dark.';
    case 'auto': return nextChangeText(theme, next);
    case 'system': return `Follows this device's light or dark setting. ${theme === 'dark' ? 'Dark' : 'Light'} right now.`;
  }
}

const ARROW_STEP: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

/**
 * Arrow keys move the choice within a radio group, as they do for native radios;
 * only the checked key sits in the tab order (roving tabindex).
 */
function onRadioKeys<T extends string>(e: KeyboardEvent<HTMLDivElement>, ids: T[], current: T, choose: (id: T) => void) {
  const step = ARROW_STEP[e.key];
  let i = ids.indexOf(current);
  if (step) i = (i + step + ids.length) % ids.length;
  else if (e.key === 'Home') i = 0;
  else if (e.key === 'End') i = ids.length - 1;
  else return;
  e.preventDefault();
  choose(ids[i]);
  e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]')[i]?.focus();
}

/**
 * Appearance switchgear (Profile): the theme as a four-position switch and the
 * enamel finish as swatch keys. Both are saved on this device.
 */
export default function ThemePicker() {
  const { theme, mode, setMode, nextThemeChange, palette, setPalette } = useTheme();
  const id = useId();
  const finish = PALETTES.find((p) => p.id === palette) ?? PALETTES[0];

  return (
    <section className="fp-panel" aria-labelledby={`${id}-title`}>
      <header className="fp-panel-head">
        <div>
          <p className="fp-label">Appearance</p>
          <h3 className="fp-panel-title" id={`${id}-title`}>Theme and finish</h3>
        </div>
      </header>

      {/* A switchgear-sized column, not a full-width bar, on a wide card. */}
      <div className="fp-stack fp-stack--l max-w-[26rem]">
        <div className="fp-stack fp-stack--s">
          <span className="fp-label" id={`${id}-theme`}>Theme</span>
          <div
            className="fp-seg fp-seg--fill"
            role="radiogroup"
            aria-labelledby={`${id}-theme`}
            onKeyDown={(e) => onRadioKeys(e, MODES.map((m) => m.mode), mode, setMode)}
          >
            {MODES.map(({ mode: m, label, icon }) => {
              const active = mode === m;
              return (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  tabIndex={active ? 0 : -1}
                  onClick={() => setMode(m)}
                  className="fp-seg-key"
                >
                  {/* Four keys with icons don't fit a phone row; the words carry it there. */}
                  <Icon name={icon} className="fp-hide-phone" />
                  {label}
                </button>
              );
            })}
          </div>
          <p className="fp-small fp-muted min-h-[1.4em]" aria-live="polite">
            {modeHelp(mode, theme, nextThemeChange)}
          </p>
        </div>

        <div className="fp-stack fp-stack--s">
          <span className="fp-label">
            <span id={`${id}-finish`}>Finish</span> · {finish.label}
          </span>
          <div
            className="fp-swatches -ml-[7px]"
            role="radiogroup"
            aria-labelledby={`${id}-finish`}
            onKeyDown={(e) => onRadioKeys(e, PALETTES.map((p) => p.id), finish.id, setPalette)}
          >
            {PALETTES.map((p) => {
              const active = p.id === finish.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  aria-label={p.label}
                  tabIndex={active ? 0 : -1}
                  onClick={() => setPalette(p.id)}
                  className="fp-swatch-key"
                  style={{ '--fp-sw': `var(--appfinish-${p.id})` } as CSSProperties}
                />
              );
            })}
          </div>
          <p className="fp-small fp-muted">
            Tints the enamel in light and dark. Status colours never change. Saved on this device.
          </p>
        </div>
      </div>
    </section>
  );
}
