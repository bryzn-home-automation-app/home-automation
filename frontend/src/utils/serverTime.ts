/**
 * Parses a server LocalDateTime such as "2026-11-04 10:30:00.0". The backend writes these in
 * Central wall-clock time with no zone, so they are read as local time: appending 'Z' would shift
 * them by 5-6 hours, and the space (not 'T') is Invalid Date in Safari. Strings that already carry
 * a zone (Z or an offset) are left to the Date parser.
 */
export function parseServerTs(value: string): Date {
  const iso = value.trim().replace(' ', 'T');
  return new Date(iso);
}
