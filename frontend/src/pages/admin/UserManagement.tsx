import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  approveUser,
  clearResetTries,
  denyUser,
  disableUser,
  fetchAllUsers,
  fetchBirthdays,
  fetchPendingUsers,
  oidcConfig,
  reactivateUser,
  setBirthday,
  updateUserRole,
  type AdminUser,
} from '../../api/auth';
import BirthdayInput, { formatBirthday } from '../../components/BirthdayInput';
import { useAuth } from '../../context/AuthContext';
import { usePageMeta } from '../../components/shell/PageMeta';
import {
  Avatar,
  Badge,
  Board,
  Button,
  ConfirmDialog,
  Dialog,
  Disclosure,
  EmptyState,
  Fieldset,
  IconButton,
  InstrumentPanel,
  LinkButton,
  List,
  Notice,
  Panel,
  QueryState,
  Readout,
  Readouts,
  Row,
  Screen,
  Seg,
  SkelRows,
  Split,
  Stack,
  Tag,
  Verdict,
  useConfirm,
  type BoardPerson,
} from '../../components/ui';
import { formatList, formatRelative, formatStamp, formatTime, plural } from '../../utils/format';
import { accountStatus, roleLabel } from '../../utils/status';

/** A person's own colour, or a quiet default by role (the old gold/blue/violet rails). */
function personColor(u: AdminUser): string {
  if (u.accentColor) return u.accentColor;
  if (u.role === 'ADMIN') return '#FFD700';
  if (u.role === 'GUEST') return '#a78bfa';
  return '#3b82f6';
}

const nameOf = (u: AdminUser) => u.displayName || u.username;

/** "2 hr ago", "yesterday", "3 days ago", "Fri, Oct 30": relative words mid-sentence, dates as written. */
function lastSeen(at: string): string {
  const rel = formatRelative(at);
  return /^(Just now|Yesterday|Tomorrow)$/.test(rel) ? rel.toLowerCase() : rel;
}

/**
 * The email line, for admins only and never the placeholder address guest accounts are
 * created with (B-182: everyone, guests included, could read the family's addresses).
 */
export function visibleEmail(u: Pick<AdminUser, 'email'>, isAdmin: boolean): string | null {
  if (!isAdmin || !u.email || u.email.endsWith('@guest.local')) return null;
  return u.email;
}

/** The household: active members and admins, not guests, sign-ups or turned-off accounts (B-184). */
export function householdOf(users: readonly AdminUser[]): AdminUser[] {
  return users.filter((u) => u.role !== 'GUEST' && u.status === 'ACTIVE');
}

const ROLE_ORDER: Record<string, number> = { ADMIN: 0, USER: 1, GUEST: 2 };
const byRole = (a: AdminUser, b: AdminUser) => (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9) || nameOf(a).localeCompare(nameOf(b));

type RoleKey = 'ADMIN' | 'USER' | 'GUEST';
const ROLE_OPTIONS = (['ADMIN', 'USER', 'GUEST'] as const).map((r) => ({ value: r, label: roleLabel(r) }));
const APPROVE_OPTIONS = (['USER', 'ADMIN'] as const).map((r) => ({ value: r, label: roleLabel(r) }));

