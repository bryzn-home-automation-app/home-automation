import { describe, it, expect } from 'vitest';
import type { DailyUsagePoint, RoombaRun, RoombaStatus, Thermostat, WeatherHour } from '../types';
import type { Notification } from '../api/notifications';
import {
  alertMeta, attentionItems, climateLine, homeRoomba, homeVerdict, lastRunWords, latestCompleteDay, rainWindow,
  roombaDetail, thermostatWords,
} from '../pages/home/summary';
import { roombaState } from '../utils/roombaStatus';
import { homeHourKey, isNightAt, nextHours, weatherIcon } from '../utils/weather';

// "Now" for these tests: Mon Nov 9 2026, 2:10 PM at home (20:10 UTC).
const NOW = '2026-11-09T20:10:00Z';
const norm = (s: string) => s.replace(/ /g, ' ');

function robot(over: Partial<RoombaStatus> = {}): RoombaStatus {
  return {
    robotId: 'r', name: 'Rosie', batteryPct: 100, phase: 'charge', cycle: 'none', error: null, errorText: null,
    running: false, binPresent: true, tankPresent: null, currentMissionId: null, missionStart: null, sqft: null,
    runtimeMinutes: null, dockState: null, dockError: null, dockText: null, notReady: null, initiator: null,
    detectedPad: null, chargeCycles: null, chargeErrors: null, faultText: null, wear: null, lifetimeMissions: null,
    lifetimeRunMinutes: null, mapVersion: null, online: true, needsAttention: false, attentionReasons: [],
    updatedAt: '2026-11-09T20:05:00Z', ...over,
  };
}

function run(over: Partial<RoombaRun> = {}): RoombaRun {
  return {
    id: 1, startedAt: '2026-11-08T14:00:00Z', completedAt: '2026-11-08T15:00:00Z', durationMinutes: 60,
    squareFeet: 1124, status: 'COMPLETED', missionId: null, missionNumber: null, error: null, errorText: null,
    initiator: null, cycle: null, source: null, chargeMinutes: null, ...over,
  } as RoombaRun;
}

function thermostat(over: Partial<Thermostat> = {}): Thermostat {
  return {
    id: 't', name: 'Downstairs', available: true, temperature: 71, humidity: 40, targetTemperature: null,
    heatSetpoint: 68, coolSetpoint: 75, hvacMode: 'heat_cool', hvacAction: 'idle', presetMode: 'home',
    temperatureUnit: 'F', minTemp: 45, maxTemp: 92, hvacModes: [], presetModes: [], updatedAt: null, lastChange: null,
    ...over,
  };
}

function hour(time: string, pop: number): WeatherHour {
  return { time, temperature: 60, apparentTemperature: 59, humidity: 50, precipitation: 0, precipitationProbability: pop, windSpeed: 5, weatherCode: 3 };
}

describe('Roomba on Home', () => {
  it('says Offline with when it was last seen once the data is stale (B-070)', () => {
    const rb = robot({ online: false, phase: 'run', running: true, sqft: 312, updatedAt: '2026-11-09T18:10:00Z' });
    const h = homeRoomba(rb, null, NOW);
    expect(h.state.label).toBe('Offline');
    expect(h.tone).toBe('headsup');
    expect(roombaDetail(rb, null, NOW)).toBe('Last seen cleaning, 2 hr ago');
    expect(h.line).toBe('Offline. Last seen cleaning, 2 hr ago');
    // A stale robot that also had its "needs a look" flag up still reads Offline, not its old reason.
    expect(homeRoomba({ ...rb, needsAttention: true, attentionReasons: ['Bin full'] }, null, NOW).line).toBe('Offline. Last seen cleaning, 2 hr ago');
    expect(roombaDetail(robot({ online: false, updatedAt: '2026-11-08T18:00:00Z' }), null, NOW)).toBe('Last seen yesterday');
  });

  it('does not call the bin emptying "Cleaning" (B-140)', () => {
    const rb = robot({ phase: 'evac', running: true });
    const h = homeRoomba(rb, null, NOW);
    expect(h.state.label).toBe('Emptying the bin');
    expect(h.state.cleaning).toBe(false);
    expect(h.line).toBe('Emptying the bin. Emptying the bin at the dock');
  });

  it('a docked robot reads Docked, not Idle (B-065)', () => {
    expect(homeRoomba(robot(), null, NOW)).toMatchObject({ tone: 'ok', state: { label: 'Docked' } });
  });

  it('raises the tone, not the word, when the robot asks for a look', () => {
    const h = homeRoomba(robot({ needsAttention: true, attentionReasons: ['Clean the brushes'] }), null, NOW);
    expect(h.tone).toBe('headsup');
    expect(h.line).toBe('Docked. Clean the brushes');
  });

  it('says the same as the Roomba page for every phase (one helper, B-070 / B-140)', () => {
    const cases: Partial<RoombaStatus>[] = [
      {}, { phase: 'run', cycle: 'clean', running: true }, { phase: 'evac', cycle: 'clean', running: true },
      { phase: 'charge', cycle: 'clean' }, { phase: 'stop', cycle: 'clean' }, { phase: 'hmPostMsn', cycle: 'clean' },
      { phase: 'stuck', error: 17, errorText: 'Wheel stuck' }, { online: false, phase: 'run', running: true },
    ];
    for (const c of cases) {
      const rb = robot(c);
      expect(homeRoomba(rb, null, NOW).state).toEqual(roombaState(rb, new Date(NOW)));
    }
  });

  it('waits for a first reading without a status word', () => {
    expect(homeRoomba(null, null, NOW)).toMatchObject({ tone: 'neutral', line: 'Waiting for the robot to check in' });
  });

  it('names how the last run ended (B-069)', () => {
    expect(norm(lastRunWords(run())!)).toBe('Last cleaned Nov 8, 1,124 sq ft');
    expect(norm(lastRunWords(run({ status: 'CANCELLED', squareFeet: 14 }))!)).toBe('Last run cancelled Nov 8');
    expect(norm(lastRunWords(run({ status: 'STUCK' }))!)).toBe('Last run got stuck Nov 8');
    expect(norm(lastRunWords(run({ status: 'INCOMPLETE' }))!)).toBe('Last run ended early Nov 8');
  });
});

