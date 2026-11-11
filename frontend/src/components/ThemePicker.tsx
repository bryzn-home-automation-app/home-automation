import { useEffect, useId, useMemo, useRef, useState, type ClipboardEvent, type CSSProperties, type KeyboardEvent } from 'react';
import { useTheme, type ThemeMode } from '../context/ThemeContext';
import { APP_COLOUR_PRESETS, ENAMEL_SWATCH, deriveAppTokens, hexToHsv, hsvToHex, parseHex, type Hsv } from '../utils/appColour';
import { ColourWheel } from './ui/ColourWheel';
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
 * only the checked key (or the first, when none is) sits in the tab order.
 */
function onRadioKeys<T>(e: KeyboardEvent<HTMLDivElement>, ids: T[], current: T | undefined, choose: (id: T) => void) {
  const step = ARROW_STEP[e.key];
  let i = current === undefined ? -1 : ids.indexOf(current);
  if (step) i = i < 0 ? (step > 0 ? 0 : ids.length - 1) : (i + step + ids.length) % ids.length;
  else if (e.key === 'Home') i = 0;
  else if (e.key === 'End') i = ids.length - 1;
  else return;
  e.preventDefault();
  choose(ids[i]);
  e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]')[i]?.focus();
}

const upper = (hex: string | null) => (hex ?? '').toUpperCase();

/**
 * Appearance switchgear (Profile): the theme as a four-position switch, and the app
 * colour as a wheel, a hex field, presets and a reset. Both are saved on this device.
 */
