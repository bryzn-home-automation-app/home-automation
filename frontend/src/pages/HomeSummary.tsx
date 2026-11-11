import { lazy, Suspense, useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useUsageData } from '../hooks/useUsageData';
import { ForecastStrip } from '../components/WeatherForecast';
import { fetchMaintenanceAnalytics } from '../api/maintenance';
import { fetchNotifications, fetchUnreadCount } from '../api/notifications';
import { fetchGuestSessionCount } from '../api/auth';
import { fetchThermostats } from '../api/climate';
import { useAuth } from '../context/AuthContext';
import { fetchRoombaStatus, fetchRoombaRuns } from '../api/roomba';
import { fetchWaterBills } from '../api/waterBills';
import { fetchCurrentWeather } from '../api/weather';
import { useJitteredInterval } from '../hooks/useJitteredInterval';
import { usePageMeta } from '../components/shell/PageMeta';
import { visibleRoutes, type AppRoute } from '../routes';
import {
  Badge, Button, Count, Dial, DialCentre, DialLegend, Disclosure, EmptyState, Icon, InstrumentPanel, LampRow,
  LinkButton, List, Num, Panel, QueryState, Readout, Readouts, Row, Screen, SkelRows, Split, Stack, Verdict,
  type DialSegment, type LampRowItem, type LegendItem,
} from '../components/ui';
import {
  DASH, daysBetween, formatAbout, formatDate, formatMoney, formatNumber, formatShortDate, formatStamp,
  formatTemp, formatTime, homeClock, homeToday, plural,
} from '../utils/format';
import { severityStatus, type Tone } from '../utils/status';
import { getWeatherCodeDescription, isNightAt, nextHours, weatherIcon, type SunPlace } from '../utils/weather';
import { sunTimesOn } from '../utils/sun';
import {
  alertMeta, attentionItems, climateLine, homeVerdict, latestCompleteDay, rainWindow, homeRoomba, thermostatWords,
} from './home/summary';
import type { Thermostat, WaterBill } from '../types';

// The dialog carries the charts (recharts): loaded on first open, not with Home.
const ForecastModal = lazy(() => import('../components/WeatherForecastModal'));

/*
 * Home: "Do I need to do anything? What's it like outside?" The 24-hour ring answers the
 * outside (daylight, now, rain, the temperature in the middle); the verdict and the list
 * under it answer the inside. Then the next hours, every other page one tap away, and the
 * newest alerts. Who's home stays on the admin page: presence is an admin-only endpoint.
 */

/** Every page's one-line summary on Home; the line the registry can't know. */
type ShortcutMeta = { meta: string; value?: ReactNode; unit?: string; trail?: ReactNode };

