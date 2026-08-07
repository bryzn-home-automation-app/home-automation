import Avatar from './Avatar';
import RoleBadge from './RoleBadge';

interface UserProfileCardProps {
  displayName: string;
  username: string;
  email: string;
  phone: string | null;
  avatarUrl: string | null;
  accentColor: string;
  role: string;
  onEdit: () => void;
}

/** Premium profile card showing identity + role. */
export default function UserProfileCard({
  displayName,
  username,
  email,
  phone,
  avatarUrl,
  accentColor,
  role,
  onEdit,
}: UserProfileCardProps) {
  return (
    <div className="rounded-[32px] border border-appborder bg-appsurface-raised p-6 shadow-[0_16px_48px_var(--appshadow)] sm:p-8">
      <div className="flex flex-col items-center gap-5 sm:flex-row sm:gap-7">
        {/* Avatar ring uses role or custom accent */}
        <Avatar
          displayName={displayName}
          avatarUrl={avatarUrl}
          accentColor={accentColor}
          size={104}
        />

        <div className="flex-1 text-center sm:text-left">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
            <h2 className="text-2xl font-semibold tracking-[-0.03em] text-apptext">
              {displayName}
            </h2>
            <RoleBadge role={role} accentColor={role === 'GUEST' ? accentColor : undefined} />
          </div>

          <p className="mt-1.5 text-sm text-apptext-muted">@{username}</p>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-appborder bg-appinset px-3 py-2.5">
              <p className="text-[10px] uppercase tracking-[0.14em] text-apptext-dim">Email</p>
              <p className="mt-0.5 text-sm font-medium text-apptext-soft truncate">{email}</p>
            </div>
            <div className="rounded-xl border border-appborder bg-appinset px-3 py-2.5">
              <p className="text-[10px] uppercase tracking-[0.14em] text-apptext-dim">Phone</p>
              <p className="mt-0.5 text-sm font-medium text-apptext-soft">
                {phone || 'Not set'}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onEdit}
            className="mt-4 inline-flex items-center gap-2 rounded-xl border border-appaccent-border bg-appaccent-soft px-5 py-2.5 text-sm font-semibold text-appaccent-text transition-all hover:bg-appaccent-soft/80 active:scale-[0.98]"
          >
            ✏️ Edit Profile
          </button>
        </div>
      </div>
    </div>
  );
}
