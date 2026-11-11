import type { CSSProperties } from 'react';

/**
 * The signed-in person's avatar for the shell (strip, More sheet): their photo, or
 * their initials on their own colour. The kit's .fp-avatar draws it opaque, so
 * the initials no longer fade into a pale see-through circle in the light theme
 * (B-158 in the shell; Users and Profile still use profile/Avatar).
 */

/** Same rule as profile/Avatar, so a person reads the same everywhere: "Bryan" B, "Mai Tran" MT. */
export function initialsOf(name: string): string {
  return (name || '?')
    .split(' ')
    .filter(Boolean)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2) || '?';
}

/**
 * Ink initials on a light colour, white on a dark one. People pick any colour,
 * including the dark presets, where ink lettering would vanish.
 */
function letteringFor(hex: string | null | undefined): string | undefined {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex ?? '');
  if (!m) return undefined;
  const n = parseInt(m[1], 16);
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const lum = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  // Above ~0.18 ink (#15181a) has the better contrast; below it, white does.
  return lum < 0.18 ? '#ffffff' : undefined;
}

export default function ShellAvatar({
  name,
  avatarUrl,
  accentColor,
  className = '',
}: {
  name: string;
  avatarUrl?: string | null;
  accentColor?: string | null;
  className?: string;
}) {
  const style = {
    ...(accentColor ? { '--fp-who': accentColor } : null),
    ...(letteringFor(accentColor) ? { color: letteringFor(accentColor) } : null),
  } as CSSProperties;
  return (
    <span className={`fp-avatar overflow-hidden ${className}`} style={style} aria-hidden="true">
      {avatarUrl ? <img src={avatarUrl} alt="" className="h-full w-full object-cover" /> : initialsOf(name)}
    </span>
  );
}