export default function HomeSummary() {
  const { isAdmin, isGuest, user } = useAuth();
  // Home only needs pre-aggregated daily data, so skip the heavy raw-hourly
  // fetches — no reason to transfer ~2,880 rows the landing screen never shows.
  const { electricDaily, config } = useUsageData({ hourly: false });
  const [showForecast, setShowForecast] = useState(false);
  const roombaInterval = useJitteredInterval(60_000);
  const thermostatInterval = useJitteredInterval(120_000, 10_000);

  const kwhRate = config.data?.kwhRate ?? 0.1171;

  // ── Data (each one is also what its own page asks for) ──
  const weather = useQuery({
    queryKey: ['weather-current'],
    queryFn: fetchCurrentWeather,
    staleTime: 300_000,
  });

  // Shared with the Climate tab (same key), so either page warms the other.
  const thermostats = useQuery({
    queryKey: ['thermostats'],
    queryFn: fetchThermostats,
    staleTime: 20_000,
    refetchInterval: thermostatInterval,
    refetchIntervalInBackground: false,
    retry: false,
  });

  // Guests can't open Maintenance, so they don't ask for its numbers either.
  const maintenance = useQuery({
    queryKey: ['maintenance-analytics'],
    queryFn: fetchMaintenanceAnalytics,
    staleTime: 60_000,
    enabled: !isGuest,
  });

  const recentNotifications = useQuery({
    queryKey: ['notifications', { limit: 6 }],
    queryFn: () => fetchNotifications({ limit: 6 }),
    staleTime: 30_000,
  });

  const unreadCount = useQuery({
    queryKey: ['notifications-unread-count'],
    queryFn: fetchUnreadCount,
    staleTime: 30_000,
  });

  // Admin-only endpoint: for everyone else it errored on every Home load (and was
  // retried), so only admins ask.
  const guestCount = useQuery({
    queryKey: ['guest-session-count'],
    queryFn: fetchGuestSessionCount,
    staleTime: 30_000,
    enabled: isAdmin,
    retry: false,
  });

  const roomba = useQuery({
    queryKey: ['roomba-status'],
    queryFn: fetchRoombaStatus,
    staleTime: 15_000,
    refetchInterval: roombaInterval,
  });
  const roombaRuns = useQuery({
    queryKey: ['roomba-runs', { limit: 1 }],
    queryFn: () => fetchRoombaRuns(1),
    staleTime: 60_000,
  });

  const waterBills = useQuery({
    queryKey: ['water-bills'],
    queryFn: fetchWaterBills,
    staleTime: 60_000,
  });

  usePageMeta({ subtitle: weather.dataUpdatedAt ? `Updated ${formatTime(weather.dataUpdatedAt)}` : undefined });

  // ── Derived ──
  const latestDay = useMemo(() => latestCompleteDay(electricDaily.data), [electricDaily.data]);
  const latestWaterBill = useMemo<WaterBill | null>(() => {
    const bills = Array.isArray(waterBills.data) ? waterBills.data : [];
    return bills.reduce<WaterBill | null>((a, b) => (!a || b.billingPeriodStart > a.billingPeriodStart ? b : a), null);
  }, [waterBills.data]);
  const tstats = useMemo<Thermostat[]>(
    () => [...(thermostats.data ?? [])].sort((a, b) => a.name.localeCompare(b.name)),
    [thermostats.data],
  );

  const wx = weather.data;
  const current = wx?.current ?? null;
  const place: SunPlace | null = wx ? { lat: wx.latitude, lon: wx.longitude } : null;
  const hours = useMemo(() => nextHours(wx?.hourly, 24), [wx?.hourly]);

  const rb = roomba.data ?? null;
  const lastRun = roombaRuns.data?.[0] ?? null;
  const rbHome = homeRoomba(rb, lastRun);
  const rbAlarm = rbHome.tone === 'headsup' || rbHome.tone === 'problem' ? rbHome.tone : undefined;

  const unread = unreadCount.data ?? 0;
  const notes = recentNotifications.data;

  // Guests see none of the attention rows: the house's chores and repairs aren't theirs.
  const attention = useMemo(
    () => (isGuest ? [] : attentionItems({ roomba: rb, thermostats: thermostats.data, alerts: notes, latestDay })),
    [isGuest, rb, thermostats.data, notes, latestDay],
  );
  const verdict = homeVerdict(attention);

  // ── The ring ──
  const now = new Date();
  const clock = homeClock(now);
  const nowHour = clock ? clock.hour + clock.minute / 60 : 0;
  const sun = place ? sunTimesOn(homeToday(now), place.lat, place.lon) : null;
  const sunrise = sun ? hourFraction(sun.sunrise) : null;
  const sunset = sun ? hourFraction(sun.sunset) : null;
  const rain = rainWindow(hours);
  const daySegments: DialSegment[] = sunrise != null && sunset != null
    ? [
      { from: 0, to: sunrise, tone: 'night', static: true },
      { from: sunrise, to: sunset, tone: 'day', static: true },
      { from: sunset, to: 24, tone: 'night', static: true },
    ]
    : [];
  const rainSegments: DialSegment[] = rain
    ? (rain.to > rain.from || rain.to === 0
      ? [{ from: rain.from, to: rain.to === 0 ? 24 : rain.to, tone: 'cool' }]
      : [{ from: rain.from, to: 24, tone: 'cool' }, { from: 0, to: rain.to, tone: 'cool' }])
    : [];
  const sky = current ? getWeatherCodeDescription(current.weatherCode) : null;
  const legend: LegendItem[] = [];
  if (sun) legend.push({ label: 'Daylight', value: `${formatTime(sun.sunrise)} – ${formatTime(sun.sunset)}`, tone: 'day', key: 'box' });
  if (rain) legend.push({ label: 'Rain', value: rain.range, tone: 'cool' });
  const dialLabel = [
    current ? `Outside it is ${formatTemp(current.temperature)} and ${sky!.toLowerCase()}.` : 'The outside temperature isn\'t available right now.',
    sun ? `Daylight from ${formatTime(sun.sunrise)} to ${formatTime(sun.sunset)}.` : '',
    rain ? `Rain is likely ${rain.text}.` : '',
  ].filter(Boolean).join(' ');

  const weatherNote = current
    ? `${sky} and ${formatTemp(current.temperature)} now.${rain ? ` Rain is likely ${rain.text}.` : ''}`
    : weather.isError
      ? "The weather isn't available right now."
      : null;

  // ── The lamps: one per system the page can see ──
  const lamps: LampRowItem[] = [
    { key: 'power', label: 'Power', tone: electricTone(latestDay?.date), to: '/utility' },
    { key: 'climate', label: 'Climate', tone: climateTone(thermostats.data, thermostats.isError), to: '/climate' },
    { key: 'roomba', label: 'Roomba', tone: !rb ? 'neutral' : rbHome.tone === 'info' || rbHome.tone === 'neutral' ? 'ok' : rbHome.tone, to: '/roomba' },
    { key: 'alerts', label: 'Alerts', tone: unreadCount.data == null ? 'neutral' : unread > 0 ? 'info' : 'ok', to: '/notifications' },
  ];

  // ── Readouts ──
  const firstT = tstats.find((t) => t.available) ?? tstats[0];
  const otherT = tstats.filter((t) => t !== firstT);
  const dayAgo = latestDay ? daysBetween(latestDay.date, now) : null;
  const readouts = (
    <Readouts count={4}>
      <Readout
        label="Inside"
        value={firstT?.available ? formatTemp(firstT.temperature).replace('°', '') : DASH}
        unit={firstT?.available ? '°F' : undefined}
        note={
          thermostats.isError && !thermostats.data
            ? "Can't reach the thermostats"
            : firstT
              ? [`${firstT.name}${firstT.available ? '' : ' isn\'t answering'}`, ...otherT.map((t) => `${t.name} ${thermostatWords(t)}`)].join('. ')
              : thermostats.data ? 'No thermostats set up' : 'Checking the thermostats'
        }
        to="/climate"
      />
      <Readout
        label={dayAgo === 1 ? 'Yesterday' : 'Last full day'}
        value={latestDay ? formatNumber(latestDay.totalKwh, { decimals: 1, fixed: true }) : DASH}
        unit={latestDay ? 'kWh' : undefined}
        note={
          latestDay
            ? `${dayAgo === 1 ? '' : `${formatShortDate(latestDay.date)}, `}${formatAbout(latestDay.totalKwh * kwhRate)}`
            : electricDaily.isError ? "Couldn't load electric use" : 'Syncs each evening'
        }
        to="/utility"
      />
      <Readout
        label="Water bill"
        value={latestWaterBill ? formatMoney(latestWaterBill.totalDue) : DASH}
        note={
          latestWaterBill
            ? [latestWaterBill.dueDate ? `Due ${formatShortDate(latestWaterBill.dueDate)}` : null,
              latestWaterBill.usageThousands != null ? formatNumber(latestWaterBill.usageThousands, { unit: 'gal' }) : null]
              .filter(Boolean).join(', ')
            : waterBills.isError ? "Couldn't load the water bills" : 'Arrives once a month'
        }
        to="/utility?view=water"
      />
      <Readout
        label="Roomba"
        value={rb && !rbHome.state.offline && rb.batteryPct != null ? rb.batteryPct : DASH}
        unit={rb && !rbHome.state.offline && rb.batteryPct != null ? '%' : undefined}
        tone={rbAlarm}
        note={rbHome.line}
        to="/roomba"
      />
    </Readouts>
  );

  // ── Shortcuts to every other page this person can open ──
  const water = latestWaterBill
    ? `Water bill ${formatMoney(latestWaterBill.totalDue)}${latestWaterBill.dueDate ? ` due ${formatShortDate(latestWaterBill.dueDate)}` : ''}`
    : null;
  const metaFor = (r: AppRoute): ShortcutMeta => {
    switch (r.id) {
      case 'utility':
        return { meta: [latestDay ? `${formatNumber(latestDay.totalKwh, { decimals: 1, fixed: true, unit: 'kWh' })} on ${formatShortDate(latestDay.date)}` : 'Electric, gas and water', water].filter(Boolean).join('. ') };
      case 'climate':
        return { meta: tstats.length ? climateLine(tstats) : 'The thermostats' };
      case 'cameras':
        return { meta: 'Live views and recordings' };
      case 'roomba':
        return {
          meta: rbHome.line,
          trail: rbAlarm ? <Badge tone={rbAlarm}>{rbHome.state.label}</Badge> : undefined,
        };
      case 'maintenance': {
        const m = maintenance.data;
        return m
          ? { meta: `${plural(m.completedCount, 'job')} done${m.lastActivityDate ? `, last on ${formatShortDate(m.lastActivityDate)}` : ''}`, value: m.openCount, unit: 'open' }
          : { meta: 'The home upkeep log' };
      }
      case 'wifi':
        return guestCount.data
          ? { meta: `${plural(guestCount.data, 'guest')} signed in`, value: guestCount.data, unit: 'online' }
          : { meta: 'Share the guest network' };
      case 'users':
        // Members see a read-only list (B-064).
        return { meta: isAdmin ? 'Members, roles and approvals' : 'Household members' };
      case 'notifications':
        // B-066: "1 unread alert", and "All caught up" rather than "0 unread alerts".
        return unreadCount.data == null
          ? { meta: 'Everything the house has told you' }
          : unread === 0
            ? { meta: 'All caught up' }
            : { meta: `${plural(unread, 'unread alert')}${notes?.[0] ? `. Newest ${formatStamp(notes[0].createdAt)}` : ''}`, trail: <Count value={unread} label={`${unread} unread`} /> };
      case 'profile':
        return { meta: 'Appearance, phone alerts and this device' };
      case 'updates':
        return { meta: 'The latest changes to the app' };
      case 'admin/presence':
        return { meta: 'Who is on the home Wi-Fi' };
      case 'admin/guests':
        return { meta: 'Guest access and when it ends' };
      case 'admin/logs':
        return { meta: 'Sign-ins, thermostat changes and guests' };
      case 'admin/usage':
        return { meta: 'Which pages get used' };
      case 'admin/nuc':
        return { meta: 'The home server’s vital signs' };
      case 'admin/debug':
        return { meta: 'Data syncs and events' };
      default:
        return { meta: r.label };
    }
  };
  const shortcut = (r: AppRoute) => {
    const s = metaFor(r);
    return <Row key={r.id} to={r.path} icon={r.icon} title={r.label} meta={s.meta} value={s.value} unit={s.unit} trail={s.trail} />;
  };
  const role = user?.role ?? null;
  const pages = visibleRoutes(role).filter((r) => r.id !== 'home' && r.group !== 'admin');
  const adminPages = visibleRoutes(role, 'admin');

  return (
    <Screen>
      <InstrumentPanel
        instrument={
          <>
            <Dial
              start={180}
              sweep={360}
              label={dialLabel}
              rings={[
                {
                  r: 84, w: 12, min: 0, max: 24, edge: true, ticks: 24, major: 6,
                  labels: [[0, '12 AM'], [6, '6 AM'], [12, 'Noon'], [18, '6 PM']],
                  segments: daySegments,
                  needle: { at: nowHour },
                },
                { r: 68, w: 5, min: 0, max: 24, track: false, segments: rainSegments },
              ]}
            >
              <DialCentre note={sky ?? (weather.isError ? 'Weather unavailable' : 'Checking the weather')}>
                {current && <Icon name={weatherIcon(current.weatherCode, isNightAt(now, place))} className="mb-0.5 text-[24px] text-apptext-muted" />}
                <Num size="xl" value={current ? Math.round(current.temperature) : DASH} unit={current ? '°F' : undefined} />
              </DialCentre>
            </Dial>
            {/* The daylight key is the dial's own pale day colour: a hairline keeps it visible on light enamel. */}
            {legend.length > 0 && <DialLegend items={legend} className="[&_.fp-lg-key--box]:shadow-[inset_0_0_0_1px_var(--appborder-strong)]" />}
            <LampRow label="Systems" items={lamps} />
          </>
        }
        verdict={<Verdict tone={verdict.tone} note={weatherNote}>{verdict.text}</Verdict>}
      >
        {attention.length > 0 && (
          <List inset aria-label="Needs a look">
            {attention.map((a) => (
              <Row key={a.key} to={a.to} lamp={a.tone} title={a.title} meta={a.meta} compact />
            ))}
          </List>
        )}
        {readouts}
      </InstrumentPanel>

      <Split>
        <Stack gap="page">
          <Panel
            title="Next hours"
            subtitle={hiLoLine(hours)}
            action={hours.length > 0 ? <Button size="sm" icon="clock" onClick={() => setShowForecast(true)}>All 24 hours</Button> : undefined}
          >
            <QueryState
              query={weather}
              what="the forecast"
              loading={<SkelRows count={2} />}
              isEmpty={(d) => !d || nextHours(d.hourly, 2).length < 2}
              empty={<EmptyState compact icon="cloud" title="No forecast yet">The hourly forecast refreshes every hour.</EmptyState>}
              compact
            >
              {() => <ForecastStrip hours={hours} place={place} />}
            </QueryState>
          </Panel>

          <Panel title="Around the house">
            <List>{pages.map(shortcut)}</List>
            {adminPages.length > 0 && (
              <Disclosure variant="row" summary="Admin pages" openSummary="Hide admin pages">
                <List>{adminPages.map(shortcut)}</List>
              </Disclosure>
            )}
          </Panel>
        </Stack>

        <Panel
          title="Recent alerts"
          subtitle={unreadCount.data == null ? undefined : unread === 0 ? 'All caught up' : `${unread} unread`}
          action={<LinkButton to="/notifications" size="sm" variant="quiet" iconEnd="arrow-right">See all</LinkButton>}
        >
          <QueryState
            query={recentNotifications}
            what="the alerts"
            empty={<EmptyState compact icon="bell" title="No alerts yet">Usage spikes, bills, weather and the Roomba will show up here.</EmptyState>}
            compact
          >
            {(list) => (
              <List>
                {list.map((n) => {
                  // B-067 / B-068: the severity's own lamp (info is blue, not the unread ink),
                  // the category in words and how long ago.
                  const s = severityStatus(n.severity);
                  return (
                    <Row
                      key={n.id}
                      to="/notifications"
                      lamp={s.tone as Tone}
                      title={n.title}
                      meta={alertMeta(n)}
                      unread={!n.isRead}
                      regularTitle
                      compact
                      chevron={false}
                    />
                  );
                })}
              </List>
            )}
          </QueryState>
        </Panel>
      </Split>

      {showForecast && (
        <Suspense fallback={null}>
          <ForecastModal hourly={wx?.hourly} current={current} place={place} onClose={() => setShowForecast(false)} />
        </Suspense>
      )}
    </Screen>
  );
}

