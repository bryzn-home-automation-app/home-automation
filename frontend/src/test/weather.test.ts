import { describe, it, expect } from 'vitest';
import {
  getWeatherCodeDescription,
  getWeatherEmoji,
  getDominantWeatherEmoji,
  isNightTime,
} from '../utils/weather';

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
