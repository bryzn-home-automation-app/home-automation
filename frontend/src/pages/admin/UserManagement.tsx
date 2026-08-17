import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fetchAllUsers,
  fetchPendingUsers,
  approveUser,
  denyUser,
  updateUserRole,
  disableUser,
  reactivateUser,
  type AdminUser,
} from '../../api/auth';
import OnlineDot from '../../components/profile/OnlineDot';
import { useAuth } from '../../context/AuthContext';

function timeAgo(iso: string | null): string {
  if (!iso) return 'Never';
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const roleBadgeColors: Record<string, string> = {
  ADMIN: 'border-amber-300/30 bg-amber-300/10 text-amber-200',
  USER: 'border-sky-300/30 bg-sky-300/10 text-sky-200',
  GUEST: 'border-purple-300/30 bg-purple-300/10 text-purple-200',
};

const statusBadgeColors: Record<string, string> = {
  PENDING_APPROVAL: 'border-yellow-300/30 bg-yellow-300/10 text-yellow-200',
  ACTIVE: 'border-emerald-300/30 bg-emerald-300/10 text-emerald-200',
  DISABLED: 'border-rose-300/30 bg-rose-300/10 text-rose-200',
  EXPIRED: 'border-appborder bg-appinset text-apptext-muted',
};

function roleAccent(role: string): string {
  if (role === 'ADMIN') return '#FFD700';
  if (role === 'GUEST') return '#a78bfa';
  return '#3b82f6';
}

const roleRailStyles: Record<string, string> = {
  ADMIN: 'bg-gradient-to-b from-yellow-400/90 to-yellow-600/90 text-yellow-100',
  USER: 'bg-gradient-to-b from-sky-400/90 to-blue-700/90 text-sky-100',
  GUEST: 'bg-gradient-to-b from-fuchsia-400/90 to-purple-700/90 text-fuchsia-100',
};

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ''}${parts[1][0] ?? ''}`.toUpperCase();
}

export default function UserManagement() {
  const { isAdmin } = useAuth();
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'all' | 'pending'>('all');
  const [selectedRole, setSelectedRole] = useState<Record<number, string>>({});

  const allUsers = useQuery({ queryKey: ['all-users'], queryFn: fetchAllUsers });
  const pendingUsers = useQuery({ queryKey: ['admin-users-pending'], queryFn: fetchPendingUsers, enabled: isAdmin });

  const approveMut = useMutation({
    mutationFn: ({ userId, role }: { userId: number; role: string }) => approveUser(userId, role),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['all-users'] });
      queryClient.invalidateQueries({ queryKey: ['admin-users-pending'] });
    },
  });

  const denyMut = useMutation({
    mutationFn: (userId: number) => denyUser(userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['all-users'] });
      queryClient.invalidateQueries({ queryKey: ['admin-users-pending'] });
    },
  });

  const roleMut = useMutation({
    mutationFn: ({ userId, role }: { userId: number; role: string }) => updateUserRole(userId, role),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['all-users'] }),
  });

  const disableMut = useMutation({
    mutationFn: (userId: number) => disableUser(userId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['all-users'] }),
  });

  const reactivateMut = useMutation({
    mutationFn: (userId: number) => reactivateUser(userId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['all-users'] }),
  });

  const roleOrder: Record<string, number> = { ADMIN: 0, USER: 1, GUEST: 2 };
  const users = (activeTab === 'pending' ? (pendingUsers.data ?? []) : (allUsers.data ?? []))
    .slice()
    .sort((a, b) => (roleOrder[a.role] ?? 9) - (roleOrder[b.role] ?? 9));
  const memberUsers = users.filter((u) => u.role !== 'GUEST');
  const guestUsers = users.filter((u) => u.role === 'GUEST');
  const isLoading = activeTab === 'pending' ? pendingUsers.isLoading : allUsers.isLoading;
  const pendingCount = pendingUsers.data?.length ?? 0;
  const onlineCount = (allUsers.data ?? []).filter((u) => u.isOnline).length;

  return (
    <div className="space-y-6 sm:space-y-7">
      {/* Header */}
      <section className="rounded-[30px] border border-appborder bg-appsurface-raised p-6 shadow-[0_12px_34px_var(--appshadow)] sm:p-7">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-apptext-muted">
              {isAdmin ? 'Admin' : 'Household'}
            </p>
            <h2 className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-apptext sm:text-3xl">
              {isAdmin ? 'User Management' : 'Household Members'}
            </h2>
            <p className="mt-3 text-sm leading-6 text-apptext-soft sm:text-base">
              {isAdmin
                ? 'Approve registrations, manage roles, and control access to the home dashboard.'
                : 'See who lives here and who\'s currently around.'}
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-appborder bg-appinset p-4">
              <p className="text-[11px] uppercase tracking-[0.16em] text-apptext-dim">Members</p>
              <p className="mt-2 text-lg font-semibold text-apptext">{allUsers.data?.length ?? '...'}</p>
            </div>
            <div className="rounded-2xl border border-emerald-300/30 bg-emerald-300/10 p-4">
              <p className="text-[11px] uppercase tracking-[0.16em] text-emerald-100/70">Online</p>
              <p className="mt-2 text-lg font-semibold text-emerald-200">{onlineCount}</p>
            </div>
            {isAdmin && (
              <div className={`rounded-2xl border p-4 ${pendingCount > 0 ? 'border-amber-300/30 bg-amber-300/10' : 'border-appborder bg-appinset'}`}>
                <p className="text-[11px] uppercase tracking-[0.16em] text-apptext-dim">Pending</p>
                <p className={`mt-2 text-lg font-semibold ${pendingCount > 0 ? 'text-appwarning' : 'text-apptext'}`}>
                  {pendingCount}
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Tabs — admin only sees Pending tab */}
        {isAdmin && (
          <div className="mt-5 flex gap-2">
            {([
              ['all', 'All Users'],
              ['pending', `Pending (${pendingCount})`],
            ] as const).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setActiveTab(key)}
                className={`rounded-full border px-4 py-2 text-sm font-medium transition-all ${
                  activeTab === key
                    ? 'border-appaccent-border bg-appaccent-soft text-appaccent-text'
                    : 'border-appborder bg-appinset text-apptext-muted hover:border-appborder-hover'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </section>

      {/* User list */}
      <section className="rounded-[28px] border border-appborder bg-appsurface-raised p-5 shadow-[0_10px_28px_var(--appshadow)]">
        {isLoading ? (
          <div className="space-y-3 animate-pulse">
            {[1, 2, 3].map((i) => <div key={i} className="h-16 rounded-2xl bg-appinset" />)}
          </div>
        ) : users.length === 0 ? (
          <div className="flex h-40 items-center justify-center text-sm text-apptext-muted">
            {activeTab === 'pending' ? 'No pending approvals.' : 'No users found.'}
          </div>
        ) : (
          <div className="space-y-5">
            {activeTab === 'all' ? (
              <>
                <div>
                  <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-apptext-muted">
                    Household Members
                  </p>
                  <div className="space-y-3">
                    {memberUsers.map((u) => (
                      <UserCard
                        key={u.id}
                        user={u}
                        selectedRole={selectedRole[u.id] ?? u.role}
                        onRoleChange={(role) => setSelectedRole((prev) => ({ ...prev, [u.id]: role }))}
                        onApprove={(userId, role) => approveMut.mutate({ userId, role })}
                        onDeny={(userId) => denyMut.mutate(userId)}
                        onRoleUpdate={(userId, role) => roleMut.mutate({ userId, role })}
                        onDisable={(userId) => disableMut.mutate(userId)}
                        onReactivate={(userId) => reactivateMut.mutate(userId)}
                        isPending={u.status === 'PENDING_APPROVAL'}
                        isAdmin={isAdmin}
                      />
                    ))}
                  </div>
                </div>

                {guestUsers.length > 0 && (
                  <div>
                    <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-apptext-muted">
                      Guests
                    </p>
                    <div className="space-y-3">
                      {guestUsers.map((u) => (
                        <UserCard
                          key={u.id}
                          user={u}
                          selectedRole={selectedRole[u.id] ?? u.role}
                          onRoleChange={(role) => setSelectedRole((prev) => ({ ...prev, [u.id]: role }))}
                          onApprove={(userId, role) => approveMut.mutate({ userId, role })}
                          onDeny={(userId) => denyMut.mutate(userId)}
                          onRoleUpdate={(userId, role) => roleMut.mutate({ userId, role })}
                          onDisable={(userId) => disableMut.mutate(userId)}
                          onReactivate={(userId) => reactivateMut.mutate(userId)}
                          isPending={u.status === 'PENDING_APPROVAL'}
                          isAdmin={isAdmin}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div>
                <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.2em] text-apptext-muted">
                  Pending Approvals
                </p>
                <div className="space-y-3">
                  {users.map((u) => (
                    <UserCard
                      key={u.id}
                      user={u}
                      selectedRole={selectedRole[u.id] ?? u.role}
                      onRoleChange={(role) => setSelectedRole((prev) => ({ ...prev, [u.id]: role }))}
                      onApprove={(userId, role) => approveMut.mutate({ userId, role })}
                      onDeny={(userId) => denyMut.mutate(userId)}
                      onRoleUpdate={(userId, role) => roleMut.mutate({ userId, role })}
                      onDisable={(userId) => disableMut.mutate(userId)}
                      onReactivate={(userId) => reactivateMut.mutate(userId)}
                      isPending={u.status === 'PENDING_APPROVAL'}
                      isAdmin={isAdmin}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function UserCard({
  user,
  selectedRole,
  onRoleChange,
  onApprove,
  onDeny,
  onRoleUpdate,
  onDisable,
  onReactivate,
  isPending,
  isAdmin,
}: {
  user: AdminUser;
  selectedRole: string;
  onRoleChange: (role: string) => void;
  onApprove: (userId: number, role: string) => void;
  onDeny: (userId: number) => void;
  onRoleUpdate: (userId: number, role: string) => void;
  onDisable: (userId: number) => void;
  onReactivate: (userId: number) => void;
  isPending: boolean;
  isAdmin: boolean;
}) {
  const displayName = user.displayName || user.username;
  const roleKey = user.role.toUpperCase();

  return (
    <article className="overflow-hidden rounded-2xl border border-appborder bg-appinset shadow-[0_6px_18px_var(--appshadow)]">
      <div className="flex items-stretch">
        <div className={`flex w-14 shrink-0 items-center justify-center text-xl ${roleRailStyles[roleKey] ?? 'bg-appinset-strong text-apptext-soft'}`}>
          {roleKey === 'ADMIN' ? '🛡️' : roleKey === 'GUEST' ? '👥' : '🏠'}
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-3 p-3 sm:p-4">
          <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <div className="relative shrink-0">
                <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-full border-2 text-sm font-semibold text-white" style={{ borderColor: user.accentColor || roleAccent(user.role) }}>
                  {user.avatarUrl ? (
                    <img src={user.avatarUrl} alt={displayName} className="h-full w-full object-cover" />
                  ) : (
                    <span style={{ background: `linear-gradient(135deg, ${user.accentColor || roleAccent(user.role)}CC, ${user.accentColor || roleAccent(user.role)}44)` }} className="flex h-full w-full items-center justify-center text-white">
                      {getInitials(displayName)}
                    </span>
                  )}
                </div>
                {user.isOnline && <OnlineDot className="absolute -top-0.5 -right-0.5" />}
              </div>

              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-semibold text-apptext sm:text-base">{displayName}</p>
                  {user.isOnline && (
                    <span className="hidden rounded-full border border-emerald-300/30 bg-emerald-300/10 px-2 py-0 text-[9px] font-semibold uppercase tracking-[0.12em] text-emerald-300 sm:inline-flex">
                      Online
                    </span>
                  )}
                </div>
                <p className="truncate text-xs text-apptext-muted">{user.email}</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 lg:justify-end">
              <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] ${roleBadgeColors[user.role] ?? 'border-appborder bg-appinset text-apptext-muted'}`}>
                {user.role === 'USER' ? 'Household Member' : user.role}
              </span>
              <span className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] ${statusBadgeColors[user.status] ?? 'border-appborder bg-appinset text-apptext-muted'}`}>
                {user.status.replace('_', ' ')}
              </span>
            </div>
          </div>

          {isAdmin && (
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-apptext-dim">
              <span className="rounded-full border border-appborder px-2 py-0.5">
                Last login: {timeAgo(user.lastLoginAt)}
              </span>
              <span className="rounded-full border border-appborder px-2 py-0.5">
                Logins: {user.loginCount}
              </span>
            </div>
          )}

          {/* Admin actions — hidden for non-admins */}
          {isAdmin && (
            <div className="flex flex-wrap items-center gap-1.5">
              {isPending ? (
                <>
                  <select
                    value={selectedRole}
                    onChange={(e) => onRoleChange(e.target.value)}
                    className="rounded-full border border-appborder bg-appsurface px-3 py-1.5 text-[11px] font-medium text-apptext-soft focus:border-appaccent focus:outline-none"
                  >
                    <option value="USER">User</option>
                    <option value="ADMIN">Admin</option>
                  </select>
                  <button type="button" onClick={() => onApprove(user.id, selectedRole)} className="rounded-full border border-appsuccess/30 bg-appsuccess/10 px-3 py-1.5 text-[11px] font-semibold text-appsuccess transition-colors hover:bg-appsuccess/20">
                    Approve
                  </button>
                  <button type="button" onClick={() => onDeny(user.id)} className="rounded-full border border-appdanger/30 bg-appdanger/10 px-3 py-1.5 text-[11px] font-semibold text-appdanger transition-colors hover:bg-appdanger/20">
                    Deny
                  </button>
                </>
              ) : (
                <>
                  <select
                    value={selectedRole}
                    onChange={(e) => { onRoleChange(e.target.value); onRoleUpdate(user.id, e.target.value); }}
                    className="rounded-full border border-appborder bg-appsurface px-3 py-1.5 text-[11px] font-medium text-apptext-soft focus:border-appaccent focus:outline-none"
                  >
                    <option value="ADMIN">Admin</option>
                    <option value="USER">User</option>
                    <option value="GUEST">Guest</option>
                  </select>
                  {user.status === 'ACTIVE' ? (
                    <button type="button" onClick={() => onDisable(user.id)} className="rounded-full border border-appdanger/30 bg-appdanger/10 px-3 py-1.5 text-[11px] font-semibold text-appdanger transition-colors hover:bg-appdanger/20">
                      Disable
                    </button>
                  ) : (
                    <button type="button" onClick={() => onReactivate(user.id)} className="rounded-full border border-appsuccess/30 bg-appsuccess/10 px-3 py-1.5 text-[11px] font-semibold text-appsuccess transition-colors hover:bg-appsuccess/20">
                      Reactivate
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}
