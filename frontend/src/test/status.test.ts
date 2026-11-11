import { describe, expect, it } from 'vitest';
import { ROLE_LABEL as SHELL_ROLE_LABEL } from '../routes';
import {
  accountStatus,
  batteryStatus,
  checkStatus,
  deviceLinkStatus,
  eventLevelStatus,
  guestSessionStatus,
  humanize,
  jobStatus,
  kitTone,
  notificationCategory,
  onlineStatus,
  priorityStatus,
  roleLabel,
  ROLE_LABEL,
  roombaPhaseStatus,
  severityStatus,
  TONE_WORD,
  worstTone,
} from '../utils/status';

describe('status words', () => {
  it('has exactly the four Faceplate words plus neutral', () => {
    expect(TONE_WORD).toEqual({ ok: 'OK', headsup: 'Heads-up', problem: 'Problem', info: 'Info', neutral: 'No status' });
  });

  it("maps a tone to the kit's class suffix", () => {
    expect(kitTone('headsup')).toBe('warn');
    expect(kitTone('problem')).toBe('problem');
    expect(kitTone('neutral')).toBe('');
  });

  it('sums up a list by its worst row', () => {
    expect(worstTone(['ok', 'info', 'headsup'])).toBe('headsup');
    expect(worstTone(['headsup', 'problem', 'ok'])).toBe('problem');
    expect(worstTone([])).toBe('neutral');
  });

  it('tidies unknown enum values into words', () => {
    expect(humanize('PENDING_APPROVAL')).toBe('Pending approval');
    expect(humanize('hmPostMsn')).toBe('Hm post msn');
    expect(humanize(null)).toBe('');
  });
});

describe('roles (B-053)', () => {
  it('says Admin / Member / Guest everywhere', () => {
    expect(roleLabel('ADMIN')).toBe('Admin');
    expect(roleLabel('USER')).toBe('Member');
    expect(roleLabel('GUEST')).toBe('Guest');
    expect(roleLabel('guest')).toBe('Guest');
    expect(roleLabel(undefined)).toBe('');
  });

  it("agrees with the shell's copy in routes.ts", () => {
    expect(SHELL_ROLE_LABEL).toEqual(ROLE_LABEL);
  });
});

describe('server enums', () => {
  it('maps notification severity to the four words', () => {
    expect(severityStatus('CRITICAL')).toEqual({ tone: 'problem', label: 'Problem' });
    expect(severityStatus('WARNING')).toEqual({ tone: 'headsup', label: 'Heads-up' });
    expect(severityStatus('INFO')).toEqual({ tone: 'info', label: 'Info' });
    expect(severityStatus('SUCCESS')).toEqual({ tone: 'ok', label: 'OK' });
    expect(severityStatus(null)).toEqual({ tone: 'info', label: 'Info' });
  });

  it('gives categories a label and nav icon but no colour', () => {
    expect(notificationCategory('ELECTRICAL')).toEqual({ label: 'Electric', icon: 'bolt' });
    expect(notificationCategory('WIFI')).toEqual({ label: 'Guest Wi-Fi', icon: 'wifi' });
    expect(notificationCategory('SOMETHING_NEW')).toEqual({ label: 'Something new', icon: 'bell' });
    expect(notificationCategory(undefined)).toEqual({ label: 'General', icon: 'bell' });
  });

  it('maps accounts, guest visits and device links', () => {
    expect(accountStatus('PENDING_APPROVAL')).toEqual({ tone: 'headsup', label: 'Waiting for approval' });
    expect(accountStatus('ACTIVE').tone).toBe('ok');
    expect(accountStatus('DISABLED')).toEqual({ tone: 'neutral', label: 'Turned off' });
    expect(guestSessionStatus('REVOKED')).toEqual({ tone: 'neutral', label: 'Ended' });
    expect(deviceLinkStatus('LINKED')).toEqual({ tone: 'ok', label: 'Linked' });
  });

  it('maps diagnostics levels and checks', () => {
    expect(eventLevelStatus('ERROR')).toEqual({ tone: 'problem', label: 'Failed' });
    expect(eventLevelStatus('WARN')).toEqual({ tone: 'headsup', label: 'Warning' });
    expect(eventLevelStatus('INFO')).toEqual({ tone: 'ok', label: 'OK' });
    expect(checkStatus('critical').tone).toBe('problem');
    expect(checkStatus('warning').tone).toBe('headsup');
    expect(checkStatus('WARN').tone).toBe('headsup');
  });

  it('maps maintenance priority and status (enum only)', () => {
    expect(priorityStatus('EMERGENCY')).toEqual({ tone: 'problem', label: 'Urgent' });
    expect(priorityStatus('MEDIUM')).toEqual({ tone: 'neutral', label: 'Normal' });
    expect(jobStatus('COMPLETED')).toEqual({ tone: 'ok', label: 'Done' });
    expect(jobStatus('IN_PROGRESS')).toEqual({ tone: 'headsup', label: 'In progress' });
  });

  it('leaves an unknown value neutral and readable, never blank', () => {
    expect(accountStatus('ON_HOLD')).toEqual({ tone: 'neutral', label: 'On hold' });
  });
});

