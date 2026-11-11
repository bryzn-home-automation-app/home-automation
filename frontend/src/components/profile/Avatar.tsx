import { useState, type CSSProperties } from 'react';
import { avatarInk, initials } from '../ui';

/**
 * A person's avatar at any pixel size: their photo, or their initials on their own colour.
 *
 * The kit's <Avatar> (components/ui/People) has five fixed sizes; this keeps the old
 * numeric `size` prop for the pages that still pass one (guest sign-in, Edit profile) and
 * draws the same fp-avatar: an opaque disc with ink or white initials, whichever reads
 * better on the person's colour (B-158: white on a translucent pastel measured 1.2–2:1),
 * and the same initials rule as the shell and the kit (B-183).
 */
export default function Avatar({
  displayName,
  avatarUrl,
  accentColor,
  size = 80,
  className = '',
}: {
  displayName: string;
  avatarUrl?: string | null;
  accentColor: string;
  size?: number;
  className?: string;
}) {
  const [broken, setBroken] = useState<string | null>(null);
  const showPhoto = !!avatarUrl && broken !== avatarUrl;
  const ink = avatarInk(accentColor);
  const style = {
    '--fp-who': accentColor,
    '--fp-size': `${size}px`,
    fontSize: Math.round(size * 0.38),
    ...(ink && !showPhoto ? { color: ink } : {}),
    ...(showPhoto ? { overflow: 'hidden' } : {}),
  } as CSSProperties;

  return (
    <span className={`fp-avatar ${className}`} style={style} role="img" aria-label={displayName || 'Avatar'}>
      {showPhoto ? (
        <img
          src={avatarUrl!}
          alt=""
          onError={() => setBroken(avatarUrl!)}
          style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }}
        />
      ) : (
        <span aria-hidden="true">{initials(displayName)}</span>
      )}
    </span>
  );
}
