import { Tag } from '../ui';
import { roleLabel } from '../../utils/status';
import Avatar from './Avatar';

interface UserProfileCardProps {
  displayName: string;
  username: string;
  email: string;
  phone: string | null;
  avatarUrl: string | null;
  accentColor: string;
  role: string;
}

/**
 * Who you are, as Profile's instrument: your photo or initials on your own colour, your
 * name with your role (Admin / Member / Guest, B-053), and how the house reaches you.
 * Not a card of its own: it sits in the page's instrument panel.
 */
export default function UserProfileCard({ displayName, username, email, phone, avatarUrl, accentColor, role }: UserProfileCardProps) {
  // Guest accounts carry an internal placeholder address that means nothing to anyone (B-182).
  const realEmail = email && !email.endsWith('@guest.local') ? email : null;
  return (
    <div className="flex w-full items-center gap-5">
      <Avatar displayName={displayName} avatarUrl={avatarUrl} accentColor={accentColor} size={88} />
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2">
          <span className="text-[22px] font-semibold leading-tight text-apptext">{displayName}</span>
          <Tag>{roleLabel(role)}</Tag>
        </p>
        <p className="fp-mono mt-1 truncate text-sm text-apptext-muted">@{username}</p>
        {realEmail && <p className="fp-mono truncate text-sm text-apptext-muted">{realEmail}</p>}
        <p className="fp-mono truncate text-sm text-apptext-muted">{phone || 'No phone number'}</p>
      </div>
    </div>
  );
}
