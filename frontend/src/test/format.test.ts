import { describe, expect, it } from 'vitest';
import {
  DASH,
  daysBetween,
  formatAbout,
  formatDate,
  formatDateRange,
  formatDateTime,
  formatDayName,
  formatDuration,
  formatDurationBetween,
  formatHour,
  formatList,
  formatMoney,
  formatMonthYear,
  formatNumber,
  formatPercent,
  formatRate,
  formatRelative,
  formatShortDate,
  formatStamp,
  formatTemp,
  formatTime,
  formatTimeRange,
  formatWeekday,
  homeClock,
  homeDayKey,
  homeToday,
  plural,
  pluralWord,
  toInstant,
} from '../utils/format';

// The formatters join figures to units, a month to its day and a time to AM/PM with a
// no-break space (so they never wrap apart). The expectations below are written with plain
// spaces for readability; 'keeps figures and units together' checks the no-break spaces.
const p = (s: string) => s.replace(/ /g, ' ');

// "Now" in the design's fixtures: Mon, Nov 9, 2026, 5:00 PM Central (CST, UTC−6).
const NOW = new Date('2026-11-09T23:00:00Z');

describe('home time zone', () => {
  it('reads an instant on the home clock, whatever the device zone', () => {
    // 5:30 AM UTC on Nov 10 is still 11:30 PM on Nov 9 at home: the UTC day would be wrong (B-093).
    const c = homeClock('2026-11-10T05:30:00Z');
    expect(c).toMatchObject({ year: 2026, month: 11, day: 9, hour: 23, minute: 30, weekday: 1, hasTime: true });
    expect(homeDayKey('2026-11-10T05:30:00Z')).toBe('2026-11-09');
  });

  it('keeps a date-only string on its calendar day', () => {
    expect(homeClock('2026-11-04')).toMatchObject({ year: 2026, month: 11, day: 4, hasTime: false, weekday: 3 });
    expect(p(formatDate('2026-11-04', { now: NOW }))).toBe('Wed, Nov 4');
  });

  it("reads a zone-less server timestamp as the home's wall clock", () => {
    // The backend's LocalDateTime is already Central; appending Z would move it 6 hours.
    expect(p(formatTime('2026-11-04 10:30:00.0'))).toBe('10:30 AM');
    expect(p(formatTime('2026-11-04T22:05'))).toBe('10:05 PM');
  });

  it("knows today at home in the evening, when the UTC date has rolled over", () => {
    expect(homeToday(new Date('2026-11-10T01:00:00Z'))).toBe('2026-11-09'); // 7 PM CST
    expect(homeToday(new Date('2026-07-15T23:59:00Z'))).toBe('2026-07-15'); // 6:59 PM CDT
    expect(homeToday(new Date('2026-07-16T05:00:00Z'))).toBe('2026-07-16'); // midnight CDT
  });

  it('turns a home wall-clock string into the right instant on both sides of DST', () => {
    expect(new Date(toInstant('2026-11-09 17:00:00')!).toISOString()).toBe('2026-11-09T23:00:00.000Z'); // CST
    expect(new Date(toInstant('2026-07-15T17:00')!).toISOString()).toBe('2026-07-15T22:00:00.000Z'); // CDT
    expect(new Date(toInstant('2026-11-09')!).toISOString()).toBe('2026-11-09T06:00:00.000Z'); // home midnight
    expect(toInstant('not a date')).toBeNull();
    expect(toInstant(null)).toBeNull();
  });

  it('counts calendar days at home, not 24-hour blocks', () => {
    expect(daysBetween('2026-11-08T23:50:00-06:00', '2026-11-09T00:10:00-06:00')).toBe(1);
    expect(daysBetween('2026-11-09', '2026-11-02')).toBe(-7);
    expect(daysBetween('nope', NOW)).toBeNull();
  });

  it('rejects impossible dates', () => {
    expect(homeClock('2026-02-30')).toBeNull();
    expect(formatDate('2026-13-01')).toBe(DASH);
  });
});

describe('dates', () => {
  it('writes "Mon, Nov 9", with the year only when it is not this year', () => {
    expect(p(formatDate(NOW, { now: NOW }))).toBe('Mon, Nov 9');
    expect(p(formatDate('2025-12-24', { now: NOW }))).toBe('Wed, Dec 24, 2025');
    expect(p(formatDate('2026-11-09', { now: NOW, year: 'always' }))).toBe('Mon, Nov 9, 2026');
    expect(p(formatShortDate('2026-11-17', { now: NOW }))).toBe('Nov 17');
    expect(formatWeekday('2026-11-08')).toBe('Sun');
  });

  it('gives a dash for missing or unreadable values', () => {
    for (const bad of [null, undefined, '', 'garbage', Number.NaN, new Date('x')]) {
      expect(formatDate(bad as never)).toBe(DASH);
      expect(formatTime(bad as never)).toBe(DASH);
    }
  });

  it('names a bill by the month its cycle ends in (B-098)', () => {
    expect(p(formatMonthYear('2026-08-19'))).toBe('Aug ’26');
  });

  it('names nearby days', () => {
    expect(formatDayName('2026-11-09', NOW)).toBe('Today');
    expect(formatDayName('2026-11-08', NOW)).toBe('Yesterday');
    expect(formatDayName('2026-11-10', NOW)).toBe('Tomorrow');
    expect(p(formatDayName('2026-11-05', NOW))).toBe('Thu, Nov 5');
  });
});