/** A Date as hours since the home's midnight (6:52 AM = 6.87). */
function hourFraction(d: Date): number | null {
  const c = homeClock(d);
  return c ? c.hour + c.minute / 60 : null;
}

/** "Low of 47° tonight, high of 61° tomorrow" over the next 24 hours. */
function hiLoLine(hours: { time: string; temperature: number }[]): string | undefined {
  if (hours.length < 2) return undefined;
  let lo = hours[0];
  let hi = hours[0];
  for (const h of hours) {
    if (h.temperature < lo.temperature) lo = h;
    if (h.temperature > hi.temperature) hi = h;
  }
  const when = (t: string) => {
    const c = homeClock(t);
    const today = homeToday();
    const day = daysBetween(today, t) ?? 0;
    const hour = c?.hour ?? 12;
    if (day === 0) return hour >= 18 ? 'tonight' : 'today';
    if (day === 1) return hour < 6 ? 'tonight' : 'tomorrow';
    return formatDate(t);
  };
  return `Low of ${formatTemp(lo.temperature)} ${when(lo.time)}, high of ${formatTemp(hi.temperature)} ${when(hi.time)}`;
}

/** The Power lamp: OK while yesterday's (or the day before's) electric day is in. */
function electricTone(date: string | undefined): Tone {
  if (!date) return 'neutral';
  const age = daysBetween(date, new Date());
  return age != null && age >= 3 ? 'headsup' : 'ok';
}

function climateTone(list: Thermostat[] | undefined, errored: boolean): Tone {
  if (!list) return errored ? 'headsup' : 'neutral';
  if (!list.length) return 'neutral';
  return list.every((t) => t.available) ? 'ok' : 'headsup';
}

