// Tab names for usage tracking: a route's first segment ("/utility?view=gas" →
// "utility"), or its first two under /admin. Matches TabActivityService's pattern.
// The names come from the route registry (routes.ts), so a new page is named in
// App usage the moment it has a route (Server health once showed as "admin/nuc").

import { routeById } from '../routes';

const TAB = /^[a-z][a-z0-9-]{0,24}(\/[a-z][a-z0-9-]{0,12})?$/;

/** Keys the backend may still hold from before Utilities was one tab (they now redirect). */
const RETIRED: Record<string, string> = {
  electric: 'Electric',
  gas: 'Gas',
  water: 'Water',
};

/** "/" → "home", "/cameras" → "cameras", "/admin/debug" → "admin/debug"; null for anything odd. */
export function tabKey(pathname: string): string | null {
  const parts = pathname.split('/').filter(Boolean).map((p) => p.toLowerCase());
  if (!parts.length) return 'home';
  const key = parts[0] === 'admin' && parts[1] ? `admin/${parts[1]}` : parts[0];
  return TAB.test(key) ? key : null;
}

export function tabLabel(key: string): string {
  return routeById(key)?.label ?? RETIRED[key] ?? key;
}

/** "45 min", "3 h 5 min". */
export function minutesLabel(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}
