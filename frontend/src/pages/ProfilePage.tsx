import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchProfile, updateProfile as apiUpdateProfile, type ProfileUpdateRequest } from '../api/auth';
import { fetchAlertPreferences } from '../api/notifications';
import { fetchWeatherAlerts } from '../api/weatherAlerts';
import { useAuth } from '../context/AuthContext';
import UserProfileCard from '../components/profile/UserProfileCard';
import UserEditModal from '../components/profile/UserEditModal';
import ThemePicker from '../components/ThemePicker';
import PushSettings, { usePushSubscribed } from '../components/PushSettings';
import AlertTypeSettings, { ALERT_PREFS_KEY, isTypeCardAlert } from '../components/AlertTypeSettings';
import WeatherAlertSettings, { WEATHER_ALERTS_KEY } from '../components/WeatherAlertSettings';
import LinkDeviceCard from '../components/LinkDeviceCard';
import {
  Button,
  InstrumentPanel,
  QueryState,
  Readout,
  Readouts,
  Screen,
  Seg,
  SegPanel,
  SkelInstrumentPanel,
  Stack,
  Verdict,
  useSearchParamState,
} from '../components/ui';
import { currentEnv, pushSupport, type PushSupport } from '../utils/push';
import type { Tone } from '../utils/status';

const VIEWS = ['alerts', 'weather', 'device'] as const;
type View = (typeof VIEWS)[number];
const VIEW_OPTIONS = [
  { value: 'alerts', label: 'Alerts', icon: 'bell' },
  { value: 'weather', label: 'Weather', icon: 'cloud-sun' },
  { value: 'device', label: 'This device', icon: 'phone' },
] as const;

// Old links point at a card by its hash (the Alerts page's settings link, weather alert
// notifications); open the view that holds it.
const HASH_VIEW: Record<string, View> = { '#alert-types': 'alerts', '#weather-alerts': 'weather' };

/** The verdict: can alerts reach the device in your hand, and if not, what's in the way. */
export function phoneVerdict(support: PushSupport, subscribed: boolean | undefined): { tone: Tone; text: string; note: string } {
  switch (support) {
    case 'insecure':
      return { tone: 'headsup', text: "Alerts can't reach this device here.", note: 'Phone alerts need the secure address. Phone alerts below says how.' };
    case 'install':
      return { tone: 'info', text: 'Alerts need the Home Screen app.', note: 'Add HomeOS to your Home Screen, open it from there, and turn on Phone alerts.' };
    case 'denied':
      return { tone: 'headsup', text: 'Notifications are blocked here.', note: 'Allow them for HomeOS in Settings, then come back to turn alerts on.' };
    case 'unsupported':
      return { tone: 'neutral', text: "This browser can't get phone alerts.", note: 'Your alerts still show up in Alerts.' };
    default:
      if (subscribed === undefined) return { tone: 'neutral', text: 'Checking phone alerts…', note: 'Your alerts always show up in Alerts.' };
      return subscribed
        ? { tone: 'ok', text: 'Alerts reach this device.', note: 'Even when the app is closed. Choose which ones under Alert types.' }
        : { tone: 'info', text: "Alerts don't reach this device yet.", note: 'Turn on Phone alerts below to get them even when the app is closed.' };
  }
}

