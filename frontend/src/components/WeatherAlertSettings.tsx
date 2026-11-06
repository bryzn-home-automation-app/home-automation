import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../context/AuthContext';
import {
  fetchWeatherAlerts,
  previewWeatherAlert,
  updateWeatherAlert,
  type WeatherAlert,
  type WeatherAlertChange,
  type WeatherAlertPreview,
} from '../api/weatherAlerts';
import { errorMessage } from '../api/climate';
import { FOCUS_RING } from './ThermostatControls';
import { Switch } from './AlertTypeSettings';

const QUERY_KEY = ['weather-alerts'];

const ICONS: Record<string, string> = {
  WEATHER_RAIN: '🌧️',
  WEATHER_NWS: '🚨',
  WEATHER_STORMS: '⛈️',
  WEATHER_FREEZE: '🥶',
  WEATHER_HEAT: '🥵',
  WEATHER_WIND: '💨',
  WEATHER_WINTER: '🌨️',
};

const FIELD = `rounded-lg border border-appborder bg-appinset px-2 py-1.5 text-sm text-apptext focus:border-appaccent ${FOCUS_RING}`;

/** "20:00" → "8 PM", "20:30" → "8:30 PM", "00:00" → "midnight", "12:00" → "noon". */
export function clockLabel(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  if (m === 0 && h === 0) return 'midnight';
  if (m === 0 && h === 12) return 'noon';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'AM' : 'PM'}`;
}

/** Hours a check at `checkAt` covers through `until`: later that day, else the next (24 when equal). */
export function hoursCovered(checkAt: string, until: string): number {
  const mins = (t: string) => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  };
  const span = (mins(until) - mins(checkAt) + 1440) % 1440 || 1440;
  return Math.round((span / 60) * 10) / 10;
}

/** One sentence on when this alert runs, from its current settings. */
function schedule(a: WeatherAlert): string {
  if (!a.scheduled || !a.checkAt || !a.until) {
    return 'Sent as soon as the National Weather Service issues one for home.';
  }
  const hours = hoursCovered(a.checkAt, a.until);
  return `Checked every day at ${clockLabel(a.checkAt)}, looking ahead to ${clockLabel(a.until)} (${hours} hours).`;
}

/**
 * "Weather alerts" on the Profile page: which weather alerts this member gets, when each is
 * checked and what counts. Each is off until turned on, and turning one on sends it to the
 * phone too. Members only.
 */
export default function WeatherAlertSettings() {
  const { isGuest } = useAuth();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: QUERY_KEY, queryFn: fetchWeatherAlerts, enabled: !isGuest, staleTime: 60_000 });

  const save = useMutation({
    mutationFn: (p: { type: string; change: WeatherAlertChange }) => updateWeatherAlert(p.type, p.change),
    // Show the change at once; roll back if the server says no.
    onMutate: async (p) => {
      await queryClient.cancelQueries({ queryKey: QUERY_KEY });
      const before = queryClient.getQueryData<WeatherAlert[]>(QUERY_KEY);
      queryClient.setQueryData<WeatherAlert[]>(QUERY_KEY, (list) =>
        list?.map((a) => {
          if (a.type !== p.type) return a;
          const next = { ...a, ...p.change };
          return { ...next, push: next.inApp && next.push };
        }),
      );
      return { before };
    },
    onError: (_err, _p, ctx) => {
      if (ctx?.before) queryClient.setQueryData(QUERY_KEY, ctx.before);
    },
    onSuccess: (saved) => {
      queryClient.setQueryData<WeatherAlert[]>(QUERY_KEY, (list) => list?.map((a) => (a.type === saved.type ? saved : a)));
    },
  });

  // Linked as /profile#weather-alerts: bring the card into view once it has its rows.
  const cardRef = useRef<HTMLDivElement | null>(null);
  const loaded = !!query.data;
  useEffect(() => {
    if (loaded && window.location.hash === '#weather-alerts') cardRef.current?.scrollIntoView({ block: 'start' });
  }, [loaded]);

  if (isGuest) return null;
  const list = query.data ?? [];

  return (
    <div
      ref={cardRef}
      id="weather-alerts"
      className="scroll-mt-24 rounded-[28px] border border-appborder bg-appsurface-raised p-5 shadow-[0_10px_28px_var(--appshadow)] sm:p-6"
    >
      <p className="text-2xs font-medium uppercase tracking-[0.18em] text-apptext-muted">Notifications</p>
      <h3 className="mt-2 text-xl font-semibold text-apptext">Weather alerts</h3>
      <p className="mt-1 mb-4 text-xs text-apptext-muted">
        A heads-up about the weather at home. Turn on the ones you want, then choose when each is checked and what
        counts. Only affects you.
      </p>

      {query.isLoading && <div className="h-40 animate-pulse rounded-2xl bg-appinset" />}
      {query.isError && !query.data && (
        <p role="alert" className="text-sm text-apptext-danger">
          {errorMessage(query.error, "Couldn't load your weather alerts")}
        </p>
      )}

      {list.length > 0 && (
        <>
          <div className="mb-1 flex justify-end gap-3 px-3 text-2xs font-medium text-apptext-muted" aria-hidden>
            <span className="w-12 text-center">Alerts</span>
            <span className="w-12 text-center">Phone</span>
          </div>
          <ul className="divide-y divide-appborder rounded-2xl border border-appborder">
            {list.map((a) => (
              <WeatherAlertRow key={a.type} alert={a} onChange={(change) => save.mutate({ type: a.type, change })} />
            ))}
          </ul>
        </>
      )}

      {save.isError && (
        <p role="alert" className="mt-3 text-xs text-apptext-danger">
          {errorMessage(save.error, "Couldn't save. Try again.")}
        </p>
      )}
      <p className="mt-4 text-2xs text-apptext-muted">
        Times are Central. Forecasts from Open-Meteo; warnings from the National Weather Service. Phone alerts also need
        Phone alerts turned on for each device (above).
      </p>
    </div>
  );
}

function WeatherAlertRow({ alert: a, onChange }: { alert: WeatherAlert; onChange: (change: WeatherAlertChange) => void }) {
  // A preview belongs to the settings it was made with; changing them hides it.
  const settings = `${a.checkAt}|${a.until}|${a.threshold}`;
  const [shown, setShown] = useState<{ for: string; preview: WeatherAlertPreview } | null>(null);
  const preview = useMutation({
    mutationFn: () => previewWeatherAlert(a.type),
    onSuccess: (p) => setShown({ for: settings, preview: p }),
  });
  const current = shown?.for === settings ? shown.preview : null;
  const time = (field: 'checkAt' | 'until') => (e: React.ChangeEvent<HTMLInputElement>) => {
    if (/^\d{2}:\d{2}$/.test(e.target.value)) onChange({ [field]: e.target.value });
  };

  return (
    <li className="px-3 py-3">
      <div className="flex items-center gap-3">
        <span aria-hidden className="w-7 shrink-0 text-center text-xl">
          {ICONS[a.type] ?? '🌦️'}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-apptext">{a.label}</p>
          <p className="text-xs text-apptext-muted">{a.description}</p>
        </div>
        <Switch
          on={a.inApp}
          label={`${a.label} alerts`}
          // Turning one on sends it to the phone too: a weather heads-up is for when you're not looking.
          onChange={(on) => onChange({ inApp: on, push: on })}
        />
        <Switch on={a.push} disabled={!a.inApp} label={`${a.label} on phone`} onChange={(on) => onChange({ push: on })} />
      </div>

      {a.inApp && (
        <div className="mt-3 rounded-xl border border-appborder p-3 sm:ml-10">
          <div className="flex flex-wrap items-end gap-3">
            {a.scheduled && a.checkAt && a.until && (
              <>
                <label className="flex flex-col gap-1 text-2xs font-medium text-apptext-muted">
                  Check at
                  <input type="time" step={900} value={a.checkAt} onChange={time('checkAt')} className={FIELD} />
                </label>
                <label className="flex flex-col gap-1 text-2xs font-medium text-apptext-muted">
                  Look ahead to
                  <input type="time" step={900} value={a.until} onChange={time('until')} className={FIELD} />
                </label>
              </>
            )}
            {a.thresholdOptions.length > 0 && a.threshold != null && (
              <label className="flex flex-col gap-1 text-2xs font-medium text-apptext-muted">
                {a.thresholdLabel}
                <select
                  value={a.threshold}
                  onChange={(e) => onChange({ threshold: Number(e.target.value) })}
                  className={FIELD}
                >
                  {a.thresholdOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <button
              type="button"
              onClick={() => preview.mutate()}
              disabled={preview.isPending}
              className={`rounded-lg border border-appborder px-3 py-1.5 text-xs font-medium text-appaccent-text transition-colors hover:bg-appinset disabled:opacity-50 ${FOCUS_RING}`}
            >
              {preview.isPending ? 'Checking…' : 'Check the forecast now'}
            </button>
          </div>
          <p className="mt-2 text-2xs text-apptext-muted">{schedule(a)}</p>

          {preview.isError && (
            <p role="alert" className="mt-2 text-xs text-apptext-danger">
              {errorMessage(preview.error, "Couldn't reach the forecast. Try again in a minute.")}
            </p>
          )}
          {current && (
            <div role="status" className="mt-2 rounded-lg border border-appborder bg-appsurface px-3 py-2 text-xs">
              <p className="text-2xs uppercase tracking-wide text-apptext-muted">
                {current.when}
                {current.hours ? ` · ${current.hours}` : ''}
              </p>
              {current.title ? (
                <>
                  <p className="mt-1 font-semibold text-apptext">You'd get: {current.title}</p>
                  {current.message && <p className="mt-0.5 text-apptext-soft">{current.message}</p>}
                </>
              ) : (
                <p className="mt-1 text-apptext-soft">No alert right now. {current.summary}</p>
              )}
            </div>
          )}
        </div>
      )}
    </li>
  );
}