export default function UserManagement() {
  const { isAdmin, user: me } = useAuth();
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);
  const [managing, setManaging] = useState<AdminUser | null>(null);
  const [denying, setDenying] = useState<AdminUser | null>(null);
  const [confirm, confirmDialog] = useConfirm();
  const fail = (what: string) => (err: unknown) => {
    const e = err as { response?: { data?: { message?: string; error?: string } }; message?: string };
    setActionError(`${what}: ${e?.response?.data?.message || e?.response?.data?.error || e?.message || 'request failed'}`);
  };

  const allUsers = useQuery({ queryKey: ['all-users'], queryFn: fetchAllUsers });
  const pendingUsers = useQuery({ queryKey: ['admin-users-pending'], queryFn: fetchPendingUsers, enabled: isAdmin });
  // The birthdays members reset a forgotten password with: admins only, and only this endpoint has them.
  const birthdays = useQuery({ queryKey: ['admin-user-birthdays'], queryFn: fetchBirthdays, enabled: isAdmin });
  const birthdayOf = (userId: number) => birthdays.data?.find((b) => b.userId === userId)?.birthDate ?? null;
  usePageMeta({ subtitle: allUsers.dataUpdatedAt ? `Updated ${formatTime(allUsers.dataUpdatedAt)}` : undefined });

  const refreshLists = () => {
    queryClient.invalidateQueries({ queryKey: ['all-users'] });
    queryClient.invalidateQueries({ queryKey: ['admin-users-pending'] });
  };

  const approveMut = useMutation({
    mutationFn: ({ userId, role }: { userId: number; role: string }) => approveUser(userId, role),
    onMutate: () => setActionError(null),
    onError: fail('Could not approve'),
    onSuccess: refreshLists,
  });
  const denyMut = useMutation({
    mutationFn: (userId: number) => denyUser(userId),
    onMutate: () => setActionError(null),
    onError: fail('Could not turn down the request'),
    onSuccess: () => {
      setDenying(null);
      refreshLists();
    },
  });
  const roleMut = useMutation({
    mutationFn: ({ userId, role }: { userId: number; role: string }) => updateUserRole(userId, role),
    onMutate: () => setActionError(null),
    onError: fail('Could not change the role'),
    onSuccess: () => {
      setManaging(null);
      queryClient.invalidateQueries({ queryKey: ['all-users'] });
    },
  });
  const disableMut = useMutation({
    mutationFn: (userId: number) => disableUser(userId),
    onMutate: () => setActionError(null),
    onError: fail('Could not turn off the account'),
    onSuccess: () => {
      setManaging(null);
      queryClient.invalidateQueries({ queryKey: ['all-users'] });
    },
  });
  const reactivateMut = useMutation({
    mutationFn: (userId: number) => reactivateUser(userId),
    onMutate: () => setActionError(null),
    onError: fail('Could not turn the account back on'),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['all-users'] }),
  });

  const approve = async (u: AdminUser, role: RoleKey) => {
    // Letting someone in as an admin hands them every admin page: ask first.
    if (role === 'ADMIN') {
      const ok = await confirm({
        title: `Let ${nameOf(u)} in as an admin?`,
        message: 'Admins see everything, including the admin pages, and can change anyone’s role.',
        confirmLabel: 'Approve as admin',
      });
      if (!ok) return;
    }
    approveMut.mutate({ userId: u.id, role });
  };

  const all = allUsers.data ?? [];
  const household = householdOf(all).sort(byRole);
  const guests = all.filter((u) => u.role === 'GUEST' && u.status === 'ACTIVE').sort(byRole);
  const pastGuests = all.filter((u) => u.role === 'GUEST' && u.status !== 'ACTIVE' && u.status !== 'PENDING_APPROVAL');
  const turnedOff = all.filter((u) => u.role !== 'GUEST' && (u.status === 'DISABLED' || u.status === 'EXPIRED'));
  const online = [...household, ...guests].filter((u) => u.isOnline);
  const pending = isAdmin ? pendingUsers.data ?? [] : [];

  const boardPeople: BoardPerson[] = [...household, ...guests].map((u) => ({
    key: u.id,
    name: nameOf(u),
    color: personColor(u),
    photoUrl: u.avatarUrl,
    state: u.isOnline ? 'Online' : 'Away',
    tone: u.isOnline ? 'ok' : 'neutral',
    away: !u.isOnline,
    // Short: a board cell is ~110px wide.
    when: u.isOnline ? (u.role === 'GUEST' ? 'Visiting' : 'Now') : u.lastLoginAt ? formatRelative(u.lastLoginAt) : 'Not yet',
  }));

  const onlineNames = online.map(nameOf);
  const verdictText = !allUsers.data
    ? 'Loading the household…'
    : onlineNames.length
      ? `${formatList(onlineNames)} ${onlineNames.length === 1 ? 'is' : 'are'} in the app.`
      : 'No one is in the app right now.';
  const waitingNote = pending.length
    ? ` ${formatList(pending.map(nameOf))} ${pending.length === 1 ? 'is' : 'are'} waiting for you to let them in.`
    : '';

  return (
    <Screen>
      {actionError && (
        <Notice tone="problem" live="assertive" action={<IconButton icon="x" variant="quiet" label="Dismiss" small onClick={() => setActionError(null)} />}>
          {actionError}
        </Notice>
      )}

      <InstrumentPanel
        instrument={
          <QueryState query={allUsers} what="the household" loading={<SkelRows count={2} />} isEmpty={() => boardPeople.length === 0}
            empty={<EmptyState compact icon="users" title="No one here yet">People show up here once they sign in.</EmptyState>}>
            {() => (
              <Stack gap="s" className="w-full">
                <Board strip label="Who's in the app now" people={boardPeople} />
                <p className="fp-small fp-muted inline-flex items-center gap-2 self-center">Lit: in the app now</p>
              </Stack>
            )}
          </QueryState>
        }
        verdict={
          <Verdict
            tone={pending.length ? 'headsup' : allUsers.isError && !allUsers.data ? 'problem' : 'ok'}
            note={
              allUsers.data
                ? `${plural(household.length, 'person', 'people')} in the household${guests.length ? `, ${plural(guests.length, 'guest')} visiting` : ''}.${waitingNote}`
                : undefined
            }
          >
            {allUsers.isError && !allUsers.data ? "Couldn't load the household." : verdictText}
          </Verdict>
        }
        readouts={
          <Readouts count={3}>
            <Readout
              label="Household"
              value={allUsers.data ? household.length : '—'}
              unit={household.length === 1 ? 'person' : 'people'}
              note={allUsers.data ? formatList(household.map(nameOf)) || 'No one yet' : undefined}
            />
            <Readout
              label="Online"
              tone={online.length ? 'ok' : 'neutral'}
              value={allUsers.data ? online.length : '—'}
              unit="now"
              note={allUsers.data ? (online.length ? `${formatList(onlineNames)}, in the app` : 'No one right now') : undefined}
            />
            <Readout
              label="Guests"
              value={allUsers.data ? guests.length : '—'}
              unit="active"
              note={allUsers.data ? (guests.length ? formatList(guests.map(nameOf)) : 'No guests right now') : undefined}
            />
          </Readouts>
        }
      />

      {isAdmin && (
        <Panel
          title="Asked to join"
          subtitle="Sign-ups wait here until you let them in"
          action={pending.length ? <Badge tone="headsup">{pending.length} waiting</Badge> : undefined}
        >
          <QueryState
            query={pendingUsers}
            what="sign-up requests"
            compact
            loading={<SkelRows count={1} />}
            empty={
              <EmptyState compact icon="check-circle" title="No one is waiting">
                When someone signs up, they show up here until you let them in or turn them down.
              </EmptyState>
            }
          >
            {(list) => (
              <List>
                {list.map((u) => (
                  <PendingRequest
                    key={u.id}
                    user={u}
                    busy={approveMut.isPending && approveMut.variables?.userId === u.id}
                    onApprove={(role) => approve(u, role)}
                    onDeny={() => setDenying(u)}
                  />
                ))}
              </List>
            )}
          </QueryState>
        </Panel>
      )}

      <Split ratio="even">
        <Stack gap="page">
          <Panel title="Household" subtitle="The people who live here">
            <QueryState
              query={allUsers}
              what="the household"
              loading={<SkelRows count={3} />}
              isEmpty={() => household.length === 0 && turnedOff.length === 0}
              empty={<EmptyState compact icon="users" title="No one in the household yet">Members show up here once an admin lets them in.</EmptyState>}
            >
              {() => (
                <>
                  {household.length > 0 ? (
                    <List>
                      {household.map((u) => (
                        <PersonRow
                          key={u.id}
                          user={u}
                          isAdmin={isAdmin}
                          isSelf={u.id === me?.userId}
                          resetOn={isAdmin && u.role === 'USER' && birthdayOf(u.id) != null}
                          onManage={() => setManaging(u)}
                        />
                      ))}
                    </List>
                  ) : (
                    <EmptyState compact icon="users" title="No active members">Turned-off accounts are listed below.</EmptyState>
                  )}
                  {turnedOff.length > 0 && (
                    <Disclosure
                      variant="row"
                      summary={`Show ${plural(turnedOff.length, 'turned-off account')}`}
                      openSummary="Hide turned-off accounts"
                    >
                      <List>
                        {turnedOff.map((u) => (
                          <Row
                            key={u.id}
                            lead={<Avatar name={nameOf(u)} color={personColor(u)} photoUrl={u.avatarUrl} away decorative />}
                            title={<>{nameOf(u)} <Tag>{roleLabel(u.role)}</Tag></>}
                            meta={`${accountStatus(u.status).label}${u.lastLoginAt ? ` · last signed in ${formatStamp(u.lastLoginAt)}` : ''}${isAdmin ? ` · ${plural(u.loginCount, 'sign-in')}` : ''}`}
                            trail={
                              isAdmin ? (
                                <Button
                                  size="sm"
                                  onClick={() => reactivateMut.mutate(u.id)}
                                  busy={reactivateMut.isPending && reactivateMut.variables === u.id}
                                  busyLabel="Turning on…"
                                >
                                  Turn back on
                                </Button>
                              ) : undefined
                            }
                          />
                        ))}
                      </List>
                    </Disclosure>
                  )}
                </>
              )}
            </QueryState>
          </Panel>
        </Stack>

        <Stack gap="page">
          <Panel
            title="Guests"
            subtitle="Visitors get 30 days, then their access ends by itself"
            action={isAdmin ? <LinkButton to="/admin/guests" size="sm" variant="quiet" iconEnd="arrow-right">Manage</LinkButton> : undefined}
          >
            <QueryState query={allUsers} what="the guests" loading={<SkelRows count={1} />} isEmpty={() => false}>
              {() => (
                <>
                  {guests.length > 0 ? (
                    <List>
                      {guests.map((u) => (
                        <PersonRow key={u.id} user={u} isAdmin={isAdmin} isSelf={u.id === me?.userId} onManage={() => setManaging(u)} />
                      ))}
                    </List>
                  ) : (
                    <EmptyState compact icon="id-card" title="No guests right now">
                      When a visitor signs in on the guest page, they show up here for their 30 days.
                    </EmptyState>
                  )}
                  {pastGuests.length > 0 && (
                    <Disclosure variant="row" summary={`Show ${plural(pastGuests.length, 'past guest')}`} openSummary="Hide past guests">
                      <List>
                        {pastGuests.map((u) => (
                          <Row
                            key={u.id}
                            lead={<Avatar name={nameOf(u)} color={personColor(u)} photoUrl={u.avatarUrl} away decorative />}
                            title={<>{nameOf(u)} <Tag>{roleLabel(u.role)}</Tag></>}
                            meta={u.lastLoginAt ? `Last here ${formatStamp(u.lastLoginAt)}` : 'Never signed in'}
                            trail={
                              <Stack gap="xs" className="items-end">
                                <Badge status={accountStatus(u.status)} />
                                {isAdmin && u.status === 'DISABLED' && (
                                  <Button size="sm" onClick={() => reactivateMut.mutate(u.id)} busy={reactivateMut.isPending && reactivateMut.variables === u.id}>
                                    Turn back on
                                  </Button>
                                )}
                              </Stack>
                            }
                          />
                        ))}
                      </List>
                    </Disclosure>
                  )}
                </>
              )}
            </QueryState>
          </Panel>

          <Panel flush aria-label="What each role can see">
            <Disclosure variant="row" summary="What each role can see" openSummary="Hide the roles">
              <List>
                <Row icon="shield" title="Admin" meta="Everything, plus Who's home, Guests, Activity log, App usage, Server health and Diagnostics." />
                <Row icon="user" title="Member" meta="Every everyday and house page, alerts on their phone, and linking a phone so the house knows they're home." />
                <Row icon="id-card" title="Guest" meta="Home, Utilities, Climate, Roomba, Guest Wi-Fi and People. No Cameras or Maintenance. Ends after 30 days." />
              </List>
            </Disclosure>
          </Panel>
        </Stack>
      </Split>

      {managing && (
        <ManageDialog
          user={managing}
          birthday={birthdayOf(managing.id)}
          savingRole={roleMut.isPending}
          disabling={disableMut.isPending}
          onClose={() => setManaging(null)}
          onSaveRole={(role) => roleMut.mutate({ userId: managing.id, role })}
          onDisable={() => disableMut.mutate(managing.id)}
        />
      )}

      <ConfirmDialog
        open={denying != null}
        eyebrow="Asked to join"
        title={`Turn down ${denying ? nameOf(denying) : ''}?`}
        tone="danger"
        confirmLabel="Turn down"
        cancelLabel="Keep waiting"
        busy={denyMut.isPending}
        busyLabel="Turning down…"
        onConfirm={() => denying && denyMut.mutate(denying.id)}
        onCancel={() => setDenying(null)}
      >
        The sign-up is deleted and {denying ? nameOf(denying) : 'they'} can't sign in. They can ask again from the sign-in page.
      </ConfirmDialog>
      {confirmDialog}
    </Screen>
  );
}

