const PRESET_COLORS = [
  // Reds
  { hex: '#DC2626', name: 'Crimson' },
  { hex: '#EF4444', name: 'Red' },
  { hex: '#F43F5E', name: 'Rose' },
  { hex: '#C2410C', name: 'Copper' },
  // Oranges / peaches
  { hex: '#EA580C', name: 'Orange' },
  { hex: '#F97316', name: 'Coral' },
  { hex: '#FB923C', name: 'Peach' },
  { hex: '#B45309', name: 'Bronze' },
  // Pinks
  { hex: '#FB7185', name: 'Bubblegum Pink' },
  { hex: '#DB2777', name: 'Magenta' },
  // Purples / violets
  { hex: '#A855F7', name: 'Purple' },
  { hex: '#8B5CF6', name: 'Violet' },
  { hex: '#A78BFA', name: 'Lavender' },
  { hex: '#6366F1', name: 'Indigo' },
  { hex: '#C026D3', name: 'Orchid' },
  { hex: '#7C2D12', name: 'Plum' },
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

/** 32-color preset picker with tooltips, organized by hue. Returns the selected hex. */
export default function ColorPicker({
  selected,
  onChange,
}: {
  selected: string;
  onChange: (color: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2.5">
      {PRESET_COLORS.map(({ hex, name }) => (
        <button
          key={hex}
          type="button"
          onClick={() => onChange(hex)}
          className="group relative h-9 w-9 rounded-full transition-all hover:scale-125 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
          style={{
            background: hex,
            boxShadow: selected === hex ? `0 0 0 3px var(--appbg), 0 0 0 5px ${hex}` : `0 0 0 2px var(--appbg)`,
          }}
          aria-label={name}
          title={name}
        >
          <span className="pointer-events-none absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md bg-slate-800 px-2 py-1 text-[10px] text-white opacity-0 transition-opacity group-hover:opacity-100">
            {name}
          </span>
        </button>
      ))}
    </div>
  );
}

export { PRESET_COLORS };
