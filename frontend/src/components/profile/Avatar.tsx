/** Avatar with role-colored border. Pure presentational. */
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
  const initials = (displayName || '?')
    .split(' ')
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  return (
    <div
      className={`relative shrink-0 overflow-hidden rounded-full ${className}`}
      style={{
        width: size,
        height: size,
        border: `3px solid ${accentColor}`,
        boxShadow: `0 0 24px ${accentColor}30`,
      }}
    >
      {avatarUrl ? (
        <img
          src={avatarUrl}
          alt={displayName}
          className="h-full w-full object-cover"
        />
      ) : (
        <div
          className="flex h-full w-full items-center justify-center text-white font-semibold"
          style={{ background: `linear-gradient(135deg, ${accentColor}CC, ${accentColor}44)` }}
        >
          <span style={{ fontSize: size * 0.38 }}>{initials}</span>
        </div>
      )}
    </div>
  );
}
