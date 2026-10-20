import { memo } from 'react';
import { formatTemp } from '../utils/thermostat';

// Building blocks for ThermostatCard. 44px (h-11) touch targets throughout and a
// shared focus ring; orange always means heat and sky always means cool.

export const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-appaccent focus-visible:ring-offset-2 focus-visible:ring-offset-appsurface';

export type Side = 'heat' | 'cool';

const SIDE_STYLES: Record<Side, { tile: string; label: string; flash: string }> = {
  heat: { tile: 'border-orange-300/25', label: 'text-orange-400', flash: 'ring-2 ring-orange-300/60' },
  cool: { tile: 'border-sky-300/25', label: 'text-sky-400', flash: 'ring-2 ring-sky-300/60' },
};

export function Spinner({ className = '' }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent ${className}`}
    />
  );
}

function StepButton({
  label,
  symbol,
  onClick,
  disabled,
}: {
  label: string;
  symbol: string;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      aria-disabled={disabled}
      aria-label={label}
      className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-appborder bg-appsurface text-xl font-semibold text-apptext transition-colors hover:border-appborder-hover hover:bg-appinset-strong aria-disabled:cursor-not-allowed aria-disabled:opacity-40 ${FOCUS_RING}`}
    >
      {symbol}
    </button>
  );
}

interface SetpointTileProps {
  side: Side;
  /** "Heat to" / "Cool to" */
  label: string;
  /** Used in button labels: "Raise Upstairs cool-to temperature". */
  deviceName: string;
  value: number | null;
  unit: string;
  /** The value is the user's pending draft, not yet the thermostat's. */
  pending: boolean;
  /** Briefly highlight (the other side was pushed to keep the gap). */
  flash: boolean;
  span?: boolean;
  readOnly: boolean;
  disabled: boolean;
  lowerDisabled?: boolean;
  raiseDisabled?: boolean;
  onStep: (delta: number) => void;
}

export const SetpointTile = memo(function SetpointTile({
  side,
  label,
  deviceName,
  value,
  unit,
  pending,
  flash,
  span,
  readOnly,
  disabled,
  lowerDisabled,
  raiseDisabled,
  onStep,
}: SetpointTileProps) {
  const s = SIDE_STYLES[side];
  const noun = `${deviceName} ${side === 'heat' ? 'heat-to' : 'cool-to'} temperature`;
  return (
    <div
      className={`rounded-2xl border bg-appinset p-3 transition-shadow duration-300 ${s.tile} ${flash ? s.flash : ''} ${span ? 'col-span-2' : ''}`}
    >
      <p className={`text-3xs font-semibold uppercase tracking-[0.18em] ${s.label}`}>{label}</p>
      <div className={`mt-2 flex items-center ${readOnly ? 'justify-start' : 'justify-between'} gap-2`}>
        {!readOnly && (
          <StepButton
            label={`Lower ${noun}`}
            symbol="−"
            onClick={() => onStep(-1)}
            disabled={disabled || value == null || !!lowerDisabled}
          />
        )}
        <span
          className={`text-3xl font-semibold tabular-nums ${
            pending ? 'text-appaccent-text underline decoration-dotted decoration-2 underline-offset-4' : 'text-apptext'
          }`}
        >
          {formatTemp(value)}
          <span className="text-base font-medium text-apptext-muted">{unit}</span>
        </span>
        {!readOnly && (
          <StepButton
            label={`Raise ${noun}`}
            symbol="+"
            onClick={() => onStep(1)}
            disabled={disabled || value == null || !!raiseDisabled}
          />
        )}
      </div>
    </div>
  );
});
