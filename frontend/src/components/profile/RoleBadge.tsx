import { useTheme } from '../../context/ThemeContext';

const ROLE_CONFIG: Record<string, { label: string; color: string; bg: string; border: string }> = {
  ADMIN:     { label: 'Administrator',   color: '#FFD700', bg: 'rgba(255,215,0,0.12)',  border: 'rgba(255,215,0,0.30)' },
  USER:      { label: 'Household Member', color: '#3b82f6', bg: 'rgba(59,130,246,0.12)',  border: 'rgba(59,130,246,0.30)' },
  GUEST:     { label: 'Guest',           color: '#a78bfa', bg: 'rgba(167,139,250,0.12)', border: 'rgba(167,139,250,0.30)' },
};

/** Role badge with distinct styling per role. Reusable — new roles just add to ROLE_CONFIG. */
export default function RoleBadge({ role, accentColor }: { role: string; accentColor?: string }) {
  const { isLight } = useTheme();
  const config = ROLE_CONFIG[role] ?? ROLE_CONFIG.USER;
  const color = accentColor || config.color;
  // The role/accent colors are bright, dark-mode-tuned hues (gold #FFD700 is
  // 1.4:1 on white). In light mode the label is the role color pulled 60% of
  // the way toward --apptext, which keeps the hue and clears 4.5:1 for any
  // accent a guest can pick; the dot, tint and border keep the raw color.
  const textColor = isLight ? `color-mix(in srgb, ${color} 40%, var(--apptext))` : color;

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-2xs font-semibold uppercase tracking-[0.14em]"
      style={{
        color: textColor,
        borderColor: `${color}40`,
        background: `${color}18`,
      }}
    >
      <span className="inline-block h-2 w-2 rounded-full" style={{ background: color }} />
      {config.label}
    </span>
  );
}

export { ROLE_CONFIG };