describe('Roomba phase', () => {
  const base = { phase: null as string | null, cycle: 'none', error: 0, running: false };

  it('says the bin is emptying, not cleaning, during evac (B-140)', () => {
    expect(roombaPhaseStatus({ ...base, phase: 'evac', cycle: 'clean', running: true })).toEqual({ tone: 'info', label: 'Emptying the bin' });
  });

  it('tells a mid-clean recharge from a finished one', () => {
    expect(roombaPhaseStatus({ ...base, phase: 'charge', cycle: 'clean' }).label).toBe('Recharging to finish');
    expect(roombaPhaseStatus({ ...base, phase: 'charge', cycle: 'none' })).toEqual({ tone: 'ok', label: 'Docked' });
  });

  it('puts an error first', () => {
    expect(roombaPhaseStatus({ ...base, phase: 'run', error: 17, errorText: 'Wheel stuck' })).toEqual({ tone: 'problem', label: 'Wheel stuck' });
    expect(roombaPhaseStatus({ ...base, phase: 'stuck' }).tone).toBe('problem');
  });

  it('covers cleaning, heading home, pauses and nothing yet', () => {
    expect(roombaPhaseStatus({ ...base, phase: 'run', cycle: 'clean', running: true })).toEqual({ tone: 'info', label: 'Cleaning' });
    expect(roombaPhaseStatus({ ...base, phase: 'hmPostMsn' }).label).toBe('Heading home');
    expect(roombaPhaseStatus({ ...base, phase: 'stop', cycle: 'clean' })).toEqual({ tone: 'headsup', label: 'Paused' });
    expect(roombaPhaseStatus({ ...base, phase: 'stop' })).toEqual({ tone: 'neutral', label: 'Stopped' });
    expect(roombaPhaseStatus(null)).toEqual({ tone: 'neutral', label: 'No status yet' });
  });

  it('flags a dock that needs a look', () => {
    expect(roombaPhaseStatus({ ...base, phase: 'charge', dockError: 3, dockText: 'Bag full' })).toEqual({ tone: 'headsup', label: 'Dock: Bag full' });
  });
});

describe('devices', () => {
  it('grades batteries: heads-up under 30%, a problem under 15%', () => {
    expect(batteryStatus(87)).toEqual({ tone: 'ok', label: '87%' });
    expect(batteryStatus(27)).toEqual({ tone: 'headsup', label: '27%' });
    expect(batteryStatus(9)).toEqual({ tone: 'problem', label: '9%' });
    expect(batteryStatus(9, true)).toEqual({ tone: 'ok', label: '9%, charging' });
    expect(batteryStatus(null).tone).toBe('neutral');
  });

  it('says online or offline', () => {
    expect(onlineStatus(true)).toEqual({ tone: 'ok', label: 'Online' });
    expect(onlineStatus(false)).toEqual({ tone: 'problem', label: 'Offline' });
    expect(onlineStatus(undefined).tone).toBe('neutral');
  });
});
