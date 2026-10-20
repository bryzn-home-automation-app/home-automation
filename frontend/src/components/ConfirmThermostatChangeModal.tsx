import { useRef } from 'react';
import { useFocusTrap } from '../hooks/useFocusTrap';
import { FOCUS_RING } from './ThermostatControls';

interface ConfirmThermostatChangeModalProps {
  deviceName: string;
  /** Who changed it and how long ago ("4 minutes ago" / "just now"). */
  changedBy: string;
  ago: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * "Bryan changed Upstairs 4 minutes ago — change it anyway?" Shown before
 * overriding another household member's recent change.
 */
export default function ConfirmThermostatChangeModal({
  deviceName,
  changedBy,
  ago,
  onConfirm,
  onCancel,
}: ConfirmThermostatChangeModalProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  useFocusTrap(true, panelRef, undefined, onCancel);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-thermostat-title"
      aria-describedby="confirm-thermostat-body"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        ref={panelRef}
        className="w-full max-w-sm rounded-[24px] border border-appborder bg-appsurface-raised p-6 shadow-[0_20px_60px_var(--appshadow)]"
      >
        <p className="text-2xs font-medium uppercase tracking-[0.18em] text-apptext-muted">Recently changed</p>
        <h3 id="confirm-thermostat-title" className="mt-2 text-xl font-semibold text-apptext">
          Change {deviceName}?
        </h3>
        <p id="confirm-thermostat-body" className="mt-3 text-sm text-apptext-soft">
          <span className="font-semibold text-apptext">{changedBy}</span> changed the {deviceName} thermostat {ago}.
          Are you sure you want to change it?
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className={`h-11 rounded-xl border border-appborder bg-appinset px-4 text-sm font-medium text-apptext-soft transition-colors hover:bg-appinset-strong ${FOCUS_RING}`}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`h-11 rounded-xl border border-appaccent-border bg-appaccent-soft px-4 text-sm font-semibold text-appaccent-text transition-colors hover:brightness-110 ${FOCUS_RING}`}
          >
            Change anyway
          </button>
        </div>
      </div>
    </div>
  );
}
