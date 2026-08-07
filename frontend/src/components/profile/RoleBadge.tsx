const ROLE_CONFIG: Record<string, { label: string; color: string; bg: string; border: string }> = {
  ADMIN:     { label: 'Administrator',   color: '#FFD700', bg: 'rgba(255,215,0,0.12)',  border: 'rgba(255,215,0,0.30)' },
  USER:      { label: 'Household Member', color: '#3b82f6', bg: 'rgba(59,130,246,0.12)',  border: 'rgba(59,130,246,0.30)' },
  GUEST:     { label: 'Guest',           color: '#a78bfa', bg: 'rgba(167,139,250,0.12)', border: 'rgba(167,139,250,0.30)' },
};

/** Role badge with distinct styling per role. Reusable — new roles just add to ROLE_CONFIG. */
export default function RoleBadge({ role, accentColor }: { role: string; accentColor?: string }) {
  const config = ROLE_CONFIG[role] ?? ROLE_CONFIG.USER;
  const color = accentColor || config.color;

  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em]"
      style={{
        color,
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
