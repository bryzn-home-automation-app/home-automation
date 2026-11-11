import type { AdminUser, GuestSession } from '../../api/auth';
import type { Tone } from '../../utils/status';
import { activityText } from '../../utils/thermostat';
import { toInstant } from '../../utils/format';
import type { ThermostatActivity } from '../../types';

/*
 * The Activity log's rows, built from what the server actually records: each person's
 * latest sign-in, when accounts were created and approved, guest check-ins, and thermostat
 * changes. Nothing else is logged, so nothing else is shown (B-169: the old page listed kinds
 * such as "Role changed" that could never occur).
 */

export type LogKind = 'login' | 'register' | 'approved' | 'guest_connect' | 'thermostat';

export interface LogEntry {
  id: string;
  /** As the server sent it (passed raw to utils/format). */
  timestamp: string;
  kind: LogKind;
  /** The sentence: "Mai signed in", "Upstairs set to 70° by Mai". */
  description: string;
  /** Who did it, when it was a person. */
  actor: string | null;
  /** One line of context under the sentence. */
  meta: string;
}

/** The filter a kind belongs to. */
export type LogGroup = 'thermostat' | 'signin' | 'guest' | 'account';
export const KIND_GROUP: Record<LogKind, LogGroup> = {
  login: 'signin',
  register: 'account',
  approved: 'account',
  guest_connect: 'guest',
  thermostat: 'thermostat',
};

/** A row's lamp: a request waiting on the admin is a heads-up; the rest are plain facts. */
export function kindTone(e: LogEntry, waiting: boolean): Tone {
  if (e.kind === 'register' && waiting) return 'headsup';
  if (e.kind === 'approved' || e.kind === 'guest_connect') return 'ok';
  if (e.kind === 'thermostat') return 'info';
  return 'neutral';
}

const nameOf = (u: AdminUser) => u.displayName || u.username;

export function buildActivityLog(users: AdminUser[], sessions: GuestSession[], thermostats: ThermostatActivity[]): LogEntry[] {
  const logs: LogEntry[] = [];

  for (const u of users) {
    const name = nameOf(u);
    if (u.lastLoginAt) {
      logs.push({ id: `login-${u.id}`, timestamp: u.lastLoginAt, kind: 'login', description: `${name} signed in`, actor: name, meta: 'Sign-in · their latest' });
    }
    // The account's creation, at the moment it was created (B-034). A guest isn't "approved":
    // the guest page makes the account itself.
    const guest = u.role === 'GUEST';
    logs.push({
      id: `register-${u.id}`,
      timestamp: u.createdAt,
      kind: 'register',
      description: guest
        ? `${name} joined as a guest`
        : u.status === 'PENDING_APPROVAL'
          ? `${name} asked to join`
          : `${name} registered`,
      actor: name,
      meta: u.status === 'PENDING_APPROVAL' ? 'Account · waiting for approval in People' : 'Account',
    });
    // Approval only when it really happened, at its own time; worded without a role because
    // the role shown today may not be the one given then.
    if (u.approvedAt) {
      logs.push({ id: `approved-${u.id}`, timestamp: u.approvedAt, kind: 'approved', description: `${name} was approved`, actor: name, meta: 'Account' });
    }
  }

  for (const s of sessions) {
    logs.push({
      id: `connect-${s.id}`,
      timestamp: s.connectedAt,
      kind: 'guest_connect',
      description: `${s.guestName} connected as a guest`,
      actor: s.guestName,
      meta: `Guest · ${s.ipAddress}`,
    });
  }

  for (const a of thermostats) {
    const c = a.change;
    const person = c.actor !== 'ecobee' && c.actor !== 'schedule' && c.actor !== 'home_assistant';
    logs.push({
      id: `thermostat-${a.thermostatId}-${c.at}`,
      timestamp: c.at,
      kind: 'thermostat',
      description: activityText(a),
      actor: person ? c.by : null,
      meta: person ? 'Thermostat · from the app' : c.actor === 'schedule' ? 'Thermostat · by its schedule' : c.actor === 'ecobee' ? 'Thermostat · by hand, on the wall' : 'Thermostat · by Home Assistant',
    });
  }

  return logs.sort((a, b) => (toInstant(b.timestamp) ?? 0) - (toInstant(a.timestamp) ?? 0));
}
