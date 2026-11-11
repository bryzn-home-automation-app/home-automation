import { describe, it, expect } from 'vitest';
import {
  getWeatherCodeDescription,
  getWeatherEmoji,
  getDominantWeatherEmoji,
  isNightTime,
  buildWeek,
  daysFromHourly,
  shiftDayKey,
  weekScale,
  weekSummary,
} from '../utils/weather';
import type { WeatherHour, WeatherOutlookDay } from '../types';

describe('getWeatherCodeDescription', () => {
  it('should return correct description for clear sky (code 0)', () => {
    expect(getWeatherCodeDescription(0)).toBe('Clear sky');
  });

  it('should return correct description for partly cloudy (code 2)', () => {
    expect(getWeatherCodeDescription(2)).toBe('Partly cloudy');
  });

  it('should return correct description for thunderstorm (code 95)', () => {
    expect(getWeatherCodeDescription(95)).toBe('Thunderstorm');
  });

  it('should return correct description for heavy rain (code 65)', () => {
    expect(getWeatherCodeDescription(65)).toBe('Heavy rain');
  });

  it('should return correct description for snow (code 73)', () => {
    expect(getWeatherCodeDescription(73)).toBe('Moderate snow');
  });

  it('should return "Unknown" for unmapped codes', () => {
    expect(getWeatherCodeDescription(999)).toBe('Unknown');
  });
});

describe('getWeatherEmoji', () => {
  it('should return day or night emoji for clear sky (0)', () => {
    const e = getWeatherEmoji(0);
    expect(['☀️', '🌙']).toContain(e);
  });

  it('should return rain emoji (63) regardless of time', () => {
    expect(getWeatherEmoji(63)).toBe('🌧️');
  });

  it('should return thunderstorm emoji (95) regardless of time', () => {
    expect(getWeatherEmoji(95)).toBe('⛈️');
  });

  it('should return day/night snow emoji (75)', () => {
    expect(getWeatherEmoji(75)).toBe('❄️');
  });

  it('should return 🌡️ for unknown codes', () => {
    expect(getWeatherEmoji(999)).toBe('🌡️');
  });

  it('should return 🌙 at night for clear sky', () => {
    const night = isNightTime();
    if (night) {
      expect(getWeatherEmoji(0)).toBe('🌙');
    }
  });

  it('should return ☀️ during day for clear sky', () => {
    const night = isNightTime();
    if (!night) {
      expect(getWeatherEmoji(0)).toBe('☀️');
    }
  });
});

describe('getDominantWeatherEmoji', () => {
  it('should return the most frequent weather emoji (day/night-aware)', () => {
    const codes = [0, 0, 0, 61, 61];
    const emoji = getDominantWeatherEmoji(codes);
    expect(['☀️', '🌙']).toContain(emoji);
  });

  it('should return default emoji for empty array', () => {
    const emoji = getDominantWeatherEmoji([]);
    expect(['🌡️']).toContain(emoji);
  });

  it('should return emoji for single code', () => {
    expect(getDominantWeatherEmoji([95])).toBe('⛈️');
  });
});

// ── The week ahead (Home's Week view) ──────────────────────────────────

const NBSP_RE = / /g;
// 2:10 PM at home on Wed, Nov 11, 2026 (20:10 UTC, CST).
const NOW = '2026-11-11T20:10:00Z';

function day(date: string, hi: number | null, lo: number | null, pop: number | null = 10, extra: Partial<WeatherOutlookDay> = {}): WeatherOutlookDay {
  return {
    date, maxTemperature: hi, minTemperature: lo, precipitationProbability: pop, precipitation: 0,
    weatherCode: 2, sunrise: `${date}T06:58`, sunset: `${date}T17:26`, windSpeedMax: 9, ...extra,
  };
}

function hoursFor(date: string, temps: (h: number) => number, from = 0, to = 23): WeatherHour[] {
  const out: WeatherHour[] = [];
  for (let h = from; h <= to; h++) {
    out.push({
      time: `${date}T${String(h).padStart(2, '0')}:00`, temperature: temps(h), apparentTemperature: temps(h),
      humidity: 50, precipitation: h === 15 ? 0.2 : 0, precipitationProbability: h === 15 ? 70 : 5, windSpeed: 4 + h / 4, weatherCode: h >= 14 && h <= 17 ? 61 : 1,
    });
  }
  return out;
}

const SEVEN = [
  day('2026-11-11', 68, 48),
  day('2026-11-12', 61, 50, 80, { precipitation: 0.62, weatherCode: 63 }),
  day('2026-11-13', 55, 41, 65, { precipitation: 0.15, weatherCode: 61 }),
  day('2026-11-14', 70, 46, 5),
  day('2026-11-15', 74, 52, 0),
  day('2026-11-16', 66, 49, 20),
  day('2026-11-17', 63, 45, 10),
];

describe('shiftDayKey', () => {
  it('moves across a month and a year end on the calendar', () => {
    expect(shiftDayKey('2026-11-30', 1)).toBe('2026-12-01');
    expect(shiftDayKey('2026-12-31', 1)).toBe('2027-01-01');
    // The DST change (Nov 1, 2026) is not a 23- or 25-hour day here.
    expect(shiftDayKey('2026-10-31', 2)).toBe('2026-11-02');
  });
});

