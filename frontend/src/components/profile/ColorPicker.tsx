import { Swatches } from '../ui';

const PRESET_COLORS = [
  // Reds
  { hex: '#DC2626', name: 'Crimson' },
  { hex: '#EF4444', name: 'Red' },
  { hex: '#F43F5E', name: 'Rose' },
  { hex: '#C2410C', name: 'Copper' },
  // Oranges / peaches / browns
  { hex: '#EA580C', name: 'Orange' },
  { hex: '#F97316', name: 'Coral' },
  { hex: '#FB923C', name: 'Peach' },
  { hex: '#B45309', name: 'Bronze' },
  // Was called "Plum" among the purples, but it is a rust brown (B-159). Renamed rather than
  // re-coloured: people who chose it have this hex saved, and it should stay selected for them.
  { hex: '#7C2D12', name: 'Chestnut' },
  // Pinks
  { hex: '#FB7185', name: 'Bubblegum Pink' },
  { hex: '#DB2777', name: 'Magenta' },
  // Purples / violets
  { hex: '#A855F7', name: 'Purple' },
  { hex: '#8B5CF6', name: 'Violet' },
  { hex: '#A78BFA', name: 'Lavender' },
  { hex: '#6366F1', name: 'Indigo' },
  { hex: '#C026D3', name: 'Orchid' },
  // Blues
  { hex: '#2563EB', name: 'Royal Blue' },
  { hex: '#0284C7', name: 'Ocean Blue' },
  { hex: '#0EA5E9', name: 'Sky Blue' },
  { hex: '#0369A1', name: 'Deep Sea' },
  // Teals / cyans
  { hex: '#06B6D4', name: 'Cyan' },
  { hex: '#14B8A6', name: 'Teal' },
  // Greens
  { hex: '#10B981', name: 'Emerald' },
  { hex: '#34D399', name: 'Mint' },
  { hex: '#22C55E', name: 'Aqua Green' },
  { hex: '#16A34A', name: 'Forest Green' },
  { hex: '#15803D', name: 'Jade' },
  { hex: '#84CC16', name: 'Lime' },
  // Neutrals
  { hex: '#94A3B8', name: 'Silver' },
  { hex: '#64748B', name: 'Slate' },
  { hex: '#475569', name: 'Steel Gray' },
  { hex: '#334155', name: 'Charcoal' },
];

const OPTIONS = PRESET_COLORS.map(({ hex, name }) => ({ value: hex, label: name, color: hex }));

/**
 * The 32 preset colours as kit swatch keys: toggle buttons with aria-pressed in a group
 * named "Your colour", with the kit's visible focus ring (B-160: the old inline box-shadow
 * hid the focus indicator and nothing said which colour was chosen).
 */
export default function ColorPicker({
  selected,
  onChange,
  label = 'Your colour',
}: {
  selected: string;
  onChange: (color: string) => void;
  label?: string;
}) {
  // Saved colours may differ in case from the presets ("#34d399"); match the preset's spelling.
  const value = PRESET_COLORS.find((c) => c.hex.toLowerCase() === selected?.toLowerCase())?.hex ?? selected;
  return <Swatches label={label} value={value} onChange={onChange} options={OPTIONS} />;
}

/** The preset's name for a hex ("Sky Blue"), or null for a colour not in the set. */
export function colorName(hex: string | null | undefined): string | null {
  if (!hex) return null;
  return PRESET_COLORS.find((c) => c.hex.toLowerCase() === hex.toLowerCase())?.name ?? null;
}

export { PRESET_COLORS };
