import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchPresence, labelDevice } from '../../api/presence';
import { errorMessage } from '../../api/climate';
import {
  Avatar,
  Badge,
  Board,
  Button,
  Checkbox,
  Dialog,
  Disclosure,
  EmptyState,
  Field,
  FormGrid,
  InstrumentPanel,
  Input,
  KeyValue,
  KV,
  Lamp,
  LinkButton,
  List,
  Notice,
  Panel,
  QueryState,
  Readout,
  Readouts,
  Row,
  Screen,
  Select,
  SkelInstrumentPanel,
  SkelPanel,
  Split,
  Verdict,
  type BoardPerson,
  type IconName,
} from '../../components/ui';
import { usePageMeta } from '../../components/shell/PageMeta';
import { useJitteredInterval } from '../../hooks/useJitteredInterval';
import { daysBetween, formatList, formatRelative, formatShortDate, formatStamp, formatTime, formatWeekday, plural } from '../../utils/format';
import type { Tone } from '../../utils/status';
import type { DeviceType, Presence, PresenceDevice, PresencePerson } from '../../types';

const DEVICE_TYPES: Array<{ value: DeviceType; label: string; icon: IconName }> = [
  { value: 'MOBILE', label: 'Mobile', icon: 'phone' },
  { value: 'COMPUTER', label: 'Computer', icon: 'laptop' },
  { value: 'TABLET', label: 'Tablet', icon: 'tablet' },
  { value: 'WATCH', label: 'Watch', icon: 'watch' },
  { value: 'TV', label: 'TV', icon: 'image' },
  { value: 'SMART_HOME', label: 'Smart home', icon: 'home' },
  { value: 'OTHER', label: 'Other', icon: 'wifi' },
];
const typeLabel = (t: DeviceType | null) => DEVICE_TYPES.find((x) => x.value === t)?.label ?? null;
const typeIcon = (d: PresenceDevice): IconName =>
  DEVICE_TYPES.find((x) => x.value === d.type)?.icon ?? (d.privateAddress ? 'phone' : 'wifi');
/** Only these count toward their owner being home (PresenceService). */
const counts = (t: DeviceType | '' | null) => t === 'MOBILE' || t === 'WATCH';
const isLabeled = (d: PresenceDevice) => !!(d.name || d.type || d.ownerUserId != null);

/** "Mon" → "mon" is wrong; only the relative words lower-case mid-sentence. */
const inSentence = (rel: string) => (rel === 'Just now' || rel === 'Yesterday' ? rel.toLowerCase() : rel);

type Member = Presence['members'][number];

/** A board cell is narrow: "6:12 PM" today, "Sun 6:12 PM" this week, else the date. */
function boardTime(ts: string): string {
  const days = daysBetween(ts, new Date()) ?? 99;
  if (days === 0) return formatTime(ts);
  if (days < 7) return `${formatWeekday(ts)} ${formatTime(ts)}`;
  return formatShortDate(ts);
}

/** One person on the board: Home / Away / Unknown, always a word with the lamp. */
function boardPerson(p: PresencePerson, scannerOnline: boolean): BoardPerson {
  if (p.home === true) {
    return { key: p.userId, name: p.name, state: 'Home', tone: 'ok', when: p.since ? `Since ${boardTime(p.since)}` : undefined };
  }
  if (p.home === false) {
    return {
      key: p.userId, name: p.name, state: 'Away', tone: 'neutral', away: true,
      when: p.lastSeen ? `Last seen ${inSentence(formatRelative(p.lastSeen))}` : undefined,
    };
  }
  return { key: p.userId, name: p.name, state: 'Unknown', tone: 'headsup', when: scannerOnline ? 'No phone or watch labelled' : 'Scanner offline' };
}

function deviceStatus(d: PresenceDevice): { tone: Tone; text: string; badge: string } {
  if (d.home === true) return { tone: 'ok', text: `On Wi-Fi since ${formatStamp(d.presentSince)}`, badge: 'On Wi-Fi' };
  if (d.home === false) return { tone: 'neutral', text: `Last seen ${inSentence(formatRelative(d.lastSeen))}`, badge: 'Away' };
  return { tone: 'headsup', text: 'Unknown while the scanner is offline', badge: 'Unknown' };
}

