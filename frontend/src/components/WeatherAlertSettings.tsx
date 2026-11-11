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
import { formatDuration } from '../utils/format';
import { AlertSwitches, SettingRow } from './AlertTypeSettings';
import { Button, Field, Input, Notice, Panel, QueryState, Select, SkelRows, Stack, type IconName } from './ui';

export const WEATHER_ALERTS_KEY = ['weather-alerts'];

const ICONS: Record<string, IconName> = {
  WEATHER_RAIN: 'rain',
  WEATHER_NWS: 'alert-triangle',
  WEATHER_STORMS: 'storm',
  WEATHER_FREEZE: 'snowflake',
  WEATHER_HEAT: 'thermometer',
  WEATHER_WIND: 'wind',
  WEATHER_WINTER: 'cloud',
};

/** "20:00" → "8 PM", "20:30" → "8:30 PM", "00:00" → "midnight", "12:00" → "noon". */
export function clockLabel(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  if (m === 0 && h === 0) return 'midnight';
  if (m === 0 && h === 12) return 'noon';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'AM' : 'PM'}`;
}

function minutesCovered(checkAt: string, until: string): number {
  const mins = (t: string) => {
    const [h, m] = t.split(':').map(Number);
    return h * 60 + m;
  };
  return (mins(until) - mins(checkAt) + 1440) % 1440 || 1440;
}

/** Hours a check at `checkAt` covers through `until`: later that day, else the next (24 when equal). */
export function hoursCovered(checkAt: string, until: string): number {
  return Math.round((minutesCovered(checkAt, until) / 60) * 10) / 10;
}

/**
 * The window a check covers, in the app's one duration style: "45 min", "1 hr", "1 hr 30 min",
 * "12 hr" (B-163: it read "(1 hours)" and "0.3 hours" from the rounded hour count).
 */
export function spanLabel(checkAt: string, until: string): string {
  return formatDuration(minutesCovered(checkAt, until));
}

/** One sentence on when this alert runs, from its current settings. */
export function schedule(a: Pick<WeatherAlert, 'scheduled' | 'checkAt' | 'until'>): string {
  if (!a.scheduled || !a.checkAt || !a.until) {
    return 'Sent as soon as the National Weather Service issues one for home.';
  }
  return `Checked every day at ${clockLabel(a.checkAt)}, looking ahead to ${clockLabel(a.until)} (${spanLabel(a.checkAt, a.until)}).`;
}

/**
 * "Weather alerts" on the Profile page: which weather alerts this member gets, when each is
 * checked and what counts. Each is off until turned on, and turning one on sends it to the
 * phone too. Members only.
 */
export default function WeatherAlertSettings() {
  const { isGuest } = useAuth();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: WEATHER_ALERTS_KEY, queryFn: fetchWeatherAlerts, enabled: !isGuest, staleTime: 60_000 });

  const save = useMutation({
    mutationFn: (p: { type: string; change: WeatherAlertChange }) => updateWeatherAlert(p.type, p.change),
    // Show the change at once; roll back if the server says no.
    onMutate: async (p) => {
      await queryClient.cancelQueries({ queryKey: WEATHER_ALERTS_KEY });
      const before = queryClient.getQueryData<WeatherAlert[]>(WEATHER_ALERTS_KEY);
      queryClient.setQueryData<WeatherAlert[]>(WEATHER_ALERTS_KEY, (list) =>
        list?.map((a) => {
          if (a.type !== p.type) return a;
          const next = { ...a, ...p.change };
          return { ...next, push: next.inApp && next.push };
        }),
      );
      return { before };
    },
    onError: (_err, _p, ctx) => {
      if (ctx?.before) queryClient.setQueryData(WEATHER_ALERTS_KEY, ctx.before);
    },
    onSuccess: (saved) => {
      queryClient.setQueryData<WeatherAlert[]>(WEATHER_ALERTS_KEY, (list) => list?.map((a) => (a.type === saved.type ? saved : a)));
    },
  });

  // Linked as /profile#weather-alerts: bring the card into view once it has its rows.
  const cardRef = useRef<HTMLDivElement | null>(null);
  const loaded = !!query.data;
  useEffect(() => {
    if (loaded && window.location.hash === '#weather-alerts') cardRef.current?.scrollIntoView({ block: 'start' });
  }, [loaded]);

  if (isGuest) return null;

  return (
    <div ref={cardRef} id="weather-alerts" className="scroll-mt-24">
      <Panel
        title="Weather alerts"
        subtitle="A heads-up about the weather at home. Turn on the ones you want, then choose when each is checked and what counts. Only affects you."
        footer={
          <span className="fp-small fp-muted">
            Times are Central. Forecasts from Open-Meteo; warnings from the National Weather Service. Phone alerts also need
            Phone alerts turned on for each device.
          </span>
        }
      >
        <QueryState query={query} what="your weather alerts" loading={<SkelRows count={5} />}>
          {(list) => (
            <ul className="fp-list">
              {list.map((a) => (
                <WeatherAlertRow key={a.type} alert={a} onChange={(change) => save.mutate({ type: a.type, change })} />
              ))}
            </ul>
          )}
        </QueryState>
        {save.isError && (
          <Notice tone="problem" live="assertive" className="mt-3">
            {errorMessage(save.error, "Couldn't save. Try again.")}
          </Notice>
        )}
      </Panel>
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
    <SettingRow
      icon={ICONS[a.type] ?? 'cloud-sun'}
      title={a.label}
      description={a.description}
      controls={
        <AlertSwitches
          name={a.label}
          inApp={a.inApp}
          push={a.push}
          // Turning one on sends it to the phone too: a weather heads-up is for when you're not looking.
          onInApp={(on) => onChange({ inApp: on, push: on })}
          onPush={(on) => onChange({ push: on })}
        />
      }
    >
      {a.inApp && (
        <Stack gap="m" className="mt-3 rounded-well border border-appborder p-3 sm:ml-8">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {a.scheduled && a.checkAt && a.until && (
              <>
                <Field label="Check at">
                  <Input type="time" step={900} value={a.checkAt} onChange={time('checkAt')} />
                </Field>
                <Field label="Look ahead to">
                  <Input type="time" step={900} value={a.until} onChange={time('until')} />
                </Field>
              </>
            )}
            {a.thresholdOptions.length > 0 && a.threshold != null && (
              <Field label={a.thresholdLabel ?? "Limit"}>
                <Select
                  value={a.threshold}
                  onChange={(e) => onChange({ threshold: Number(e.target.value) })}
                  options={a.thresholdOptions.map((o) => ({ value: String(o.value), label: o.label }))}
                />
              </Field>
            )}
          </div>
          <p className="fp-small fp-muted">{schedule(a)}</p>
          <div>
            <Button size="sm" variant="quiet" icon="refresh" onClick={() => preview.mutate()} busy={preview.isPending} busyLabel="Checking…">
              Check the forecast now
            </Button>
          </div>

          {preview.isError && (
            <Notice tone="problem" live="assertive">
              {errorMessage(preview.error, "Couldn't reach the forecast. Try again in a minute.")}
            </Notice>
          )}
          {current && (
            <Notice
              tone={current.title ? 'headsup' : 'neutral'}
              live="polite"
              title={`${current.when}${current.hours ? ` · ${current.hours}` : ''}`}
            >
              {current.title ? (
                <>
                  <span className="font-semibold">You'd get: {current.title}</span>
                  {current.message && <span className="block">{current.message}</span>}
                </>
              ) : (
                <>No alert right now. {current.summary}</>
              )}
            </Notice>
          )}
        </Stack>
      )}
    </SettingRow>
  );
}
