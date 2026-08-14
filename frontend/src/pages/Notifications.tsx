import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fetchNotifications,
  markRead,
  markAllRead,
  type Notification,
} from '../api/notifications';
import { jitteredInterval } from '../hooks/useJitteredInterval';

const CATEGORIES = [
  { key: '', label: 'All', icon: '📋' },
  { key: 'ELECTRICAL', label: 'Electric', icon: '⚡' },
  { key: 'GAS', label: 'Gas', icon: '🔥' },
  { key: 'WATER', label: 'Water', icon: '💧' },
  { key: 'ROOMBA', label: 'Roomba', icon: '🤖' },
  { key: 'WIFI', label: 'WiFi', icon: '📶' },
] as const;

const SEVERITIES = [
  { key: '', label: 'All' },
  { key: 'CRITICAL', label: 'Critical' },
  { key: 'WARNING', label: 'Warning' },
  { key: 'INFO', label: 'Info' },
  { key: 'SUCCESS', label: 'Success' },
] as const;

const categoryIcons: Record<string, string> = {
  ELECTRICAL: '⚡', GAS: '🔥', WATER: '💧', ROOMBA: '🤖', WIFI: '📶',
};

const categoryLabels: Record<string, string> = {
  ELECTRICAL: 'Electric', GAS: 'Gas', WATER: 'Water', ROOMBA: 'Roomba', WIFI: 'WiFi',
};

const severityColors: Record<string, string> = {
  CRITICAL: 'border-appdanger-border bg-appdanger-soft text-appdanger',
  WARNING:  'border-appwarning-border bg-appwarning-soft text-appwarning',
  INFO:     'border-appinfo-border bg-appinfo-soft text-appinfo',
  SUCCESS:  'border-appaccent-border bg-appaccent-soft text-appaccent',
};

const severityDots: Record<string, string> = {
  CRITICAL: 'bg-red-400 shadow-[0_0_10px_rgba(248,113,113,0.6)]',
  WARNING:  'bg-amber-400 shadow-[0_0_10px_rgba(251,191,36,0.6)]',
  INFO:     'bg-sky-400 shadow-[0_0_10px_rgba(56,189,248,0.6)]',
  SUCCESS:  'bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.6)]',
};

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const NotificationRow = ({ n }: { n: Notification }) => {
  const queryClient = useQueryClient();
  const readMut = useMutation({
    mutationFn: (id: number) => markRead(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['notifications-unread-count'] });
    },
  });

  return (
    <div
      className={`flex items-start gap-4 rounded-2xl border px-5 py-4 transition-colors cursor-pointer ${
        n.isRead
          ? 'border-appborder-light bg-appinset opacity-60 hover:opacity-90'
          : 'border-appborder bg-appinset-strong hover:border-appborder-hover'
      }`}
      onClick={() => { if (!n.isRead) readMut.mutate(n.id); }}
    >
      {/* Severity dot */}
      <span className={`mt-1.5 inline-flex h-3 w-3 shrink-0 rounded-full ${severityDots[n.severity] ?? 'bg-slate-400'}`} />

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-semibold text-apptext">{n.title}</span>
          <span className={`rounded-full border px-2 py-0 text-[10px] font-semibold uppercase tracking-[0.1em] ${severityColors[n.severity] ?? ''}`}>
            {n.severity}
          </span>
          {!n.isRead && (
            <span className="inline-flex h-2 w-2 rounded-full bg-appaccent" />
          )}
        </div>
        {n.message && (
          <p className="mt-1 text-sm text-apptext-soft leading-5">{n.message}</p>
        )}
        <div className="mt-2 flex items-center gap-3 text-xs text-apptext-dim">
          <span className="inline-flex items-center gap-1">
            {categoryIcons[n.category]} {categoryLabels[n.category]}
          </span>
          <span>{timeAgo(n.createdAt)}</span>
        </div>
      </div>
    </div>
  );
};