export default function ThemePicker() {
  const { theme, mode, setMode, nextThemeChange, appColour, setAppColour, previewAppColour } = useTheme();
  const id = useId();

  // The wheel's own position: it keeps the hue while the colour passes through grey
  // and follows any outside change (a preset, the hex field, a reset).
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(appColour ?? ENAMEL_SWATCH));
  const lastCommitted = useRef(appColour);
  useEffect(() => {
    if (appColour === lastCommitted.current) return;
    lastCommitted.current = appColour;
    if (appColour) setHsv((prev) => (hsvToHex(prev) === appColour ? prev : hexToHsv(appColour)));
    else setHsv(hexToHsv(ENAMEL_SWATCH));
  }, [appColour]);

  const commit = (hex: string | null) => {
    lastCommitted.current = hex;
    setAppColour(hex);
  };

  const onWheel = (next: Hsv, final: boolean) => {
    setHsv(next);
    const hex = hsvToHex(next);
    if (final) commit(hex);
    else previewAppColour(hex);
  };

  // The hex field: free typing; a full #RRGGBB applies as you type, #RGB on Enter or
  // when the field is left; anything else shows the error there and changes nothing.
  const [text, setText] = useState(upper(appColour));
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!editing) setText(upper(appColour));
  }, [appColour, editing]);

  const settleText = () => {
    const raw = text.trim();
    if (!raw) {
      setError(false);
      setText(upper(appColour));
      return;
    }
    const hex = parseHex(raw);
    if (!hex) {
      setError(true);
      return;
    }
    setError(false);
    setText(upper(hex));
    if (hex !== appColour) {
      commit(hex);
      setHsv(hexToHsv(hex));
    }
  };

  const onText = (value: string) => {
    setText(value);
    setError(false);
    const s = value.trim();
    const hex = /^#?[0-9a-f]{6}$/i.test(s) ? parseHex(s) : null;
    if (hex && hex !== appColour) {
      commit(hex);
      setHsv(hexToHsv(hex));
    }
  };

  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const hex = parseHex(e.clipboardData.getData('text'));
    if (!hex) return;
    e.preventDefault();
    setText(upper(hex));
    setError(false);
    commit(hex);
    setHsv(hexToHsv(hex));
  };

  // The system colour picker: paints while it is open, saves when it closes.
  const native = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const el = native.current;
    if (!el) return;
    const onDone = () => {
      const hex = parseHex(el.value);
      if (!hex) return;
      lastCommitted.current = hex;
      setHsv(hexToHsv(hex));
      setAppColour(hex);
    };
    el.addEventListener('change', onDone);
    return () => el.removeEventListener('change', onDone);
  }, [setAppColour]);

  const preset = APP_COLOUR_PRESETS.find((p) => p.hex === appColour);
  const name = preset ? preset.label : upper(appColour);
  // The selection shade this theme actually uses, when contrast moved it off the pick.
  const selection = useMemo(() => (appColour ? deriveAppTokens(appColour, theme)['--appaccent'] : null), [appColour, theme]);
  const adjusted = appColour && selection && selection !== appColour && selection !== deriveAppTokens(null, theme)['--appaccent'];

  return (
    <section className="fp-panel" aria-labelledby={`${id}-title`}>
      <header className="fp-panel-head">
        <div>
          <p className="fp-label">Appearance</p>
          <h3 className="fp-panel-title" id={`${id}-title`}>Theme and colour</h3>
        </div>
      </header>

      <div className="grid gap-x-10 gap-y-5 [grid-template-areas:'theme'_'head'_'wheel'_'controls'] sm:grid-cols-[minmax(0,26rem)_16rem] sm:[grid-template-areas:'theme_wheel'_'head_wheel'_'controls_wheel'] sm:justify-start">
        <div className="fp-stack fp-stack--s [grid-area:theme]">
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

        <div className="fp-stack fp-stack--s [grid-area:head]">
          <span className="fp-label">
            <span id={`${id}-colour`}>App colour</span> · {name || 'Enamel'}
          </span>
          <p className="fp-small fp-muted">
            Colours the whole app and what is selected, in light and dark. Text stays ink, and status lamps and
            charts keep their colours.
          </p>
        </div>

        <div className="[grid-area:wheel] justify-self-center sm:justify-self-start" role="group" aria-labelledby={`${id}-colour`}>
          <ColourWheel value={hsv} onChange={onWheel} />
        </div>

        <div className="fp-stack fp-stack--m [grid-area:controls]">
          <div className="fp-field">
            <label className="fp-label" htmlFor={`${id}-hex`}>Hex code</label>
            <div className="flex items-center gap-2">
              <input
                id={`${id}-hex`}
                className="fp-input fp-input--mono min-w-0 flex-1 uppercase"
                type="text"
                inputMode="text"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                maxLength={9}
                placeholder="#RRGGBB"
                value={text}
                aria-invalid={error || undefined}
                aria-describedby={error ? `${id}-hex-error` : `${id}-hex-help`}
                onFocus={() => setEditing(true)}
                onBlur={() => { setEditing(false); settleText(); }}
                onChange={(e) => onText(e.target.value)}
                onPaste={onPaste}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); settleText(); } }}
              />
              <input
                ref={native}
                type="color"
                className="h-[var(--apptap)] w-[var(--apptap)] flex-none cursor-pointer rounded-[var(--appradius-well)] border border-appborder-strong bg-appkey p-1"
                aria-label="Open the system colour picker"
                value={hsvToHex(hsv)}
                onChange={(e) => {
                  const hex = parseHex(e.target.value);
                  if (!hex) return;
                  setHsv(hexToHsv(hex));
                  previewAppColour(hex);
                }}
              />
            </div>
            {error ? (
              <span className="fp-field-error" id={`${id}-hex-error`} role="alert">
                <Icon name="alert-circle" />
                Use a hex code like #1F4FBF or #14B.
              </span>
            ) : (
              <span className="fp-field-help" id={`${id}-hex-help`}>
                {adjusted
                  ? `Selected keys use ${upper(selection)} in ${theme} so their labels stay readable.`
                  : 'Six digits (#1F4FBF) or three (#14B).'}
              </span>
            )}
          </div>

          <div className="fp-stack fp-stack--s">
            <span className="fp-label" id={`${id}-presets`}>Presets</span>
            <div
              className="fp-swatches -ml-[7px]"
              role="radiogroup"
              aria-labelledby={`${id}-presets`}
              onKeyDown={(e) => onRadioKeys(e, APP_COLOUR_PRESETS, preset, (p) => { commit(p.hex); setHsv(hexToHsv(p.hex ?? ENAMEL_SWATCH)); })}
            >
              {APP_COLOUR_PRESETS.map((p, i) => {
                const active = p === preset;
                return (
                  <button
                    key={p.label}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    aria-label={p.label}
                    title={p.hex ? `${p.label} ${upper(p.hex)}` : p.label}
                    tabIndex={active || (!preset && i === 0) ? 0 : -1}
                    onClick={() => { commit(p.hex); setHsv(hexToHsv(p.hex ?? ENAMEL_SWATCH)); }}
                    className="fp-swatch-key"
                    style={{ '--fp-sw': p.hex ?? ENAMEL_SWATCH } as CSSProperties}
                  />
                );
              })}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <button type="button" className="fp-btn" disabled={appColour == null} onClick={() => commit(null)}>
              Reset to Enamel
            </button>
            <span className="fp-small fp-muted">Saved on this device.</span>
          </div>
        </div>
      </div>
    </section>
  );
}
