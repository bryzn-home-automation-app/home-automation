import { describe, it, expect } from 'vitest';
import { parseServerTs } from '../utils/serverTime';
import { parseLocalDate } from '../utils/localDate';

describe('parseServerTs', () => {
  it('parses a space-separated LocalDateTime as local wall-clock time', () => {
    const d = parseServerTs('2026-11-04 10:30:00.0');
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(10);
    expect(d.getDate()).toBe(4);
    expect(d.getHours()).toBe(10);
    expect(d.getMinutes()).toBe(30);
  });

  it('matches the T form and does not shift by a zone', () => {
    expect(parseServerTs('2026-11-04 10:30:00').getTime()).toBe(new Date('2026-11-04T10:30:00').getTime());
  });

  it('leaves a string that already has a zone to the Date parser', () => {
    expect(parseServerTs('2026-11-04T10:30:00Z').getTime()).toBe(Date.UTC(2026, 10, 4, 10, 30));
  });
});

describe('parseLocalDate', () => {
  it('reads a date-only string as that local calendar day', () => {
    const d = parseLocalDate('2026-11-04');
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2026, 10, 4]);
  });
});