export default function NotificationsPage() {
  const queryClient = useQueryClient();
  const [categoryFilter, setCategoryFilter] = useState('');
  const [severityFilter, setSeverityFilter] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [search, setSearch] = useState('');

  const params = useMemo(() => ({
    category: categoryFilter || undefined,
    severity: severityFilter || undefined,
    unread: unreadOnly,
    limit: 100,
  }), [categoryFilter, severityFilter, unreadOnly]);

  const notifications = useQuery({
    queryKey: ['notifications', params],
    queryFn: () => fetchNotifications(params),
    refetchInterval: jitteredInterval(30_000),
    refetchIntervalInBackground: false,
  });

  const markAllMut = useMutation({
    mutationFn: markAllRead,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['notifications-unread-count'] });
    },
  });

  const data = notifications.data ?? [];
  const unread = data.filter((n) => !n.isRead).length;

  // Client-side search filter
  const filtered = useMemo(() => {
    if (!search.trim()) return data;
    const q = search.toLowerCase();
    return data.filter((n) =>
      n.title.toLowerCase().includes(q) ||
      (n.message && n.message.toLowerCase().includes(q))
    );
  }, [data, search]);

  return (
    <div className="space-y-6 sm:space-y-7">
      {/* Header */}
      <section className="rounded-[30px] border border-appborder bg-appsurface-raised p-6 shadow-[0_12px_34px_var(--appshadow)] sm:p-7">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-2xl">
            <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-apptext-muted">
              Notifications
            </p>
            <h2 className="mt-3 text-2xl font-semibold tracking-[-0.04em] text-apptext sm:text-3xl">
              Notification Center
            </h2>
            <p className="mt-3 text-sm leading-6 text-apptext-soft sm:text-base">
              Stay informed about your home&rsquo;s activity across all integrations. Filter by category, severity, or search through past notifications.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <div className="rounded-2xl border border-appborder bg-appinset p-4">
              <p className="text-[11px] uppercase tracking-[0.16em] text-apptext-dim">Unread</p>
              <p className="mt-2 text-lg font-semibold text-apptext">{unread}</p>
            </div>
            <button
              type="button"
              onClick={() => markAllMut.mutate()}
              disabled={markAllMut.isPending || unread === 0}
              className="rounded-2xl border border-appaccent-border bg-appaccent-soft px-4 py-3 text-sm font-semibold text-appaccent-text transition-all hover:bg-appaccent-soft/80 disabled:opacity-40"
            >
              Mark all read
            </button>
          </div>
        </div>
      </section>

      {/* Filters */}
      <section className="rounded-[28px] border border-appborder bg-appsurface-raised p-5 shadow-[0_10px_28px_var(--appshadow)]">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          {/* Category pills */}
          <div className="flex flex-wrap gap-2">
            {CATEGORIES.map((c) => (
              <button
                key={c.key}
                type="button"
                onClick={() => setCategoryFilter(c.key)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-medium transition-all ${
                  categoryFilter === c.key
                    ? 'border-appaccent-border bg-appaccent-soft text-appaccent-text'
                    : 'border-appborder bg-appinset text-apptext-muted hover:border-appborder-hover hover:text-apptext-soft'
                }`}
              >
                <span>{c.icon}</span> {c.label}
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Severity filter */}
            {SEVERITIES.map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => setSeverityFilter(s.key)}
                className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-all ${
                  severityFilter === s.key
                    ? 'border-appaccent-border bg-appaccent-soft text-appaccent-text'
                    : 'border-appborder bg-appinset text-apptext-muted hover:border-appborder-hover'
                }`}
              >
                {s.label}
              </button>
            ))}

            {/* Unread toggle */}
            <button
              type="button"
              onClick={() => setUnreadOnly(!unreadOnly)}
              className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-all ${
                unreadOnly
                  ? 'border-appaccent-border bg-appaccent-soft text-appaccent-text'
                  : 'border-appborder bg-appinset text-apptext-muted hover:border-appborder-hover'
              }`}
            >
              🔵 Unread
            </button>

            {/* Search */}
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search..."
              className="rounded-full border border-appborder bg-appinset px-3 py-1.5 text-xs text-apptext placeholder:text-apptext-dim focus:outline-none focus:border-appaccent"
            />
          </div>
        </div>
      </section>

      {/* Notification list */}
      <section className="rounded-[28px] border border-appborder bg-appsurface-raised p-5 shadow-[0_10px_28px_var(--appshadow)]">
        {notifications.isLoading ? (
          <div className="space-y-3 animate-pulse">
            {[1, 2, 3, 4].map((i) => <div key={i} className="h-20 rounded-2xl bg-appinset" />)}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex h-48 flex-col items-center justify-center gap-3 text-center">
            <span className="text-3xl">🔔</span>
            <p className="text-sm text-apptext-muted">
              {data.length === 0
                ? 'No notifications yet. Activity from your home will appear here.'
                : 'No notifications match your filters.'}
            </p>
          </div>
        ) : (
          <div className="space-y-3 max-h-[40rem] overflow-y-auto pr-1">
            {filtered.map((n) => (
              <NotificationRow key={n.id} n={n} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
