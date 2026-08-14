/**
 * Hourly electric rows are identified by `source` label. The legacy
 * Average Usage sync and the current Usage Explorer sync write different
 * labels, so both must be recognized as hourly.
 *
 * (Daily rows use a different label — e.g. "CoServ Green Button" or
 * "CoServ Usage Explorer" — and must NOT match, or they'd be double-counted
 * against the summed hourly totals.)
 */
export const HOURLY_SOURCES = new Set([
  'CoServ Average Usage',
  'CoServ Usage Explorer Hourly',
]);

export const isHourlySource = (source: string | undefined | null): boolean =>
  !!source && HOURLY_SOURCES.has(source);
