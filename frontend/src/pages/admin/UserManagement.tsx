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
  EXPIRED: 'border-slate-300/30 bg-slate-300/10 text-slate-300',
};

export default function UserManagement() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<'all' | 'pending'>('all');
  const [selectedRole, setSelectedRole] = useState<Record<number, string>>({});

  const allUsers = useQuery({ queryKey: ['admin-users'], queryFn: fetchAllUsers });
  const pendingUsers = useQuery({ queryKey: ['admin-users-pending'], queryFn: fetchPendingUsers });

  const approveMut = useMutation({
    mutationFn: ({ userId, role }: { userId: number; role: string }) => approveUser(userId, role),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      queryClient.invalidateQueries({ queryKey: ['admin-users-pending'] });
    },
  });

  const denyMut = useMutation({
    mutationFn: (userId: number) => denyUser(userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-users'] });
      queryClient.invalidateQueries({ queryKey: ['admin-users-pending'] });
    },
  });

  const roleMut = useMutation({
    mutationFn: ({ userId, role }: { userId: number; role: string }) => updateUserRole(userId, role),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-users'] }),
  });

  const disableMut = useMutation({
    mutationFn: (userId: number) => disableUser(userId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-users'] }),
  });

  const reactivateMut = useMutation({
    mutationFn: (userId: number) => reactivateUser(userId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin-users'] }),
  });

  const users = activeTab === 'pending' ? (pendingUsers.data ?? []) : (allUsers.data ?? []);
  const isLoading = activeTab === 'pending' ? pendingUsers.isLoading : allUsers.isLoading;
  const pendingCount = pendingUsers.data?.length ?? 0;

  return (
    <div className="space-y-6 sm:space-y-7">
      {/* Header */}
      <section className="rounded-[30px] border border-appborder bg-appsurface-raised p-6 shadow-[0_12px_34px_var(--appshadow)] sm:p-7">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-apptext-muted">
              Admin
            </p>
            <h2 className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-apptext sm:text-3xl">
              User Management
            </h2>
            <p className="mt-3 text-sm leading-6 text-apptext-soft sm:text-base">
              Approve registrations, manage roles, and control access to the home dashboard.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-appborder bg-appinset p-4">
              <p className="text-[11px] uppercase tracking-[0.16em] text-apptext-dim">Total Users</p>
              <p className="mt-2 text-lg font-semibold text-apptext">{allUsers.data?.length ?? '...'}</p>
            </div>
            <div className={`rounded-2xl border p-4 ${pendingCount > 0 ? 'border-amber-300/30 bg-amber-300/10' : 'border-appborder bg-appinset'}`}>
              <p className="text-[11px] uppercase tracking-[0.16em] text-apptext-dim">Pending</p>
              <p className={`mt-2 text-lg font-semibold ${pendingCount > 0 ? 'text-appwarning' : 'text-apptext'}`}>
                {pendingCount}
              </p>
            </div>
          </div>
        </div>

        {/* Tabs */}
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
      </section>

      {/* User list */}
      <section className="rounded-[28px] border border-appborder bg-appsurface-raised p-5 shadow-[0_10px_28px_var(--appshadow)]">
        {isLoading ? (
          <div className="space-y-2 animate-pulse">
            {[1, 2, 3].map((i) => <div key={i} className="h-16 rounded-2xl bg-appinset" />)}
          </div>
        ) : users.length === 0 ? (
          <div className="flex h-40 items-center justify-center text-sm text-apptext-muted">
            {activeTab === 'pending' ? 'No pending approvals.' : 'No users found.'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-[56rem] text-sm">
              <div className="grid grid-cols-[1.2fr_1fr_0.7fr_0.7fr_0.7fr_0.8fr_1.2fr] border-b border-appborder pb-2 text-left text-apptext-dim">
                <div className="font-medium">User</div>
                <div className="font-medium">Email</div>
                <div className="font-medium">Role</div>
                <div className="font-medium">Status</div>
                <div className="text-right font-medium">Last Login</div>
                <div className="text-right font-medium">Logins</div>
                <div className="text-right font-medium">Actions</div>
              </div>

              <div className="max-h-[32rem] overflow-y-auto">
                {users.map((u) => (
                  <UserRow
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
                  />
                ))}
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function UserRow({
  user,
  selectedRole,
  onRoleChange,
  onApprove,
  onDeny,
  onRoleUpdate,
  onDisable,
  onReactivate,
  isPending,
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
}) {
  return (
    <div className="grid grid-cols-[1.2fr_1fr_0.7fr_0.7fr_0.7fr_0.8fr_1.2fr] items-center border-b border-appborder-light py-3 transition-colors hover:bg-appinset">
      <div className="flex items-center gap-3">
        {user.online && <span className="inline-flex h-2 w-2 rounded-full bg-appsuccess shadow-[0_0_10px_var(--appsuccess)]" />}
        <span className="font-medium text-apptext">{user.displayName || user.username}</span>
      </div>
      <div className="text-apptext-soft truncate">{user.email}</div>
      <div>
        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] ${roleBadgeColors[user.role] ?? 'border-white/10 bg-white/5 text-slate-300'}`}>
          {user.role}
        </span>
      </div>
      <div>
        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] ${statusBadgeColors[user.status] ?? 'border-white/10 bg-white/5 text-slate-300'}`}>
          {user.status.replace('_', ' ')}
        </span>
      </div>
      <div className="text-right text-apptext-muted">{timeAgo(user.lastLoginAt)}</div>
      <div className="text-right tabular-nums text-apptext-soft">{user.loginCount}</div>
      <div className="flex items-center justify-end gap-1.5">
        {isPending ? (
          <>
            <select
              value={selectedRole}
              onChange={(e) => onRoleChange(e.target.value)}
              className="rounded-full border border-appborder bg-appinset px-2 py-1 text-[11px] font-medium text-apptext-soft focus:outline-none focus:border-appaccent"
            >
              <option value="USER">User</option>
              <option value="ADMIN">Admin</option>
            </select>
            <button
              type="button"
              onClick={() => onApprove(user.id, selectedRole)}
              className="rounded-full border border-appsuccess/30 bg-appsuccess/10 px-3 py-1 text-[11px] font-semibold text-appsuccess transition-colors hover:bg-appsuccess/20"
            >
              Approve
            </button>
            <button
              type="button"
              onClick={() => onDeny(user.id)}
              className="rounded-full border border-appdanger/30 bg-appdanger/10 px-3 py-1 text-[11px] font-semibold text-appdanger transition-colors hover:bg-appdanger/20"
            >
              Deny
            </button>
          </>
        ) : (
          <>
            <select
              value={selectedRole}
              onChange={(e) => { onRoleChange(e.target.value); onRoleUpdate(user.id, e.target.value); }}
              className="rounded-full border border-appborder bg-appinset px-2 py-1 text-[11px] font-medium text-apptext-soft focus:outline-none focus:border-appaccent"
            >
              <option value="ADMIN">Admin</option>
              <option value="USER">User</option>
              <option value="GUEST">Guest</option>
            </select>
            {user.status === 'ACTIVE' ? (
              <button
                type="button"
                onClick={() => onDisable(user.id)}
                className="rounded-full border border-appdanger/30 bg-appdanger/10 px-2 py-1 text-[10px] font-semibold text-appdanger transition-colors hover:bg-appdanger/20"
              >
                Disable
              </button>
            ) : (
              <button
                type="button"
                onClick={() => onReactivate(user.id)}
                className="rounded-full border border-appsuccess/30 bg-appsuccess/10 px-2 py-1 text-[10px] font-semibold text-appsuccess transition-colors hover:bg-appsuccess/20"
              >
                Reactivate
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