/** A sign-up waiting for an admin: who, when, which role to let them in as, Deny / Approve. */
function PendingRequest({ user, busy, onApprove, onDeny }: { user: AdminUser; busy: boolean; onApprove: (role: RoleKey) => void; onDeny: () => void }) {
  const [role, setRole] = useState<'USER' | 'ADMIN'>('USER');
  const name = nameOf(user);
  return (
    // A custom row in a panel's edge-to-edge list: it takes the panel's inset itself, as .fp-row does.
    <li className="px-[var(--apppanel-pad)] py-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="fp-person">
          <Avatar name={name} color={personColor(user)} photoUrl={user.avatarUrl} decorative />
          <span className="min-w-0">
            <span className="block font-semibold text-apptext">{name}</span>
            <span className="fp-small fp-muted block truncate">
              {visibleEmail(user, true) ? `${user.email} · ` : ''}asked {formatStamp(user.createdAt)}
            </span>
          </span>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-3">
          <span className="inline-flex items-center gap-2">
            <span className="fp-label" aria-hidden="true">Let in as</span>
            <Seg kind="radio" fit="inline" label={`Let ${name} in as`} value={role} onChange={setRole} options={APPROVE_OPTIONS} />
          </span>
          <span className="fp-btn-row">
            <Button variant="danger-quiet" onClick={onDeny}>Deny</Button>
            <Button variant="primary" icon="check" onClick={() => onApprove(role)} busy={busy} busyLabel="Approving…">Approve</Button>
          </span>
        </div>
      </div>
    </li>
  );
}

