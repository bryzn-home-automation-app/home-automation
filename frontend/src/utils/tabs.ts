// Tab names for usage tracking: a route's first segment ("/utility?view=gas" →
// "utility"), or its first two under /admin. Matches TabActivityService's pattern.

const TAB = /^[a-z][a-z0-9-]{0,24}(\/[a-z][a-z0-9-]{0,12})?$/;

const LABELS: Record<string, string> = {
  home: 'Home',
  utility: 'Utility',
  climate: 'AC/Heat Ecobee',
  cameras: 'Cameras',
  roomba: 'Roomba',
  wifi: 'WiFi',
  notifications: 'Alerts',
  users: 'Users',
  maintenance: 'Maintenance',
  updates: "What's New",
  profile: 'Profile',
  'admin/guests': 'Guests',
  'admin/debug': 'Debug',
  'admin/logs': 'Audit Logs',
  'admin/usage': 'Usage',
};

/** "/" → "home", "/cameras" → "cameras", "/admin/debug" → "admin/debug"; null for anything odd. */
export function tabKey(pathname: string): string | null {
  const parts = pathname.split('/').filter(Boolean).map((p) => p.toLowerCase());
  if (!parts.length) return 'home';
  const key = parts[0] === 'admin' && parts[1] ? `admin/${parts[1]}` : parts[0];
  return TAB.test(key) ? key : null;
}

export function tabLabel(key: string): string {
  return LABELS[key] ?? key;
}

/** "45 min", "3 h 5 min". */
export function minutesLabel(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}