describe('Climate words', () => {
  it('says what each thermostat is doing', () => {
    expect(thermostatWords(thermostat())).toBe('71°, idle');
    expect(thermostatWords(thermostat({ temperature: 69, hvacAction: 'heating', heatSetpoint: 70 }))).toBe('69°, heating to 70°');
    expect(thermostatWords(thermostat({ available: false }))).toBe('not answering');
    expect(climateLine([thermostat(), thermostat({ name: 'Upstairs', temperature: 69, hvacAction: 'heating', heatSetpoint: 70 })]))
      .toBe('Downstairs 71°, idle. Upstairs 69°, heating to 70°');
  });
});

describe('Electric', () => {
  it('uses the same complete-day threshold as the Electric tab (B-081)', () => {
    const days: DailyUsagePoint[] = [
      { date: '2026-11-07', totalKwh: 48, readingCount: 24, sourceProvider: 'x' },
      { date: '2026-11-08', totalKwh: 12, readingCount: 9, sourceProvider: 'x' },
    ];
    expect(latestCompleteDay(days)?.date).toBe('2026-11-07');
    expect(latestCompleteDay([])).toBeNull();
  });
});

describe('Weather', () => {
  it('builds the current hour on the home clock, whatever the device zone (B-073)', () => {
    expect(homeHourKey(NOW)).toBe('2026-11-09T14:00');
    const hourly = ['2026-11-09T12:00', '2026-11-09T13:00', '2026-11-09T14:00', '2026-11-09T15:00'].map((t) => hour(t, 0));
    expect(nextHours(hourly, 6, NOW).map((h) => h.time)).toEqual(['2026-11-09T14:00', '2026-11-09T15:00']);
  });

  it('uses sunrise and sunset at home for night, not a fixed 8 PM (B-072)', () => {
    const place = { lat: 33.215, lon: -97.133 };
    // Sunset is about 5:30 PM in November: 6:30 PM is night, 4 PM is day.
    expect(isNightAt('2026-11-09T18:30', place)).toBe(true);
    expect(isNightAt('2026-11-09T16:00', place)).toBe(false);
    expect(isNightAt('2026-11-09T07:30', place)).toBe(false);
    expect(weatherIcon(0, isNightAt('2026-11-09T18:30', place))).toBe('moon');
    // No location: the old fixed rule.
    expect(isNightAt('2026-11-09T18:30', null)).toBe(false);
    expect(isNightAt('2026-11-09T21:00', null)).toBe(true);
  });

  it('names the first stretch of likely rain', () => {
    const hrs = [hour('2026-11-09T23:00', 20), hour('2026-11-10T00:00', 60), hour('2026-11-10T01:00', 80), hour('2026-11-10T02:00', 30)];
    const w = rainWindow(hrs)!;
    expect(norm(w.text)).toBe('from midnight to 2 AM');
    expect(norm(w.range)).toBe('Midnight – 2 AM');
    expect([w.from, w.to]).toEqual([0, 2]);
    const am = rainWindow([hour('2026-11-10T00:00', 10), hour('2026-11-10T01:00', 70), hour('2026-11-10T02:00', 10)])!;
    expect(norm(am.text)).toBe('from 1 to 2 AM');
    expect(norm(rainWindow([hour('2026-11-09T14:00', 90), hour('2026-11-09T15:00', 10)])!.text)).toBe('until 3 PM');
    expect(rainWindow([hour('2026-11-09T14:00', 10)])).toBeNull();
  });
});

describe('Needs a look and the verdict', () => {
  const alert = (over: Partial<Notification>): Notification => ({
    id: 1, userId: 1, category: 'ELECTRICAL', severity: 'INFO', title: 'Daily report', message: '', isRead: false,
    createdAt: '2026-11-09T14:05:00Z', ...over,
  });

  it('is all quiet when nothing needs anyone', () => {
    const items = attentionItems({ roomba: robot(), thermostats: [thermostat()], alerts: [alert({})], now: NOW });
    expect(items).toEqual([]);
    expect(homeVerdict(items)).toEqual({ tone: 'ok', text: 'All quiet at home.' });
  });

  it('lists the robot, a silent thermostat and unread warnings, worst first', () => {
    const items = attentionItems({
      roomba: robot({ needsAttention: true, attentionReasons: ['Dock bag is full'] }),
      thermostats: [thermostat({ name: 'Upstairs', available: false })],
      alerts: [alert({ severity: 'CRITICAL', title: 'Home server storage is 92% full', category: 'SYSTEM' })],
      latestDay: { date: '2026-11-04', totalKwh: 30, readingCount: 24, sourceProvider: 'x' },
      now: NOW,
    });
    expect(items.map((i) => i.title)).toEqual([
      'Home server storage is 92% full',
      'Dock bag is full',
      "The Upstairs thermostat isn't answering",
      'Electric readings are behind',
    ]);
    expect(items[0].tone).toBe('problem');
    expect(homeVerdict(items)).toEqual({ tone: 'problem', text: 'A few things need a look.' });
  });

  it('captions an alert with its topic in words and when (B-068)', () => {
    expect(norm(alertMeta(alert({ category: 'SYSTEM' }), NOW))).toBe('Home server · 8:05 AM');
  });
});