describe('times', () => {
  it('writes "5:00 PM" on the home clock', () => {
    expect(p(formatTime(NOW))).toBe('5:00 PM');
    expect(p(formatTime('2026-11-09T06:00:00Z'))).toBe('12:00 AM');
    expect(p(formatTime('2026-11-09T18:00:00Z'))).toBe('12:00 PM');
    expect(formatTime('2026-11-09')).toBe(DASH); // a day has no time
  });

  it('writes hour marks with Noon', () => {
    expect(p(formatHour(0))).toBe('12 AM');
    expect(formatHour(12)).toBe('Noon');
    expect(p(formatHour(17))).toBe('5 PM');
    expect(p(formatHour(NOW))).toBe('5 PM');
  });

  it('joins date and time', () => {
    expect(p(formatDateTime(NOW, { now: NOW }))).toBe('Mon, Nov 9, 5:00 PM');
    expect(p(formatDateTime('2026-11-04', { now: NOW }))).toBe('Wed, Nov 4');
  });

  it('stamps events as briefly as stays clear', () => {
    expect(p(formatStamp('2026-11-09T14:05:00Z', { now: NOW }))).toBe('8:05 AM');
    expect(p(formatStamp('2026-11-08T21:44:00Z', { now: NOW }))).toBe('Yesterday, 3:44 PM');
    expect(p(formatStamp('2026-11-08T04:10:00Z', { now: NOW }))).toBe('Sat, 10:10 PM'); // Sat night at home
    expect(p(formatStamp('2026-10-30T15:00:00Z', { now: NOW }))).toBe('Fri, Oct 30');
    expect(p(formatStamp('2026-10-30T15:00:00Z', { now: NOW, time: 'always' }))).toBe('Fri, Oct 30, 10:00 AM');
  });
});

describe('ranges', () => {
  it('uses a spaced en dash and adds years only when needed', () => {
    expect(p(formatDateRange('2026-11-05', '2026-12-05', { now: NOW }))).toBe('Nov 5 – Dec 5');
    expect(p(formatDateRange('2025-10-07', '2025-11-05', { now: NOW }))).toBe('Oct 7 – Nov 5, 2025');
    expect(p(formatDateRange('2025-12-20', '2026-01-05', { now: NOW }))).toBe('Dec 20, 2025 – Jan 5, 2026');
    expect(p(formatDateRange('2026-11-05', null, { now: NOW }))).toBe('Nov 5 – …');
    expect(formatDateRange(null, null)).toBe(DASH);
  });

  it('says when a time range ends on a later day (B-134)', () => {
    expect(p(formatTimeRange('2026-10-26T18:40', '2026-10-26T21:15'))).toBe('6:40 PM – 9:15 PM');
    expect(p(formatTimeRange('2026-10-26T18:40', '2026-10-27T05:32'))).toBe('6:40 PM – Tue, 5:32 AM');
    expect(p(formatTimeRange('2026-10-26T18:40', null))).toBe('6:40 PM – …');
  });
});

describe('relative time', () => {
  it('counts minutes, then hours, then days', () => {
    expect(formatRelative(new Date(NOW.getTime() - 20_000), NOW)).toBe('Just now');
    expect(formatRelative(new Date(NOW.getTime() - 60_000), NOW)).toBe('1 min ago');
    expect(formatRelative(new Date(NOW.getTime() - 2 * 3_600_000), NOW)).toBe('2 hr ago');
    expect(formatRelative('2026-11-08T21:44:00Z', NOW)).toBe('Yesterday');
    expect(formatRelative('2026-11-06T12:00:00Z', NOW)).toBe('3 days ago');
    expect(p(formatRelative('2026-10-20T12:00:00Z', NOW))).toBe('Tue, Oct 20');
  });

  it('switches to Yesterday at home midnight, not after 24 hours', () => {
    // 11 PM yesterday is 18 hours ago, but it was yesterday.
    expect(formatRelative('2026-11-09T05:00:00Z', NOW)).toBe('Yesterday');
  });

  it('keeps counting minutes across midnight', () => {
    // 11:58 PM to 12:01 AM Central: three minutes, though the day changed.
    expect(formatRelative('2026-11-09T05:58:00Z', '2026-11-09T06:01:00Z')).toBe('3 min ago');
    // 11:50 PM, looking 20 minutes ahead.
    expect(formatRelative('2026-11-09T06:10:00Z', '2026-11-09T05:50:00Z')).toBe('in 20 min');
  });

  it('looks ahead too', () => {
    expect(formatRelative(new Date(NOW.getTime() + 5 * 60_000), NOW)).toBe('in 5 min');
    expect(formatRelative('2026-11-10T15:00:00Z', NOW)).toBe('Tomorrow');
    expect(formatRelative('2026-11-12T15:00:00Z', NOW)).toBe('in 3 days');
  });
});