function Answer({ data }: { data: Presence }) {
  const { scanner } = data;
  const home = data.people.filter((p) => p.home === true).map((p) => p.name);
  const away = data.people.filter((p) => p.home === false).map((p) => p.name);
  const unnamed = data.devices.filter((d) => !isLabeled(d));
  const unnamedPhones = unnamed.filter((d) => d.home === true && d.privateAddress).length;
  const latestAway = data.people.filter((p) => p.home === false && p.lastSeen)[0];

  let verdict;
  if (scanner.lastScanAt == null) {
    verdict = (
      <Verdict tone="neutral" note="The home server lists the devices on the Wi-Fi once its scanner is installed.">
        The Wi-Fi scanner isn't set up yet.
      </Verdict>
    );
  } else if (!scanner.online) {
    verdict = (
      <Verdict tone="headsup" note={`The last check was ${inSentence(formatRelative(scanner.lastScanAt))}. Everyone shows as unknown until it reports again.`}>
        Can't tell who's home: the Wi-Fi scanner is offline.
      </Verdict>
    );
  } else if (!data.people.length) {
    verdict = (
      <Verdict tone="neutral" note="Label each member's phone below, or have them link it from Profile.">
        Nobody's set up yet.
      </Verdict>
    );
  } else {
    const sentence = home.length === 0
      ? 'Nobody is home.'
      : away.length === 0
        ? home.length === 1 ? `${home[0]} is home.` : `Everyone is home: ${formatList(home)}.`
        : `${formatList(home)} ${home.length === 1 ? 'is' : 'are'} home. ${formatList(away)} ${away.length === 1 ? 'is' : 'are'} out.`;
    verdict = (
      <Verdict
        tone="ok"
        note={latestAway?.lastSeen ? `${latestAway.name}'s phone was last on the Wi-Fi ${inSentence(formatRelative(latestAway.lastSeen))}.` : undefined}
      >
        {sentence}
      </Verdict>
    );
  }

  return (
    <InstrumentPanel
      instrument={
        data.people.length ? (
          <Board label="Who's home now" people={data.people.map((p) => boardPerson(p, scanner.online))} />
        ) : (
          <EmptyState compact icon="users" title="Nobody's set up yet" />
        )
      }
      verdict={verdict}
      readouts={
        <Readouts count={3}>
          <Readout label="Home" value={home.length} unit={`of ${data.people.length}`} note={home.length ? formatList(home) : 'Nobody'} />
          <Readout
            label="On Wi-Fi"
            value={scanner.lastScanAt ? scanner.devicesInLastScan : '—'}
            unit="devices"
            note={scanner.lastScanAt ? `In the ${formatTime(scanner.lastScanAt)} check` : 'No check yet'}
          />
          <Readout
            label="Unnamed"
            value={unnamed.length}
            unit="devices"
            note={
              unnamedPhones
                ? `${unnamedPhones} on Wi-Fi now ${unnamedPhones === 1 ? 'looks like a phone' : 'look like phones'}`
                : 'None on Wi-Fi look like a phone'
            }
          />
        </Readouts>
      }
      foot={
        <>
          <span className="fp-cluster">
            <Lamp tone={scanner.lastScanAt == null ? 'neutral' : scanner.online ? 'ok' : 'headsup'} size="s" />
            <span className="fp-mono">
              {scanner.lastScanAt == null
                ? 'Scanner not set up'
                : scanner.online
                  ? `Checked ${inSentence(formatRelative(scanner.lastScanAt))} · ${scanner.devicesInLastScan} on Wi-Fi`
                  : `Scanner offline · last check ${inSentence(formatRelative(scanner.lastScanAt))}`}
            </span>
          </span>
          <span className="fp-mono">Away {data.awayAfterMinutes} min after the last check-in</span>
        </>
      }
    />
  );
}

/** The devices that decide who's home: labelled phones and watches with an owner. */
function Counted({ devices }: { devices: PresenceDevice[] }) {
  const counted = devices.filter((d) => counts(d.type) && d.ownerUserId != null);
  return (
    <Panel title="Phones and watches" subtitle="These decide who's home. Computers and tablets stay home when people leave, so they don't count">
      {counted.length ? (
        <List>
          {counted.map((d) => {
            const s = deviceStatus(d);
            return (
              <Row
                key={d.id}
                compact
                lead={<Avatar name={d.owner ?? '?'} size="sm" decorative />}
                title={d.name || 'Unnamed device'}
                meta={s.text}
                trail={<Badge tone={s.tone}>{s.badge}</Badge>}
              />
            );
          })}
        </List>
      ) : (
        <EmptyState compact icon="phone" title="No phones or watches labelled yet">
          Label each member's phone under Manage devices, or have them link it from Profile.
        </EmptyState>
      )}
    </Panel>
  );
}

