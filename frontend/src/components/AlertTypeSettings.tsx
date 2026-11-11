import { useEffect, useRef, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../context/AuthContext';
import {
  fetchAlertPreferences,
  resetAlertPreferences,
  setAlertPreference,
  type AlertTypePreference,
} from '../api/notifications';
import { errorMessage } from '../api/climate';
import { Button, Icon, Notice, Panel, QueryState, SkelRows, Stack, Switch, type IconName } from './ui';

export const ALERT_PREFS_KEY = ['alert-preferences'];

const GROUPS: { category: AlertTypePreference['category']; title: string; icon: IconName }[] = [
  { category: 'CAMERA', title: 'Cameras', icon: 'camera' },
  { category: 'ROOMBA', title: 'Roomba', icon: 'robot' },
  { category: 'ELECTRICAL', title: 'Electricity', icon: 'bolt' },
];

/** Alert types this card covers (weather has its own card). */
export function isTypeCardAlert(r: AlertTypePreference): boolean {
  return GROUPS.some((g) => g.category === r.category);
}

/**
 * One alert's two switches, each with its caption under it ("Alerts", "Phone"), so a switch
 * is never told apart by position alone (B-157: a caption row above the list sat 9px off
 * its switches). The kit switch's off track is drawn to 3:1 in both themes, and a disabled
 * Phone switch stays visible (B-027).
 */
export function AlertSwitches({
  name,
  inApp,
  push,
  onInApp,
  onPush,
}: {
  /** The alert's name, for the switches' spoken names ("Rain alerts", "Rain on phone"). */
  name: string;
  inApp: boolean;
  push: boolean;
  onInApp: (on: boolean) => void;
  onPush: (on: boolean) => void;
}) {
  return (
    <div className="flex shrink-0 gap-2">
      <SwitchCell caption="Alerts" icon="bell">
        <Switch bare checked={inApp} label={`${name} alerts`} onChange={onInApp} />
      </SwitchCell>
      <SwitchCell caption="Phone" icon="phone">
        {/* Off while the alert itself is off: dimmed, never invisible. */}
        <Switch bare checked={push} disabled={!inApp} label={`${name} on phone`} onChange={onPush} className="disabled:cursor-not-allowed disabled:opacity-60" />
      </SwitchCell>
    </div>
  );
}

function SwitchCell({ caption, icon, children }: { caption: string; icon: IconName; children: ReactNode }) {
  return (
    <div className="flex w-14 flex-col items-center gap-1">
      {children}
      {/* The switch carries its own spoken name; this is the visible one. */}
      <span className="fp-small fp-muted inline-flex items-center gap-1 text-xs" aria-hidden="true">
        <Icon name={icon} className="fp-icon--s" />
        {caption}
      </span>
    </div>
  );
}

/** A setting row: name and one line of description on the left, controls on the right. */
export function SettingRow({ icon, title, description, controls, children }: { icon?: IconName; title: ReactNode; description?: ReactNode; controls: ReactNode; children?: ReactNode }) {
  return (
    <li className="py-3">
      <div className="flex items-center gap-3">
        {icon && <Icon name={icon} className="fp-icon--m shrink-0 text-apptext-muted" />}
        <div className="min-w-0 flex-1">
          <p className="font-medium text-apptext">{title}</p>
          {description && <p className="fp-small fp-muted">{description}</p>}
        </div>
        {controls}
      </div>
      {children}
    </li>
  );
}

/**
 * "Alert types" on the Profile page: each kind of alert on or off for this member, and
 * whether it also reaches their phone. Members only — guests get no alerts.
 */
export default function AlertTypeSettings() {
  const { isGuest } = useAuth();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ALERT_PREFS_KEY, queryFn: fetchAlertPreferences, enabled: !isGuest, staleTime: 60_000 });

  const save = useMutation({
    mutationFn: (p: { type: string; inApp: boolean; push: boolean }) => setAlertPreference(p.type, p.inApp, p.push),
    // Flip the switch at once; roll back if the server says no.
    onMutate: async (p) => {
      await queryClient.cancelQueries({ queryKey: ALERT_PREFS_KEY });
      const before = queryClient.getQueryData<AlertTypePreference[]>(ALERT_PREFS_KEY);
      queryClient.setQueryData<AlertTypePreference[]>(ALERT_PREFS_KEY, (list) =>
        list?.map((r) => (r.type === p.type ? { ...r, inApp: p.inApp, push: p.inApp && p.push } : r)),
      );
      return { before };
    },
    onError: (_err, _p, ctx) => {
      if (ctx?.before) queryClient.setQueryData(ALERT_PREFS_KEY, ctx.before);
    },
    onSuccess: (saved) => {
      queryClient.setQueryData<AlertTypePreference[]>(ALERT_PREFS_KEY, (list) => list?.map((r) => (r.type === saved.type ? saved : r)));
    },
  });

  const reset = useMutation({
    mutationFn: resetAlertPreferences,
    onSuccess: (list) => queryClient.setQueryData(ALERT_PREFS_KEY, list),
  });

  // Opened from the Alerts page's settings link: bring the card into view once it has its rows.
  const cardRef = useRef<HTMLDivElement | null>(null);
  const loaded = !!query.data;
  useEffect(() => {
    if (loaded && window.location.hash === '#alert-types') cardRef.current?.scrollIntoView({ block: 'start' });
  }, [loaded]);

  if (isGuest) return null;

  // Weather alerts have their own card (WeatherAlertSettings) and aren't part of this reset.
  const list = (query.data ?? []).filter(isTypeCardAlert);
  const changed = list.some((r) => r.inApp !== r.defaultInApp || r.push !== (r.defaultInApp && r.defaultPush));

  return (
    <div ref={cardRef} id="alert-types" className="scroll-mt-24">
      <Panel
        title="Alert types"
        subtitle="What shows up in your Alerts, and what also reaches your phone. Only affects you."
        action={
          changed ? (
            <Button size="sm" variant="quiet" icon="refresh" onClick={() => reset.mutate()} busy={reset.isPending} busyLabel="Resetting…">
              Reset to defaults
            </Button>
          ) : undefined
        }
        footer={<span className="fp-small fp-muted">Phone alerts also need Phone alerts turned on for each device.</span>}
      >
        <QueryState
          query={query}
          what="your alert settings"
          loading={<SkelRows count={4} />}
          isEmpty={(d) => !d.some(isTypeCardAlert)}
        >
          {() => (
            <Stack gap="l">
              {GROUPS.map((g) => {
                const rows = list.filter((r) => r.category === g.category);
                if (!rows.length) return null;
                return (
                  <section key={g.category} aria-label={g.title}>
                    <h3 className="fp-label inline-flex items-center gap-2">
                      <Icon name={g.icon} className="fp-icon--s" />
                      {g.title}
                    </h3>
                    <ul className="fp-list">
                      {rows.map((r) => (
                        <SettingRow
                          key={r.type}
                          title={r.label}
                          description={r.description}
                          controls={
                            <AlertSwitches
                              name={r.label}
                              inApp={r.inApp}
                              push={r.push}
                              onInApp={(on) => save.mutate({ type: r.type, inApp: on, push: on ? r.push : false })}
                              onPush={(on) => save.mutate({ type: r.type, inApp: r.inApp, push: on })}
                            />
                          }
                        />
                      ))}
                    </ul>
                  </section>
                );
              })}
            </Stack>
          )}
        </QueryState>
        {(save.isError || reset.isError) && (
          <Notice tone="problem" live="assertive" className="mt-3">
            {errorMessage(save.error ?? reset.error, "Couldn't save. Try again.")}
          </Notice>
        )}
      </Panel>
    </div>
  );
}