export default function ProfilePage() {
  const queryClient = useQueryClient();
  const { user, isGuest, refreshUser } = useAuth();
  const [editing, setEditing] = useState(false);
  const [view, setView] = useSearchParamState('view', VIEWS, 'alerts');
  const segRef = useRef<HTMLDivElement | null>(null);

  const profile = useQuery({
    queryKey: ['profile'],
    queryFn: fetchProfile,
    staleTime: 60_000,
    enabled: !!user,
  });
  // The same queries (and cache) as the settings cards below: no extra requests.
  const prefs = useQuery({ queryKey: ALERT_PREFS_KEY, queryFn: fetchAlertPreferences, enabled: !isGuest, staleTime: 60_000 });
  const weather = useQuery({ queryKey: WEATHER_ALERTS_KEY, queryFn: fetchWeatherAlerts, enabled: !isGuest, staleTime: 60_000 });
  const support = pushSupport(currentEnv());
  const subscribed = usePushSubscribed(!isGuest && support === 'ok');

  useEffect(() => {
    const target = HASH_VIEW[window.location.hash];
    if (target && target !== view) setView(target);
    // Once, on arrival: the hash only says where a link meant to land.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSave = async (req: ProfileUpdateRequest) => {
    // Errors propagate to UserEditModal, which shows them inside the dialog.
    const updated = await apiUpdateProfile(req);
    queryClient.setQueryData(['profile'], updated);
    queryClient.invalidateQueries({ queryKey: ['profile'] });
    // Refresh the signed-in user so the strip's avatar and name update everywhere at once.
    refreshUser();
  };

  const goTo = (v: View) => {
    setView(v);
    segRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };

  const typeRows = (prefs.data ?? []).filter(isTypeCardAlert);
  const weatherRows = weather.data ?? [];
  const onPhone = typeRows.filter((r) => r.push).length + weatherRows.filter((a) => a.push).length;
  const kinds = typeRows.length + weatherRows.length;
  const weatherOn = weatherRows.filter((a) => a.inApp);
  const verdict = phoneVerdict(support, support === 'ok' ? (subscribed.isError ? false : subscribed.data) : undefined);

  return (
    <Screen>
      <QueryState
        query={profile}
        what="your profile"
        loading={<SkelInstrumentPanel readouts={2} />}
        loadingLabel="Loading your profile"
      >
        {(p) => (
          <InstrumentPanel
            instrument={
              <UserProfileCard
                displayName={p.displayName}
                username={p.username}
                email={p.email}
                phone={p.phone}
                avatarUrl={p.avatarUrl}
                accentColor={p.accentColor}
                role={p.role}
              />
            }
            verdict={
              isGuest ? (
                <Verdict tone="info" note="Guests don't get alerts. Change how the app looks below.">
                  You're visiting as a guest.
                </Verdict>
              ) : (
                <Verdict tone={verdict.tone} note={verdict.note}>{verdict.text}</Verdict>
              )
            }
            readouts={
              isGuest ? undefined : (
                <Readouts count={2}>
                  <Readout
                    label="On your phone"
                    value={prefs.data && weather.data ? onPhone : '—'}
                    unit={kinds ? `of ${kinds}` : undefined}
                    note="Kinds of alert that can buzz you"
                    onClick={() => goTo('alerts')}
                  />
                  <Readout
                    label="Weather"
                    value={weather.data ? weatherOn.length : '—'}
                    unit={weatherOn.length === 1 ? 'check' : 'checks'}
                    note={
                      !weather.data
                        ? 'Weather alerts you turned on'
                        : weatherOn.length
                          ? `${weatherOn.filter((a) => a.push).length} buzz your phone`
                          : 'None turned on yet'
                    }
                    onClick={() => goTo('weather')}
                  />
                </Readouts>
              )
            }
          >
            <div>
              <Button icon="edit" onClick={() => setEditing(true)}>Edit profile</Button>
            </div>
          </InstrumentPanel>
        )}
      </QueryState>

      <ThemePicker />

      {!isGuest && (
        <Stack gap="page">
          <div ref={segRef} className="scroll-mt-24">
            <Seg id="profile-view" label="Settings" value={view} onChange={setView} options={VIEW_OPTIONS} />
          </div>
          <SegPanel id="profile-view" value={view}>
            <Stack gap="page">
              {view === 'alerts' && (
                <>
                  <PushSettings />
                  <AlertTypeSettings />
                </>
              )}
              {view === 'weather' && <WeatherAlertSettings />}
              {view === 'device' && <LinkDeviceCard />}
            </Stack>
          </SegPanel>
        </Stack>
      )}

      {editing && profile.data && (
        <UserEditModal profile={profile.data} onSave={handleSave} onClose={() => setEditing(false)} />
      )}
    </Screen>
  );
}