function HowItWorks({ data }: { data: Presence }) {
  return (
    <Panel
      title="How it works"
      subtitle="The home server looks for devices on the Wi-Fi"
      footer={
        <>
          <span className="fp-small fp-muted">Sleeping phones skip some checks.</span>
          <LinkButton to="/admin/nuc" size="sm" variant="quiet" iconEnd="arrow-right">Server health</LinkButton>
        </>
      }
    >
      <KeyValue>
        <KV label="Checks" value="Every minute" />
        <KV label="Counts as home" value="A phone or watch seen" />
        <KV label="Away after" value={`${data.awayAfterMinutes} min without one`} />
        <KV
          label="Last check"
          value={data.scanner.lastScanAt ? `${formatTime(data.scanner.lastScanAt)} · ${plural(data.scanner.devicesInLastScan, 'device')}` : 'Not set up'}
        />
      </KeyValue>
    </Panel>
  );
}

function DeviceRow({ d, onEdit }: { d: PresenceDevice; onEdit: (d: PresenceDevice) => void }) {
  const s = deviceStatus(d);
  const details = [typeLabel(d.type), d.owner].filter(Boolean).join(' · ');
  const labeled = isLabeled(d);
  return (
    <Row
      icon={typeIcon(d)}
      title={d.name || 'Unnamed device'}
      regularTitle={!d.name}
      meta={
        <span className="flex flex-col gap-0.5">
          {details && <span>· {details}</span>}
          {d.privateAddress && !labeled && <span className="fp-t-info">Private address — likely a phone, tablet or watch</span>}
          <span className="inline-flex items-center gap-1.5"><Lamp tone={s.tone} size="s" />{s.text}</span>
          <span className="fp-mono break-all">{d.mac}{d.ip ? ` · ${d.ip}` : ''}</span>
        </span>
      }
      trail={<Button size="sm" onClick={() => onEdit(d)}>{labeled ? 'Edit' : 'Label'}</Button>}
    />
  );
}

/**
 * Label a device: name, type, owner. The form is seeded from the device as it is when the
 * dialog opens (B-185: a form kept from an earlier mount could write a stale owner back).
 */
