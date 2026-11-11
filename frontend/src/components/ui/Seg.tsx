import { useCallback, useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { cx } from './cx';
import { Icon, type IconName } from './Icon';

/*
 * The segmented control: keys in a well, the selected one ink-filled. One implementation for
 * the app's view switches (Electric / Gas / Water, Live / Recordings, the Diagnostics tabs).
 *
 * As tabs (default) it is a real tablist (B-074): each key is role="tab" with aria-selected and
 * aria-controls, only the selected key is in the Tab order, and the arrow keys, Home and End
 * move the selection. Render the view in <SegPanel> with the same `id` so the panel is labelled
 * by its tab.
 *
 * As `kind="radio"` it is a radiogroup with aria-checked, for a setting chosen in place
 * (a thermostat's Heat / Auto / Cool / Off). Same keys, same arrow keys, no panel.
 *
 * A view that should survive a reload, Back, or the app's sleep screen (B-075) keeps its value
 * in the URL with useSearchParamState:
 *
 *   const [view, setView] = useSearchParamState('view', ['electric', 'gas', 'water'] as const, 'electric');
 *   <Seg id="utility-view" label="Utility" value={view} onChange={setView} options={[…]} />
 *   <SegPanel id="utility-view" value={view}>…</SegPanel>
 */

export interface SegOption<T extends string> {
  value: T;
  label: ReactNode;
  icon?: IconName;
  disabled?: boolean;
  /** Spoken instead of `label` when the label alone is ambiguous. */
  ariaLabel?: string;
}

export interface SegProps<T extends string> {
  options: readonly SegOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** What the switch chooses ("Utility", "Mode"): the group's accessible name. */
  label: string;
  /** Ties the tabs to their SegPanel; unique on the page (prefix with the route: "roomba-view"). */
  id?: string;
  kind?: 'tabs' | 'radio';
  /** inline: content-width everywhere (inside a panel); fill: full width everywhere. Default: full on a phone. */
  fit?: 'auto' | 'inline' | 'fill';
  className?: string;
}

/** The DOM id of a Seg key, for anything else that wants to point at it. */
export const segTabId = (id: string, value: string) => `${id}-tab-${value}`;
/** The DOM id of a Seg's panel. */
export const segPanelId = (id: string) => `${id}-panel`;

export function Seg<T extends string>({ options, value, onChange, label, id, kind = 'tabs', fit = 'auto', className }: SegProps<T>) {
  const autoId = useId();
  const base = id ?? `seg${autoId.replace(/[^a-zA-Z0-9]/g, '')}`;
  const keys = useRef<Array<HTMLButtonElement | null>>([]);
  const tabs = kind === 'tabs';
  // The one key in the Tab order: the selected one, or the first usable key if none is.
  const selectedIndex = options.findIndex((o) => o.value === value && !o.disabled);
  const tabStop = selectedIndex >= 0 ? selectedIndex : options.findIndex((o) => !o.disabled);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const enabled = options.map((o, i) => (o.disabled ? -1 : i)).filter((i) => i >= 0);
    if (!enabled.length) return;
    const at = enabled.indexOf(options.findIndex((o) => o.value === value));
    let next: number | null = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = enabled[(at + 1) % enabled.length];
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = enabled[(at - 1 + enabled.length) % enabled.length];
    else if (e.key === 'Home') next = enabled[0];
    else if (e.key === 'End') next = enabled[enabled.length - 1];
    if (next == null) return;
    e.preventDefault();
    // Selection follows focus: the views are cheap to switch and that is what people expect of a switch.
    onChange(options[next].value);
    keys.current[next]?.focus();
  };

  return (
    <div
      className={cx('fp-seg', fit === 'inline' && 'fp-seg--inline', fit === 'fill' && 'fp-seg--fill', className)}
      role={tabs ? 'tablist' : 'radiogroup'}
      aria-label={label}
      onKeyDown={onKeyDown}
    >
      {options.map((o, i) => {
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => { keys.current[i] = el; }}
            type="button"
            className="fp-seg-key"
            role={tabs ? 'tab' : 'radio'}
            id={tabs ? segTabId(base, o.value) : undefined}
            aria-selected={tabs ? selected : undefined}
            aria-checked={tabs ? undefined : selected}
            aria-controls={tabs && selected ? segPanelId(base) : undefined}
            aria-label={o.ariaLabel}
            tabIndex={i === tabStop ? 0 : -1}
            disabled={o.disabled}
            onClick={() => { if (!selected) onChange(o.value); }}
          >
            {o.icon && <Icon name={o.icon} />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * The view a tab Seg shows, labelled by the selected tab. Render one panel and switch its
 * content (the kit's "stack stack--page" spacing is the default).
 */
export function SegPanel({ id, value, className = 'fp-stack fp-stack--page', children }: { id: string; value: string; className?: string; children: ReactNode }) {
  return (
    <div role="tabpanel" id={segPanelId(id)} aria-labelledby={segTabId(id, value)} className={className}>
      {children}
    </div>
  );
}

/**
 * A choice kept in the URL's query string (?view=gas), so it survives a reload, Back, the
 * sleep screen and a shared link. The default value is left out of the URL; an unknown value
 * falls back to it. Changes replace the history entry (switching views is not navigation, so
 * Back still leaves the page) and keep every other parameter. Needs a router (it is
 * useSearchParams underneath).
 */
export function useSearchParamState<T extends string>(
  key: string,
  allowed: readonly T[],
  fallback: T,
): [T, (next: T) => void] {
  const [params, setParams] = useSearchParams();
  const raw = params.get(key);
  const value = raw != null && (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback;
  const set = useCallback(
    (next: T) => {
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          if (next === fallback) p.delete(key);
          else p.set(key, next);
          return p;
        },
        { replace: true },
      );
    },
    [key, fallback, setParams],
  );
  return [value, set];
}