/** One person in the roster: face (lit while online), name and role, when they were last here. */
function PersonRow({ user, isAdmin, isSelf, resetOn, onManage }: { user: AdminUser; isAdmin: boolean; isSelf: boolean; resetOn?: boolean; onManage: () => void }) {
  const name = nameOf(user);
  const seen = user.isOnline ? 'Online now' : user.lastLoginAt ? `Last signed in ${lastSeen(user.lastLoginAt)}` : 'Not signed in yet';
  const meta = [
    isSelf ? `You · ${seen.charAt(0).toLowerCase()}${seen.slice(1)}` : seen,
    visibleEmail(user, isAdmin),
    isAdmin ? plural(user.loginCount, 'sign-in') : null,
    // Admins only (resetOn is never set otherwise): this member can use "Forgot password?".
    resetOn ? 'birthday reset on' : null,
  ].filter(Boolean).join(' · ');
  return (
    <Row
      lead={<Avatar name={name} color={personColor(user)} photoUrl={user.avatarUrl} lamp={user.isOnline ? 'ok' : undefined} decorative />}
      title={<>{name} <Tag>{roleLabel(user.role)}</Tag></>}
      meta={meta}
      // No manage key on your own row: an admin could otherwise demote or turn off themselves
      // and lose the admin pages for good (B-181).
      trail={isAdmin && !isSelf ? <IconButton icon="more" variant="quiet" label={`Manage ${name}`} onClick={onManage} /> : undefined}
    />
  );
}