function LabelDialog({ d, members, onClose }: { d: PresenceDevice; members: Member[]; onClose: () => void }) {
  const queryClient = useQueryClient();
  // A phone-style private address is most likely a phone, so start there.
  const initialType = d.type ?? (d.privateAddress ? 'MOBILE' : '');
  const initialOwner = d.ownerUserId != null ? String(d.ownerUserId) : '';
  const [name, setName] = useState(d.name ?? '');
  const [type, setType] = useState<DeviceType | ''>(initialType);
  const [owner, setOwner] = useState(initialOwner);
  const dirty = name !== (d.name ?? '') || type !== initialType || owner !== initialOwner;
  const save = useMutation({
    mutationFn: () => labelDevice(d.id, name, type || null, owner ? Number(owner) : null),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['admin-presence'] });
      onClose();
    },
  });
  const s = deviceStatus(d);
  return (
    <Dialog
      open
      onClose={onClose}
      eyebrow="Who's home"
      title={isLabeled(d) ? 'Edit a device' : 'Label a device'}
      subtitle={<span className="fp-mono">{d.mac}{d.ip ? ` · ${d.ip}` : ''}</span>}
      closeOnBackdrop={!dirty}
      footer={
        <>
          <Button variant="quiet" onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form={`label-device-${d.id}`} busy={save.isPending} busyLabel="Saving…">Save</Button>
        </>
      }
    >
      <form
        id={`label-device-${d.id}`}
        className="fp-stack"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <p className="fp-small fp-muted fp-cluster"><Lamp tone={s.tone} size="s" />{s.text}</p>
        <FormGrid>
          <Field label="Name" wide help="Up to 60 characters">
            <Input value={name} maxLength={60} placeholder="Bryan's iPhone" onChange={(e) => setName(e.target.value)} autoFocus />
          </Field>
          <Field label="Type">
            <Select value={type} onChange={(e) => setType(e.target.value as DeviceType | '')}>
              <option value="">Not set</option>
              {DEVICE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </Select>
          </Field>
          <Field label="Owner">
            <Select value={owner} onChange={(e) => setOwner(e.target.value)}>
              <option value="">Nobody</option>
              {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </Select>
          </Field>
        </FormGrid>
        {owner && !counts(type) && (
          <Notice tone="neutral">
            Only mobiles and watches count toward their owner being home; a {typeLabel(type || null)?.toLowerCase() ?? 'device with no type'} stays
            home when they leave.
          </Notice>
        )}
        {save.isError && (
          <Notice tone="problem" live="assertive" title="Couldn't save.">{errorMessage(save.error, 'The home server didn’t answer')}</Notice>
        )}
      </form>
    </Dialog>
  );
}

function ManageDevices({ data }: { data: Presence }) {
  const [showAll, setShowAll] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const named = data.devices.filter(isLabeled);
  const others = data.devices.filter((d) => !isLabeled(d));
  const othersOnWifi = others.filter((d) => d.home !== false);
  const othersShown = showAll ? others : othersOnWifi;
  // Always the device as the latest poll has it.
  const editing = editingId == null ? null : data.devices.find((d) => d.id === editingId) ?? null;
  return (
    <Panel flush aria-label="Manage devices">
      <Disclosure
        variant="row"
        summary={<span className="fp-cluster">Manage devices <span className="fp-small fp-muted">{named.length} labelled · {others.length} unnamed</span></span>}
        openSummary="Hide devices"
      >
        <div className="fp-stack">
          <Notice
            tone="neutral"
            title="Adding a phone?"
            action={<LinkButton to="/profile" size="sm" icon="user">Open Profile</LinkButton>}
          >
            Easiest: open Profile on that phone and tap Link this device. Or find it below, set its type to Mobile and pick its
            owner. Phones usually show “Private address”. To spot yours, turn its Wi-Fi off for a few minutes: the one that goes
            from On Wi-Fi to Last seen is it.
          </Notice>

          <section aria-labelledby="whos-home-labelled" className="fp-stack fp-stack--s">
            <h3 id="whos-home-labelled" className="fp-label">Labelled · {named.length}</h3>
            {named.length ? (
              <List inset>{named.map((d) => <DeviceRow key={d.id} d={d} onEdit={(x) => setEditingId(x.id)} />)}</List>
            ) : (
              <EmptyState compact title="No devices labelled yet" />
            )}
          </section>

          <section aria-labelledby="whos-home-unnamed" className="fp-stack fp-stack--s">
            {/* Both counts, so the heading never disagrees with the list under it (B-186). */}
            <h3 id="whos-home-unnamed" className="fp-label">
              Unnamed · {othersOnWifi.length} on Wi-Fi · {others.length} total
            </h3>
            <Checkbox
              label="Include ones not on Wi-Fi now"
              checked={showAll}
              onChange={(e) => setShowAll(e.target.checked)}
            />
            {othersShown.length ? (
              <List inset>{othersShown.map((d) => <DeviceRow key={d.id} d={d} onEdit={(x) => setEditingId(x.id)} />)}</List>
            ) : (
              <EmptyState compact title={`No other devices${showAll ? '' : ' on Wi-Fi right now'}`} />
            )}
          </section>
        </div>
      </Disclosure>
      {editing && <LabelDialog key={editing.id} d={editing} members={data.members} onClose={() => setEditingId(null)} />}
    </Panel>
  );
}

/**
 * Admin → Who's home. The NUC lists the devices on the home Wi-Fi every minute; label
 * the household's phones with whose they are, and each person shows as home while one
 * of their devices was seen recently.
 */
export default function WhosHome() {
  const refreshInterval = useJitteredInterval(60_000);
  const query = useQuery({
    queryKey: ['admin-presence'],
    queryFn: fetchPresence,
    staleTime: 30_000,
    refetchInterval: refreshInterval,
    refetchIntervalInBackground: false,
    placeholderData: keepPreviousData,
  });
  const lastScan = query.data?.scanner.lastScanAt;
  usePageMeta({ subtitle: lastScan ? `Checked ${formatTime(lastScan)}` : undefined });

  // A failed poll keeps the last good data on screen with a slim notice (B-187); only a
  // failed first load replaces the page.
  return (
    <Screen>
      <QueryState
        query={query}
        what="who's home"
        loading={<><SkelInstrumentPanel readouts={3} /><SkelPanel rows={4} /></>}
        isEmpty={() => false}
      >
        {(data) => (
          <>
            <Answer data={data} />
            <Split>
              <Counted devices={data.devices} />
              <HowItWorks data={data} />
            </Split>
            <ManageDevices data={data} />
          </>
        )}
      </QueryState>
    </Screen>
  );
}
