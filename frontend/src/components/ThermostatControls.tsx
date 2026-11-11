import { memo } from 'react';
import { IconButton, LegendKey, cx } from './ui';
import { formatTemp } from '../utils/thermostat';

// Building blocks for ThermostatCard: the setpoint keys under the dial. 44px touch
// targets; heat and cool are told apart by their legend swatch and their words, never
// by colour alone.

/**
 * The old app's focus ring. Converted pages get the kit's focus outline from index.css; this
 * stays exported because pages not converted yet still import it from here.
 */
export const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-appaccent focus-visible:ring-offset-2 focus-visible:ring-offset-appsurface';

export type Side = 'heat' | 'cool';

export function Spinner({ className = '' }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent ${className}`}
    />
  );
}

interface SetpointTileProps {
  side: Side;
  /** "Heat to" / "Cool to" */
  label: string;
  /** Used in key labels: "Raise Upstairs cool-to temperature". */
  deviceName: string;
  value: number | null;
  unit: string;
  /** The value is the person's pending draft, not yet the thermostat's. */
  pending: boolean;
  /** Briefly outline (the other side was pushed to keep the gap). */
  flash: boolean;
  readOnly: boolean;
  disabled: boolean;
  lowerDisabled?: boolean;
  raiseDisabled?: boolean;
  onStep: (delta: number) => void;
}

/**
 * One setpoint: its legend label over a − value + well. Two sit side by side under the dial
 * (one, centred, in Heat or Cool). The keys use aria-disabled rather than disabled, so a key
 * at a limit stays focusable and says why it does nothing (B-020: the old tiles let the +
 * hang out of the box on a 390px phone; this row shrinks the number, never the keys).
 */
export const SetpointTile = memo(function SetpointTile({
  side,
  label,
  deviceName,
  value,
  unit,
  pending,
  flash,
  readOnly,
  disabled,
  lowerDisabled,
  raiseDisabled,
  onStep,
}: SetpointTileProps) {
  const noun = `${deviceName} ${side === 'heat' ? 'heat-to' : 'cool-to'} temperature`;
  const lowerOff = disabled || value == null || !!lowerDisabled;
  const raiseOff = disabled || value == null || !!raiseDisabled;
  const shown = (
    <output
      className={cx(
        'fp-num fp-stepper-value min-w-0 flex-1',
        pending && 'underline decoration-apptext-muted decoration-dotted decoration-2 underline-offset-[5px]',
      )}
      aria-live="polite"
    >
      {formatTemp(value)}
      <span className="fp-unit">{unit}</span>
    </output>
  );
  return (
    <div className="flex min-w-0 max-w-44 flex-[1_1_0] flex-col items-center gap-2">
      <span className="fp-lg-item fp-label">
        <LegendKey tone={side} kind="box" />
        {label}
      </span>
      {readOnly ? (
        <div className="fp-stepper w-full justify-center">{shown}</div>
      ) : (
        <div
          className={cx('fp-stepper w-full justify-between transition-shadow', flash && 'ring-2 ring-apptext')}
          role="group"
          aria-label={`${deviceName} ${label.toLowerCase()}`}
        >
          <IconButton
            icon="minus"
            variant="quiet"
            label={`Lower ${noun}`}
            aria-disabled={lowerOff}
            className="aria-disabled:cursor-not-allowed aria-disabled:opacity-40"
            onClick={lowerOff ? undefined : () => onStep(-1)}
          />
          {shown}
          <IconButton
            icon="plus"
            variant="quiet"
            label={`Raise ${noun}`}
            aria-disabled={raiseOff}
            className="aria-disabled:cursor-not-allowed aria-disabled:opacity-40"
            onClick={raiseOff ? undefined : () => onStep(1)}
          />
        </div>
      )}
    </div>
  );
});
