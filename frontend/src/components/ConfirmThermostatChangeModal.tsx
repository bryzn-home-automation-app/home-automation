import { ConfirmDialog } from './ui';

interface ConfirmThermostatChangeModalProps {
  open: boolean;
  deviceName: string;
  /** Who changed it and how long ago ("4 minutes ago" / "just now"). */
  changedBy: string;
  ago: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * "Mai changed Upstairs 4 minutes ago. Change it anyway?" Shown before overriding another
 * household member's recent change. The kit's ConfirmDialog gives it the opaque panel (B-008),
 * focus on Cancel, Escape and the back gesture (B-043).
 */
export default function ConfirmThermostatChangeModal({
  open,
  deviceName,
  changedBy,
  ago,
  onConfirm,
  onCancel,
}: ConfirmThermostatChangeModalProps) {
  return (
    <ConfirmDialog
      open={open}
      eyebrow="Recently changed"
      title={`Change ${deviceName}?`}
      confirmLabel="Change anyway"
      onConfirm={onConfirm}
      onCancel={onCancel}
    >
      <p>
        <strong>{changedBy}</strong> changed the {deviceName} thermostat {ago}. Change it anyway?
      </p>
    </ConfirmDialog>
  );
}