/**
 * "Forgot password?" for one member: the birthday they prove who they are with on the sign-in
 * page. Set or change it (members only), or clear it to turn their reset off. Admins and guests
 * can't reset this way whatever is stored; a stale one (from before a role change) can be cleared.
 */
function ResetBirthday({ user, birthday }: { user: AdminUser; birthday: string | null }) {
  const queryClient = useQueryClient();
  const name = nameOf(user);
  const member = user.role === 'USER';
  const [draft, setDraft] = useState(birthday ?? '');
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Remount the picker when the stored date changes (saved or cleared) so it shows it.
  const [pickerKey, setPickerKey] = useState(0);
  // The sign-in page only offers "Forgot password?" while the server has it switched on.
  const config = useQuery({ queryKey: ['oidc-config'], queryFn: oidcConfig, staleTime: 60_000 });

  const save = useMutation({
    mutationFn: (date: string | null) => setBirthday(user.id, date),
    onMutate: () => {
      setError(null);
      setSaved(null);
    },
    onError: (err: unknown) => {
      const e = err as { response?: { data?: { error?: string } }; message?: string };
      setError(e?.response?.data?.error || e?.message || 'Could not save the birthday');
    },
    onSuccess: (result) => {
      setSaved(result.birthDate ? 'Saved.' : 'Cleared.');
      setDraft(result.birthDate ?? '');
      setPickerKey((k) => k + 1);
      queryClient.invalidateQueries({ queryKey: ['admin-user-birthdays'] });
    },
  });

  if (!member) {
    return (
      <Stack gap="s">
        <p className="fp-label">Forgot password</p>
        <p className="fp-small fp-muted">
          A birthday is saved for {name}, but only members can reset their password with one. Clearing it removes it.
        </p>
        <div>
          <Button variant="danger-quiet" busy={save.isPending} busyLabel="Clearing…" onClick={() => save.mutate(null)}>
            Clear birthday
          </Button>
        </div>
        {error && <Notice tone="problem" live="assertive">{error}</Notice>}
      </Stack>
    );
  }

  return (
    <Stack gap="s">
      <p className="fp-label">Forgot password</p>
      <p className="fp-small fp-muted">
        {birthday
          ? `${name} can choose a new Home password from the sign-in page with their username and birthday, ${formatBirthday(birthday)}. Only admins see it.`
          : `Save ${name}'s birthday so they can choose a new Home password from the sign-in page if they forget it. Only admins see it.`}
      </p>
      {config.data && !config.data.passwordReset && (
        <Notice tone="headsup" title="Password reset is switched off.">
          The sign-in page hides “Forgot password?” until the home server can reach Home’s users file (AUTHELIA_USERS_FILE).
        </Notice>
      )}
      <BirthdayInput
        key={pickerKey}
        legend={`${name}'s birthday`}
        defaultValue={birthday ?? undefined}
        onChange={(iso) => {
          setDraft(iso);
          setSaved(null);
        }}
        disabled={save.isPending}
      />
      <span className="fp-btn-row">
        <Button
          variant="primary"
          icon="check"
          disabled={!draft || draft === birthday}
          busy={save.isPending && save.variables != null}
          busyLabel="Saving…"
          onClick={() => save.mutate(draft)}
        >
          {birthday ? 'Change birthday' : 'Save birthday'}
        </Button>
        {birthday && (
          <Button variant="danger-quiet" busy={save.isPending && save.variables == null} busyLabel="Clearing…" onClick={() => save.mutate(null)}>
            Clear
          </Button>
        )}
      </span>
      {saved && !error && <p className="fp-small fp-muted" role="status">{saved}</p>}
      {error && <Notice tone="problem" live="assertive">{error}</Notice>}
      <ClearResetTries userId={user.id} name={name} />
    </Stack>
  );
}

