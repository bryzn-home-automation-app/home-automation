import { useId, type CSSProperties, type ReactNode } from 'react';
import { cx, knobs } from './cx';
import { Icon, type IconName } from './Icon';
import { IconButton } from './Button';

/*
 * Chips (filters and ranges), Switch (a setting that saves instantly), Stepper (− value +),
 * Swatches (colour keys). Every one carries its state in ARIA, which is also what the kit's
 * CSS selects on, so the look can never disagree with what a screen reader hears (B-041).
 */

// ─── Chips ──────────────────────────────────────────────────────────────

export interface ChipOption<T extends string> {
  value: T;
  label: ReactNode;
  icon?: IconName;
  /** A small counter plate on the chip ("Driveway 12"). */
  count?: number;
  /** This one can't be chosen right now (faded, skipped by taps). */
  disabled?: boolean;
}

interface ChipsBase<T extends string> {
  options: readonly ChipOption<T>[];
  /** What the chips filter ("Camera", "Severity"): the group's name, so two "All" chips differ. */
  label: string;
  /** The whole row can't be used right now (while saving, say). */
  disabled?: boolean;
  className?: string;
}

export interface SingleChipsProps<T extends string> extends ChipsBase<T> {
  multiple?: false;
  value: T;
  onChange: (value: T) => void;
}

export interface MultiChipsProps<T extends string> extends ChipsBase<T> {
  multiple: true;
  value: readonly T[];
  onChange: (value: T[]) => void;
}

/**
 * A row of chips in a labelled group. Single choice (a range, a filter) or `multiple`
 * (alert types). Each chip is a toggle button with aria-pressed: 34px tall with a 44px hit area.
 * One row of filters, above what they filter (a panel's action slot or the first thing in it).
 */
export function Chips<T extends string>(props: SingleChipsProps<T> | MultiChipsProps<T>) {
  const { options, label, disabled, className } = props;
  const isOn = (v: T) => (props.multiple ? props.value.includes(v) : props.value === v);
  const toggle = (v: T) => {
    if (props.multiple) {
      props.onChange(props.value.includes(v) ? props.value.filter((x) => x !== v) : [...props.value, v]);
    } else if (props.value !== v) {
      props.onChange(v);
    }
  };
  return (
    <div className={cx('fp-chips', className)} role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" className="fp-chip" aria-pressed={isOn(o.value)} disabled={disabled || o.disabled} onClick={() => toggle(o.value)}>
          {o.icon && <Icon name={o.icon} />}
          {o.label}
          {o.count != null && o.count > 0 && <span className="fp-count">{o.count}</span>}
        </button>
      ))}
    </div>
  );
}

// ─── Switch ─────────────────────────────────────────────────────────────

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** The setting's name. With `bare`, it is the accessible name only (read, not shown). */
  label: ReactNode;
  /** One line under the label ("A heads-up at 8 PM when rain is likely"). */
  help?: ReactNode;
  /** Just the track (a switch in a table cell or a row's trail). */
  bare?: boolean;
  disabled?: boolean;
  /** Saving: the switch stays put and says so, so a double tap can't flip it back mid-request. */
  busy?: boolean;
  className?: string;
}

/**
 * A two-position switch: a <button role="switch" aria-checked>. The full-width row is the
 * whole target; in a <List> it gets the list's dividers (wrap it in an <li>).
 */
export function Switch({ checked, onChange, label, help, bare, disabled, busy, className }: SwitchProps) {
  const helpId = useId();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-describedby={help != null && !bare ? helpId : undefined}
      aria-busy={busy || undefined}
      disabled={disabled}
      className={cx('fp-switch', bare && 'fp-switch--bare', className)}
      onClick={() => { if (!busy) onChange(!checked); }}
    >
      {/* Bare: the name is still inside the button, so a JSX label names it as well as a string
          (an aria-label could only take a string, and the track is aria-hidden). */}
      {bare && <span className="fp-sr-only">{label}</span>}
      {!bare && (
        <span className="fp-switch-text">
          <span className="fp-switch-label">{label}</span>
          {help != null && <span className="fp-switch-help" id={helpId}>{help}</span>}
        </span>
      )}
      <span className="fp-switch-track" aria-hidden="true"><span className="fp-switch-knob" /></span>
    </button>
  );
}

// ─── Stepper ────────────────────────────────────────────────────────────

export interface StepperProps {
  value: number;
  onChange: (value: number) => void;
  /** What is being set ("Heat to"): names the group and the two keys ("Lower heat to", "Raise heat to"). */
  label: string;
  min?: number;
  max?: number;
  step?: number;
  /** How the value is written (default: as is). */
  format?: (value: number) => ReactNode;
  unit?: string;
  disabled?: boolean;
  className?: string;
}

/** − value +. The value is an <output>, so screen readers hear each change. */
export function Stepper({ value, onChange, label, min = -Infinity, max = Infinity, step = 1, format, unit, disabled, className }: StepperProps) {
  const clamp = (v: number) => Math.min(max, Math.max(min, Number(v.toFixed(6))));
  const lower = label.charAt(0).toLowerCase() + label.slice(1);
  return (
    <div className={cx('fp-stepper', className)} role="group" aria-label={label}>
      <IconButton icon="minus" variant="quiet" label={`Lower ${lower}`} disabled={disabled || value <= min} onClick={() => onChange(clamp(value - step))} />
      <output className="fp-num fp-stepper-value" aria-live="polite">
        {format ? format(value) : value}
        {unit && <span className="fp-unit">{unit}</span>}
      </output>
      <IconButton icon="plus" variant="quiet" label={`Raise ${lower}`} disabled={disabled || value >= max} onClick={() => onChange(clamp(value + step))} />
    </div>
  );
}

// ─── Swatches ───────────────────────────────────────────────────────────

export interface SwatchOption<T extends string> {
  value: T;
  /** Spoken name ("Sky blue"). */
  label: string;
  /** Any CSS colour: a token (var(--appfinish-ocean)) or a person's hex. */
  color: string;
}

/**
 * Colour keys, single choice: a person's colour, a finish. Toggle buttons in a labelled group
 * (aria-pressed), like single-choice Chips, so each key is a plain Tab stop.
 */
export function Swatches<T extends string>({ options, value, onChange, label, className }: { options: readonly SwatchOption<T>[]; value: T; onChange: (v: T) => void; label: string; className?: string }) {
  return (
    <div className={cx('fp-swatches', className)} role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          aria-label={o.label}
          title={o.label}
          className="fp-swatch-key"
          style={knobs({ '--fp-sw': o.color }) as CSSProperties}
          onClick={() => onChange(o.value)}
        />
      ))}
    </div>
  );
}
