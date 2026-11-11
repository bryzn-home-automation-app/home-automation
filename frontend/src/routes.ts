import type { IconName } from './components/ui/Icon';

/*
 * The one list of the app's pages. The key column, the phone key row, the More sheet,
 * the page header, the document title and the App usage names (utils/tabs.ts) all
 * read it, so a page is named once. The router itself still lives in main.tsx
 * (lazy chunks, guards); a test checks the two agree.
 *
 * Names follow docs/faceplate/BRIEF-common.md (plain words: "Climate", not
 * "AC/Heat Ecobee"). URLs never change here: people have them bookmarked and phone
 * alerts deep-link to them.
 */

/** The groups pages are filed under, in the order the menus show them. */
export type RouteGroup = 'everyday' | 'house' | 'you' | 'admin';

export const GROUP_LABEL: Record<RouteGroup, string> = {
  everyday: 'Everyday',
  house: 'House',
  you: 'You',
  admin: 'Admin',
};

export const GROUP_ORDER: RouteGroup[] = ['everyday', 'house', 'you', 'admin'];

/** Who may see a page: everyone signed in, everyone but guests, or admins. */
export type RouteAccess = 'all' | 'member' | 'admin';

export type Role = 'ADMIN' | 'USER' | 'GUEST';

export interface AppRoute {
  /** The usage-tracking key, tabKey(path): "home", "utility", "admin/nuc". */
  id: string;
  /** The URL, as main.tsx routes it. */
  path: string;
  /** The name in menus (More sheet, App usage). */
  label: string;
  /** The name under a key in the key column and key row, where width is tight. */
  short: string;
  /** The page's one title (the header, the phone strip, the browser tab). */
  title: string;
  group: RouteGroup;
  icon: IconName;
  access: RouteAccess;
  /** One of the phone key row's five keys (the rest are under More). */
  keyRow?: boolean;
}

export const ROUTES: readonly AppRoute[] = [
  { id: 'home', path: '/', label: 'Home', short: 'Home', title: 'Home', group: 'everyday', icon: 'home', access: 'all', keyRow: true },
  { id: 'utility', path: '/utility', label: 'Utilities', short: 'Utilities', title: 'Utilities', group: 'everyday', icon: 'bolt', access: 'all', keyRow: true },
  { id: 'climate', path: '/climate', label: 'Climate', short: 'Climate', title: 'Climate', group: 'everyday', icon: 'thermometer', access: 'all', keyRow: true },
  { id: 'cameras', path: '/cameras', label: 'Cameras', short: 'Cameras', title: 'Cameras', group: 'everyday', icon: 'camera', access: 'member', keyRow: true },
  { id: 'roomba', path: '/roomba', label: 'Roomba', short: 'Roomba', title: 'Roomba', group: 'everyday', icon: 'robot', access: 'all', keyRow: true },

  { id: 'reminders', path: '/reminders', label: 'Reminders', short: 'Reminders', title: 'Reminders', group: 'house', icon: 'calendar', access: 'member' },
  { id: 'maintenance', path: '/maintenance', label: 'Maintenance', short: 'Maintenance', title: 'Maintenance', group: 'house', icon: 'wrench', access: 'member' },
  { id: 'wifi', path: '/wifi', label: 'Guest Wi-Fi', short: 'Guest Wi-Fi', title: 'Guest Wi-Fi', group: 'house', icon: 'wifi', access: 'all' },
  { id: 'users', path: '/users', label: 'People', short: 'People', title: 'People', group: 'house', icon: 'users', access: 'all' },

  { id: 'notifications', path: '/notifications', label: 'Alerts', short: 'Alerts', title: 'Alerts', group: 'you', icon: 'bell', access: 'all' },
  { id: 'profile', path: '/profile', label: 'Profile', short: 'Profile', title: 'Profile', group: 'you', icon: 'user', access: 'all' },
  { id: 'updates', path: '/updates', label: "What's new", short: "What's new", title: "What's new", group: 'you', icon: 'sparkles', access: 'all' },

  // Admin: the key column's order (who first, then what happened, then the machinery).
  { id: 'admin/presence', path: '/admin/presence', label: "Who's home", short: "Who's home", title: "Who's home", group: 'admin', icon: 'map-pin', access: 'admin' },
  { id: 'admin/guests', path: '/admin/guests', label: 'Guests', short: 'Guests', title: 'Guests', group: 'admin', icon: 'id-card', access: 'admin' },
  { id: 'admin/logs', path: '/admin/logs', label: 'Activity log', short: 'Activity', title: 'Activity log', group: 'admin', icon: 'history', access: 'admin' },
  { id: 'admin/usage', path: '/admin/usage', label: 'App usage', short: 'App usage', title: 'App usage', group: 'admin', icon: 'bar-chart', access: 'admin' },
  { id: 'admin/nuc', path: '/admin/nuc', label: 'Server health', short: 'Server', title: 'Server health', group: 'admin', icon: 'server', access: 'admin' },
  { id: 'admin/debug', path: '/admin/debug', label: 'Diagnostics', short: 'Diagnostics', title: 'Diagnostics', group: 'admin', icon: 'activity', access: 'admin' },
];

export const HOME_ROUTE = ROUTES[0];

const BY_ID = new Map(ROUTES.map((r) => [r.id, r]));

export function routeById(id: string): AppRoute | undefined {
  return BY_ID.get(id);
}

/**
 * The page a URL belongs to: an exact match, else the longest path it sits under
 * ("/admin/debug/x" is Diagnostics), else undefined (a redirect or a 404).
 */
export function routeForPath(pathname: string): AppRoute | undefined {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  let best: AppRoute | undefined;
  for (const r of ROUTES) {
    if (r.path === path) return r;
    if (r.path !== '/' && path.startsWith(`${r.path}/`) && (!best || r.path.length > best.path.length)) best = r;
  }
  return best;
}

/** Whether someone with this role may open the page. Mirrors the guards in main.tsx. */
export function canSee(route: AppRoute, role: Role | null | undefined): boolean {
  if (!role) return false;
  if (route.access === 'admin') return role === 'ADMIN';
  if (route.access === 'member') return role !== 'GUEST';
  return true;
}

/** The pages this person can open, in menu order, optionally one group's only. */
export function visibleRoutes(role: Role | null | undefined, group?: RouteGroup): AppRoute[] {
  return ROUTES.filter((r) => (!group || r.group === group) && canSee(r, role));
}

/** Role names people see (the API's ADMIN / USER / GUEST stay internal). */
export const ROLE_LABEL: Record<Role, string> = {
  ADMIN: 'Admin',
  USER: 'Member',
  GUEST: 'Guest',
};