describe('buildWeek', () => {
  it('gives the seven home days from today, in order', () => {
    const week = buildWeek(SEVEN, { now: NOW });
    expect(week.map((d) => d.date)).toEqual(SEVEN.map((d) => d.date));
    expect(week[1]).toMatchObject({ high: 61, low: 50, rainChance: 80, rainInches: 0.62, code: 63, wet: true, missing: false });
    expect(week[0].wet).toBe(false);
  });

  it("starts at the home's today, not the device's or UTC's (11:30 PM at home is still that day)", () => {
    // 05:30 UTC Nov 12 = 11:30 PM Nov 11 at home.
    expect(buildWeek(SEVEN, { now: '2026-11-12T05:30:00Z' })[0].date).toBe('2026-11-11');
    // 06:05 UTC Nov 12 = 12:05 AM Nov 12 at home: yesterday drops off, the week ends a day later.
    const after = buildWeek(SEVEN, { now: '2026-11-12T06:05:00Z' });
    expect(after[0].date).toBe('2026-11-12');
    expect(after[6]).toMatchObject({ date: '2026-11-18', missing: true });
  });

  it('keeps a missing day in its slot instead of closing the gap', () => {
    const gap = SEVEN.filter((d) => d.date !== '2026-11-14');
    const week = buildWeek(gap, { now: NOW });
    expect(week).toHaveLength(7);
    expect(week[3]).toMatchObject({ date: '2026-11-14', missing: true, high: null, low: null, wet: false });
    expect(week[4].date).toBe('2026-11-15');
  });

  it('treats a day without temperatures as missing (null is not 0°)', () => {
    const week = buildWeek([...SEVEN.slice(0, 6), day('2026-11-17', null, null, null)], { now: NOW });
    expect(week[6].missing).toBe(true);
    expect(weekScale(week)).toEqual({ min: 41, max: 74 });
  });

  it('fills a missing day from the hourly forecast when that covers the whole day', () => {
    const gap = SEVEN.filter((d) => d.date !== '2026-11-12');
    const hourly = [...hoursFor('2026-11-11', () => 60), ...hoursFor('2026-11-12', (h) => 50 + h)];
    const week = buildWeek(gap, { now: NOW, hourly });
    expect(week[1]).toMatchObject({ date: '2026-11-12', missing: false, high: 73, low: 50, rainChance: 70, wet: true, code: 61 });
    expect(week[1].rainInches).toBeCloseTo(0.2);
    // Today came from the daily outlook and is not overwritten by the hours.
    expect(week[0]).toMatchObject({ high: 68, low: 48 });
  });

  it('leaves a partly covered day missing (a few hours make a fake high and low)', () => {
    const gap = SEVEN.filter((d) => d.date !== '2026-11-12');
    const week = buildWeek(gap, { now: NOW, hourly: hoursFor('2026-11-12', () => 50, 0, 5) });
    expect(week[1].missing).toBe(true);
  });

  it('is an empty-but-whole week for no data', () => {
    const week = buildWeek(undefined, { now: NOW });
    expect(week).toHaveLength(7);
    expect(week.every((d) => d.missing)).toBe(true);
    expect(weekScale(week)).toBeNull();
    expect(weekSummary(week, NOW)).toBeUndefined();
  });
});

describe('daysFromHourly', () => {
  it('splits days at home midnight: 11 PM is its own day, midnight the next', () => {
    const hourly = [
      ...hoursFor('2026-11-11', (h) => (h === 23 ? 99 : 60)),
      ...hoursFor('2026-11-12', (h) => (h === 0 ? 10 : 55)),
    ];
    const days = daysFromHourly(hourly);
    expect(days.get('2026-11-11')).toMatchObject({ high: 99, low: 60 });
    expect(days.get('2026-11-12')).toMatchObject({ high: 55, low: 10 });
  });

  it('picks the wet sky for a day with three or more rainy hours', () => {
    expect(daysFromHourly(hoursFor('2026-11-12', () => 50)).get('2026-11-12')?.code).toBe(61);
  });
});

describe('weekSummary', () => {
  it('names the warmest and coldest days and the wet ones in words', () => {
    const s = weekSummary(buildWeek(SEVEN, { now: NOW }), NOW)!.replace(NBSP_RE, ' ');
    expect(s).toBe('Warmest Sunday at 74°, coldest Friday at 41°. Rain likely tomorrow and Friday.');
  });

  it('says today and tomorrow, and when no rain is likely', () => {
    const dry = SEVEN.map((d, i) => ({ ...d, precipitationProbability: 0, maxTemperature: i === 0 ? 80 : 60, minTemperature: i === 1 ? 30 : 50 }));
    expect(weekSummary(buildWeek(dry, { now: NOW }), NOW)).toBe('Warmest today at 80°, coldest tomorrow at 30°. No rain likely.');
  });

  it('says "most days" for a wet week', () => {
    const wet = SEVEN.map((d) => ({ ...d, precipitationProbability: 90 }));
    expect(weekSummary(buildWeek(wet, { now: NOW }), NOW)).toMatch(/Rain likely most days\.$/);
  });
});