describe('durations: one style', () => {
  it('writes minutes, hours and days the same way everywhere', () => {
    expect(p(formatDuration(0.4))).toBe('under 1 min');
    expect(p(formatDuration(45))).toBe('45 min');
    expect(p(formatDuration(60))).toBe('1 hr');
    expect(p(formatDuration(176))).toBe('2 hr 56 min');
    expect(p(formatDuration(14 * 60 + 20))).toBe('14 hr');
    expect(p(formatDuration(3 * 1440 + 4 * 60))).toBe('3 days 4 hr');
    expect(p(formatDuration(1440))).toBe('1 day');
    expect(formatDuration(-5)).toBe(DASH);
    expect(formatDuration(null)).toBe(DASH);
  });

  it('measures between two values', () => {
    expect(p(formatDurationBetween('2026-10-26T18:40', '2026-10-27T05:32'))).toBe('10 hr');
    expect(p(formatDurationBetween('2026-11-09 16:00:00', '2026-11-09 16:45:00'))).toBe('45 min');
  });
});

describe('numbers and money', () => {
  it('groups thousands and joins units', () => {
    expect(p(formatNumber(11400, { unit: 'gal' }))).toBe('11,400 gal');
    expect(p(formatNumber(35.48, { decimals: 1, unit: 'kWh' }))).toBe('35.5 kWh');
    expect(formatNumber(35, { decimals: 1, fixed: true })).toBe('35.0');
    expect(formatNumber(-3.2, { decimals: 1 })).toBe('−3.2');
    expect(formatNumber(-0.04, { decimals: 1 })).toBe('0'); // never "−0"
    expect(formatNumber(4, { signed: true })).toBe('+4');
    expect(formatPercent(27)).toBe('27%');
    expect(formatTemp(70.6)).toBe('71°');
    expect(formatNumber(undefined)).toBe(DASH);
  });

  it('writes money with grouping, cents and a real minus', () => {
    expect(formatMoney(1234.5)).toBe('$1,234.50');
    expect(formatMoney(-1.5)).toBe('−$1.50');
    expect(formatMoney(0)).toBe('$0.00');
    expect(formatMoney(114.2, { cents: false })).toBe('$114');
    expect(formatMoney(3.2, { signed: true })).toBe('+$3.20');
    expect(formatMoney(-0.001)).toBe('$0.00');
    expect(formatMoney(null)).toBe(DASH);
  });

  it('says estimates without false precision', () => {
    expect(formatAbout(114.2)).toBe('about $114');
    expect(formatAbout(null)).toBe(DASH);
  });

  it('writes a tariff to four places', () => {
    expect(formatRate(0.1171, 'kWh')).toBe('$0.1171/kWh');
  });
});

describe('line breaks', () => {
  it('keeps figures and units together', () => {
    expect(formatTime(NOW)).toBe('5:00 PM');
    expect(formatShortDate('2026-11-17', { now: NOW })).toBe('Nov 17');
    expect(formatNumber(1124, { unit: 'sq ft' })).toBe('1,124 sq ft');
    expect(formatDuration(176)).toBe('2 hr 56 min');
    expect(formatPercent(27)).toBe('27%');
  });
});

describe('words', () => {
  it('pluralises with the count', () => {
    expect(p(plural(1, 'day'))).toBe('1 day');
    expect(p(plural(3, 'day'))).toBe('3 days');
    expect(p(plural(1124, 'person', 'people'))).toBe('1,124 people');
    expect(pluralWord(1, 'alert')).toBe('alert');
    expect(pluralWord(0, 'alert')).toBe('alerts');
  });

  it('lists names', () => {
    expect(formatList([])).toBe('');
    expect(formatList(['Bryan'])).toBe('Bryan');
    expect(formatList(['Bryan', 'Mai'])).toBe('Bryan and Mai');
    expect(formatList(['Bryan', 'Mai', 'Linh'])).toBe('Bryan, Mai and Linh');
  });
});