/**
 * Lifts a member's pause after too many wrong birthdays (an hour, or a day). Clearing the
 * birthday doesn't, and anyone who knows the username can cause one.
 */
function ClearResetTries({ userId, name }: { userId: number; name: string }) {
  const clear = useMutation({ mutationFn: () => clearResetTries(userId) });
  return (
    <Stack gap="xs">
      <p className="fp-small fp-muted">
        Too many wrong birthdays pause {name}’s resets for an hour, or a day.{' '}
        <Button variant="quiet" size="sm" busy={clear.isPending} busyLabel="Clearing…" onClick={() => clear.mutate()}>
          Clear wrong tries
        </Button>
      </p>
      {clear.isSuccess && <p className="fp-small fp-muted" role="status">Cleared. {name} can try again now.</p>}
      {clear.isError && <Notice tone="problem" live="assertive">Couldn’t clear the wrong tries. Try again.</Notice>}
    </Stack>
  );
}

/**
 * Manage one person (admins, never on their own account): their role, chosen and then saved
 * (it used to save the moment it was picked; B-181), and turning the account off, behind a
 * confirmation.
 */
function ManageDialog({
  user,
  birthday,
  savingRole,
  disabling,
  onClose,
  onSaveRole,
  onDisable,
}: {
  user: AdminUser;
  /** The stored reset birthday (yyyy-MM-dd), or null. */
  birthday: string | null;
  savingRole: boolean;
  disabling: boolean;
  onClose: () => void;
  onSaveRole: (role: RoleKey) => void;
  onDisable: () => void;
}) {
  const name = nameOf(user);
  const current = (['ADMIN', 'USER', 'GUEST'].includes(user.role) ? user.role : 'USER') as RoleKey;
  const [role, setRole] = useState<RoleKey>(current);
  const [confirmOff, setConfirmOff] = useState(false);
  const [confirm, confirmDialog] = useConfirm();
  const save = async () => {
    // Making or unmaking an admin changes who can reach the admin pages: ask first.
    if (role === 'ADMIN' || current === 'ADMIN') {
      const ok = await confirm({
        title: role === 'ADMIN' ? `Make ${name} an admin?` : `Take admin away from ${name}?`,
        message:
          role === 'ADMIN'
            ? 'Admins see everything, including the admin pages, and can change anyone’s role.'
            : `${name} loses the admin pages at once and becomes ${role === 'GUEST' ? 'a guest' : 'a member'}.`,
        confirmLabel: role === 'ADMIN' ? 'Make admin' : 'Change role',
        tone: role === 'ADMIN' ? 'default' : 'danger',
      });
      if (!ok) return;
    }
    onSaveRole(role);
  };
  const guest = user.role === 'GUEST';
  const email = visibleEmail(user, true);
  return (
    <>
      <Dialog
        open
        onClose={onClose}
        size="narrow"
        eyebrow="People"
        title={`Manage ${name}`}
        subtitle={email ?? (guest ? 'Guest · joined from the guest page' : undefined)}
        closeOnBackdrop={role === current}
        footer={
          <>
            <Button variant="quiet" onClick={onClose}>Cancel</Button>
            <Button variant="primary" disabled={role === current} busy={savingRole} busyLabel="Saving…" onClick={save}>
              Save role
            </Button>
          </>
        }
      >
        <Stack gap="l">
          <div className="fp-person">
            <Avatar name={name} color={personColor(user)} photoUrl={user.avatarUrl} size="lg" decorative />
            <span className="fp-small fp-muted">
              {user.isOnline ? 'Online now' : user.lastLoginAt ? `Last signed in ${formatStamp(user.lastLoginAt)}` : 'Not signed in yet'}
              {' · '}
              {plural(user.loginCount, 'sign-in')}
            </span>
          </div>
          <Fieldset legend="Role">
            <Seg kind="radio" fit="fill" label={`Role for ${name}`} value={role} onChange={setRole} options={ROLE_OPTIONS} />
            <p className="fp-small fp-muted mt-2">Admins also get the admin pages. Guests can't see Cameras or Maintenance.</p>
          </Fieldset>
          {(user.role === 'USER' || birthday) && <ResetBirthday user={user} birthday={birthday} />}
          {user.status === 'ACTIVE' && (
            <Stack gap="s">
              <p className="fp-label">Access</p>
              <p className="fp-small fp-muted">
                {guest
                  ? `Turning off ${name}'s access signs them out now, before the 30 days are up.`
                  : `Turning off the account signs ${name} out everywhere. You can turn it back on any time.`}
              </p>
              <div>
                <Button variant="danger-quiet" icon="lock" onClick={() => setConfirmOff(true)}>
                  {guest ? `End ${name}'s access` : `Turn off ${name}'s account`}
                </Button>
              </div>
            </Stack>
          )}
        </Stack>
        {/* Inside the dialog, so the confirmation stacks on it (one focus trap, one Back). */}
          <ConfirmDialog
            open={confirmOff}
            eyebrow="People"
            tone="danger"
            title={guest ? `End ${name}'s access?` : `Turn off ${name}'s account?`}
            confirmLabel={guest ? 'End access' : 'Turn off account'}
            cancelLabel="Keep it on"
            busy={disabling}
            busyLabel="Turning off…"
            onConfirm={onDisable}
            onCancel={() => setConfirmOff(false)}
          >
            {name} will be signed out on every device and won't be able to sign in. Settings and alert choices are kept, so
            turning the account back on picks up where it left off.
          </ConfirmDialog>
        {confirmDialog}
      </Dialog>
    </>
  );
}
