import { useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../context/AuthContext';
import {
  fetchAlertPreferences,
  resetAlertPreferences,
  setAlertPreference,
  type AlertTypePreference,
} from '../api/notifications';
import { errorMessage } from '../api/climate';
import { FOCUS_RING } from './ThermostatControls';

const QUERY_KEY = ['alert-preferences'];

const GROUPS: { category: AlertTypePreference['category']; title: string }[] = [
  { category: 'CAMERA', title: 'Cameras' },
  { category: 'ROOMBA', title: 'Roomba' },
  { category: 'ELECTRICAL', title: 'Electricity' },
];

function Switch({
  on,
  disabled,
  label,
  onChange,
}: {
  on: boolean;
  disabled?: boolean;
  label: string;
  onChange: (on: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!on)}
      className={`relative h-7 w-12 shrink-0 rounded-full transition-colors disabled:opacity-40 ${FOCUS_RING} ${
        on ? 'bg-appaccent' : 'bg-appinset ring-1 ring-inset ring-appborder'
      }`}
    >
      <span
        aria-hidden
        className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-[left] ${on ? 'left-6' : 'left-1'}`}
      />
    </button>
  );
}

/**
 * "Alert types" on the Profile page: each kind of alert on or off for this member, and
 * whether it also reaches their phone. Members only — guests get no alerts.
 */
export default function AlertTypeSettings() {
  const { isGuest } = useAuth();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: QUERY_KEY, queryFn: fetchAlertPreferences, enabled: !isGuest, staleTime: 60_000 });

  const save = useMutation({
    mutationFn: (p: { type: string; inApp: boolean; push: boolean }) => setAlertPreference(p.type, p.inApp, p.push),
    // Flip the switch at once; roll back if the server says no.
    onMutate: async (p) => {
      await queryClient.cancelQueries({ queryKey: QUERY_KEY });
      const before = queryClient.getQueryData<AlertTypePreference[]>(QUERY_KEY);
      queryClient.setQueryData<AlertTypePreference[]>(QUERY_KEY, (list) =>
        list?.map((r) => (r.type === p.type ? { ...r, inApp: p.inApp, push: p.inApp && p.push } : r)),
      );
      return { before };
    },
    onError: (_err, _p, ctx) => {
      if (ctx?.before) queryClient.setQueryData(QUERY_KEY, ctx.before);
    },
    onSuccess: (saved) => {
      queryClient.setQueryData<AlertTypePreference[]>(QUERY_KEY, (list) => list?.map((r) => (r.type === saved.type ? saved : r)));
    },
  });

  const reset = useMutation({
    mutationFn: resetAlertPreferences,
    onSuccess: (list) => queryClient.setQueryData(QUERY_KEY, list),
  });

  // Opened from the Alerts page's "Alert settings" link: bring the card into view once it has its rows.
  const cardRef = useRef<HTMLDivElement | null>(null);
  const loaded = !!query.data;
  useEffect(() => {
    if (loaded && window.location.hash === '#alert-types') cardRef.current?.scrollIntoView({ block: 'start' });
  }, [loaded]);

  if (isGuest) return null;

  const list = query.data ?? [];
  const changed = list.some((r) => r.inApp !== r.defaultInApp || r.push !== (r.defaultInApp && r.defaultPush));

  return (
    <div
      ref={cardRef}
      id="alert-types"
      className="scroll-mt-24 rounded-[28px] border border-appborder bg-appsurface-raised p-5 shadow-[0_10px_28px_var(--appshadow)] sm:p-6"
    >
      <p className="text-2xs font-medium uppercase tracking-[0.18em] text-apptext-muted">Notifications</p>
      <div className="mt-2 flex items-start justify-between gap-3">
        <h3 className="text-xl font-semibold text-apptext">Alert types</h3>
        {changed && (
          <button
            type="button"
            onClick={() => reset.mutate()}
            disabled={reset.isPending}
            className={`rounded-lg px-2 py-1 text-xs font-medium text-appaccent-text transition-colors hover:bg-appinset disabled:opacity-50 ${FOCUS_RING}`}
          >
            {reset.isPending ? 'Resetting…' : 'Reset to defaults'}
          </button>
        )}
      </div>
      <p className="mt-1 mb-4 text-xs text-apptext-muted">
        Choose what shows up in your Alerts, and what also reaches your phone. Only affects you.
      </p>

      {query.isLoading && <div className="h-40 animate-pulse rounded-2xl bg-appinset" />}
      {query.isError && !query.data && (
        <p role="alert" className="text-sm text-apptext-danger">
          {errorMessage(query.error, "Couldn't load your alert settings")}
        </p>
      )}

      {list.length > 0 && (
        <div className="flex flex-col gap-5">
          {GROUPS.map((g) => {
            const rows = list.filter((r) => r.category === g.category);
            if (!rows.length) return null;
            return (
              <section key={g.category} aria-label={g.title}>
                <div className="mb-1 flex items-end justify-between gap-3 px-1">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-apptext-muted">{g.title}</h4>
                  <div className="flex gap-3 text-2xs font-medium text-apptext-muted" aria-hidden>
                    <span className="w-12 text-center">Alerts</span>
                    <span className="w-12 text-center">Phone</span>
                  </div>
                </div>
                <ul className="divide-y divide-appborder rounded-2xl border border-appborder">
                  {rows.map((r) => (
                    <li key={r.type} className="flex items-center gap-3 px-3 py-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-apptext">{r.label}</p>
                        <p className="text-xs text-apptext-muted">{r.description}</p>
                      </div>
                      <Switch
                        on={r.inApp}
                        label={`${r.label} alerts`}
                        onChange={(on) => save.mutate({ type: r.type, inApp: on, push: on ? r.push : false })}
                      />
                      <Switch
                        on={r.push}
                        disabled={!r.inApp}
                        label={`${r.label} on phone`}
                        onChange={(on) => save.mutate({ type: r.type, inApp: r.inApp, push: on })}
                      />
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}

      {(save.isError || reset.isError) && (
        <p role="alert" className="mt-3 text-xs text-apptext-danger">
          {errorMessage(save.error ?? reset.error, "Couldn't save — try again")}
        </p>
      )}
      <p className="mt-4 text-2xs text-apptext-muted">
        Phone alerts also need Phone alerts turned on for each device (above).
      </p>
    </div>
  );
}
