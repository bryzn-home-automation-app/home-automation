import { memo, type ReactElement, type SVGProps } from 'react';

/*
 * Faceplate icons: the prototype's sprite (docs/faceplate/prototype/shell.html) as one
 * inline <svg> of <symbol>s, mounted once by <IconSprite /> in the shell, and drawn
 * anywhere with <Icon name="thermometer" />, which is a <use> of its symbol.
 *
 * A 24px grid with 1.5px round strokes in currentColor (the .fp-icon class in
 * styles/faceplate.css). An icon is sized by the text it sits in (1em); kit
 * components size their icons exactly, and .fp-icon--s / --m / --l give 16 / 20 /
 * 28px. Decorative by default (aria-hidden); pass a title when the icon carries
 * meaning on its own, e.g. a status icon with no word beside it. An icon-only
 * button still needs its own aria-label.
 *
 * Nav icons (use the same ones for the same pages): Home home, Utilities bolt (Gas
 * flame, Water droplet), Climate thermometer, Cameras camera, Roomba robot,
 * Maintenance wrench, Guest Wi-Fi wifi, People users, Alerts bell, Profile user,
 * What's new sparkles, Who's home map-pin, Guests id-card, Activity log history,
 * App usage bar-chart, Server health server, Diagnostics activity.
 * Generated from shell.html; to add an icon, draw it on the same grid and add it here.
 */
const SYMBOLS = {
  home: <><path d="M3.5 10.5 12 3.5l8.5 7" /><path d="M5.5 9v11.5h13V9" /><path d="M10 20.5v-6h4v6" /></>,
  bolt: <><path d="M13.5 2.5 4.5 14h7l-1 7.5 9-11.5h-7z" /></>,
  'zap-off': <><path d="M13.5 2.5 11 6M15.5 10h4l-2.5 3.2M11 21.5l.9-6.5M8.2 8.2 4.5 14h6.8" /><path d="m3 3 18 18" /></>,
  flame: <><path d="M12 2.5c.4 2.9 2.2 4.8 3.9 6.6C17.6 10.9 19 12.8 19 15.5a7 7 0 0 1-14 0c0-2.3 1-4 2.4-5.4.2 1.7 1.2 3 2.6 3.3C9.4 9.7 10 6 12 2.5z" /><path d="M12 21.5a2.8 2.8 0 0 1-2.8-2.8c0-1.6 1.3-2.6 2.8-4.2 1.5 1.6 2.8 2.6 2.8 4.2a2.8 2.8 0 0 1-2.8 2.8z" /></>,
  droplet: <><path d="M12 3s6.5 6.6 6.5 11.5a6.5 6.5 0 0 1-13 0C5.5 9.6 12 3 12 3z" /></>,
  thermometer: <><path d="M14 4.5v9.8a4 4 0 1 1-4 0V4.5a2 2 0 0 1 4 0z" /><path d="M12 10v7" /></>,
  snowflake: <><path d="M12 2.5v19M3.8 7.2l16.4 9.6M20.2 7.2 3.8 16.8" /><path d="m9.5 3.8 2.5 2 2.5-2M9.5 20.2l2.5-2 2.5 2M3.6 10.4l3.1-.6-.9-3M20.4 13.6l-3.1.6.9 3M5.8 17.2l.9-3-3.1-.6M18.2 6.8l-.9 3 3.1.6" /></>,
  fan: <><path d="M12 12c-1.8-2.6-1.6-6.3.7-8.2 1.9-1.6 4.8-.5 4.6 2-.2 2.8-2.9 4.9-5.3 6.2z" /><path d="M12 12c3.1-.3 6.4 1.4 7.1 4.3.6 2.4-1.8 4.3-3.9 3-2.4-1.5-3.1-4.8-3.2-7.3z" /><path d="M12 12c-1.3 2.9-4.4 4.9-7.3 4.1-2.4-.7-2.9-3.7-.7-4.9 2.4-1.4 5.7-.3 8 .8z" /><circle cx="12" cy="12" r="1.2" /></>,
  camera: <><path d="M3 8.5A2 2 0 0 1 5 6.5h2.2L8.8 4h6.4l1.6 2.5H19a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><circle cx="12" cy="13" r="3.6" /></>,
  video: <><rect x="2.5" y="6" width="13" height="12" rx="2" /><path d="m15.5 10.5 6-3.5v10l-6-3.5" /></>,
  robot: <><circle cx="12" cy="12" r="9" /><path d="M5.2 8.5h13.6" /><circle cx="12" cy="14.5" r="2.2" /><path d="M8 5.2 9 8.5M16 5.2 15 8.5" /></>,
  dock: <><path d="M3 20.5h18" /><path d="M6 20.5V10a2.5 2.5 0 0 1 2.5-2.5h7A2.5 2.5 0 0 1 18 10v10.5" /><path d="m12.6 10.5-2.1 3.2h3l-2.1 3.3" /></>,
  wifi: <><path d="M2.5 9a14.5 14.5 0 0 1 19 0" /><path d="M5.5 12.5a10 10 0 0 1 13 0" /><path d="M8.7 15.9a5.2 5.2 0 0 1 6.6 0" /><path d="M12 19.5h.01" /></>,
  router: <><rect x="2.5" y="13.5" width="19" height="7" rx="1.5" /><path d="M6.5 17h.01M10 17h.01M16 13.5V10" /><path d="M13.6 8.2a3.4 3.4 0 0 1 4.8 0M11.4 6a6.5 6.5 0 0 1 9.2 0" /></>,
  users: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M15.5 4.7a3.5 3.5 0 0 1 0 6.6" /><path d="M18 14.3a6.5 6.5 0 0 1 3.5 5.7" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4.5 21a7.5 7.5 0 0 1 15 0" /></>,
  wrench: <><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9z" /></>,
  tool: <><path d="m14.5 12.5-8.3 8.3a2.1 2.1 0 0 1-3-3L11.5 9.5" /><path d="M17.6 15 22 10.6" /><path d="m20.9 11.7-1.3-1.3a3.2 3.2 0 0 1-.9-2.2v-.9L16 4.6A5.6 5.6 0 0 0 12.1 3H9l.9.8A6.2 6.2 0 0 1 12 8.4V10l2 2h2.5l2.2 1.9" /></>,
  bell: <><path d="M6 8.5a6 6 0 0 1 12 0c0 6.5 2.8 8.5 2.8 8.5H3.2S6 15 6 8.5" /><path d="M10.2 20.5a2 2 0 0 0 3.6 0" /></>,
  sparkles: <><path d="M10.5 3.5 12.3 8.2 17 10l-4.7 1.8-1.8 4.7-1.8-4.7L4 10l4.7-1.8z" /><path d="M18 14.5l.9 2.1 2.1.9-2.1.9L18 20.5l-.9-2.1-2.1-.9 2.1-.9z" /><path d="M18.5 2.5v3M17 4h3" /></>,
  shield: <><path d="M12 3 19.5 6v5.8c0 4.6-3.2 7.9-7.5 9.2-4.3-1.3-7.5-4.6-7.5-9.2V6z" /><path d="m9 12 2.2 2.2L15.5 10" /></>,
  'id-card': <><rect x="2.5" y="5" width="19" height="14" rx="2" /><circle cx="8.5" cy="11" r="2" /><path d="M5.5 16a3 3 0 0 1 6 0" /><path d="M14 10h4.5M14 13.5h3" /></>,
  activity: <><path d="M21.5 12h-3.8l-2.9 8.5L9.2 3.5 6.3 12H2.5" /></>,
  list: <><path d="M8.5 6h12M8.5 12h12M8.5 18h12M3.8 6h.01M3.8 12h.01M3.8 18h.01" /></>,
  'bar-chart': <><path d="M3.5 3.5v17h17" /><path d="M8 16.5v-4M12.5 16.5V7.5M17 16.5v-6.5" /></>,
  gauge: <><path d="M3.8 18.5a9 9 0 1 1 16.4 0" /><path d="m12 14.5 4-4.5" /><circle cx="12" cy="14.5" r="1.2" /></>,
  'map-pin': <><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" /></>,
  map: <><path d="M9 4 3.5 6.3v13.5L9 17.5l6 2.5 5.5-2.3V4.2L15 6.5z" /><path d="M9 4v13.5M15 6.5V20" /></>,
  server: <><rect x="3" y="3.5" width="18" height="7" rx="1.5" /><rect x="3" y="13.5" width="18" height="7" rx="1.5" /><path d="M7 7h.01M7 17h.01M11 7h3M11 17h3" /></>,
  cpu: <><rect x="6" y="6" width="12" height="12" rx="1.5" /><rect x="9.5" y="9.5" width="5" height="5" rx=".5" /><path d="M9.5 2.5V6M14.5 2.5V6M9.5 18v3.5M14.5 18v3.5M2.5 9.5H6M2.5 14.5H6M18 9.5h3.5M18 14.5h3.5" /></>,
  'hard-drive': <><rect x="2.5" y="13" width="19" height="7.5" rx="1.5" /><path d="M2.5 13 6 4.5h12l3.5 8.5" /><path d="M6.5 16.8h.01M10 16.8h.01" /></>,
  sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4" /></>,
  moon: <><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" /></>,
  contrast: <><circle cx="12" cy="12" r="8.5" /><path d="M12 3.5v17a8.5 8.5 0 0 0 0-17z" fill="currentColor" stroke="none" /></>,
  cloud: <><path d="M17.5 19H8.5a6 6 0 1 1 5.6-8.2h1.4a4.1 4.1 0 1 1 2 8.2z" /></>,
  'cloud-sun': <><path d="M12 2.5v1.8M4.9 4.9l1.3 1.3M19.1 4.9l-1.3 1.3M21.5 11.5h-1.8" /><path d="M8.6 9.4a4 4 0 0 1 7.3-1.2" /><path d="M16 21.5H7.5a4.5 4.5 0 1 1 4.2-6.2h1.1a3.1 3.1 0 1 1 3.2 6.2z" /></>,
  'cloud-moon': <><path d="M10.2 8.8A5.8 5.8 0 0 1 16 3.5a4.3 4.3 0 0 0 5.5 5.5 5.8 5.8 0 0 1-2.6 4.7" /><path d="M15 21.5H6.5a4.5 4.5 0 1 1 4.2-6.2h1.1a3.1 3.1 0 1 1 3.2 6.2z" /></>,
  rain: <><path d="M4.5 14.6A6 6 0 1 1 14.6 8.5h1.6a4 4 0 0 1 2.6 7.1" /><path d="M8 15.5 7 19M12 15.5 11 19M16 15.5 15 19M10 19.5l-.5 2" /></>,
  storm: <><path d="M4.5 14.6A6 6 0 1 1 14.6 8.5h1.6a4 4 0 0 1 2.6 7.1" /><path d="m12.5 12-2.5 4h4l-2.5 4" /></>,
  fog: <><path d="M5 13.5A5.5 5.5 0 1 1 14.6 8h1.6a3.6 3.6 0 0 1 3.3 5" /><path d="M3.5 17h17M6 20.5h12" /></>,
  wind: <><path d="M12.8 19.6A2 2 0 1 0 14 16H2.5" /><path d="M17.5 8a2.5 2.5 0 1 1 2 4h-17" /><path d="M9.8 4.4A2 2 0 1 1 11 8H2.5" /></>,
  sunrise: <><path d="M12 2.5v6M8.8 5.5 12 2.5l3.2 3" /><path d="M16 17.5a4 4 0 0 0-8 0" /><path d="M2.5 17.5h2M19.5 17.5h2M5.3 11l1.4 1.4M18.7 11l-1.4 1.4M2.5 21h19" /></>,
  sunset: <><path d="M12 8.5v-6M8.8 5.5 12 8.5l3.2-3" /><path d="M16 17.5a4 4 0 0 0-8 0" /><path d="M2.5 17.5h2M19.5 17.5h2M5.3 11l1.4 1.4M18.7 11l-1.4 1.4M2.5 21h19" /></>,
  calendar: <><rect x="3" y="4.5" width="18" height="16.5" rx="2" /><path d="M3 9.5h18M8 2.5v4M16 2.5v4" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.2 2" /></>,
  history: <><path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1L3.5 8.5" /><path d="M3.5 3.8v4.7h4.7" /><path d="M12 7.5v4.5l3 2" /></>,
  'chevron-right': <><path d="m9.5 6 6 6-6 6" /></>,
  'chevron-left': <><path d="m14.5 6-6 6 6 6" /></>,
  'chevron-down': <><path d="m6 9.5 6 6 6-6" /></>,
  'chevron-up': <><path d="m6 14.5 6-6 6 6" /></>,
  'arrow-up': <><path d="M12 19.5v-15M6 10.5l6-6 6 6" /></>,
  'arrow-down': <><path d="M12 4.5v15M6 13.5l6 6 6-6" /></>,
  'arrow-right': <><path d="M4.5 12h15M13.5 6l6 6-6 6" /></>,
  'arrow-left': <><path d="M19.5 12h-15M10.5 6l-6 6 6 6" /></>,
  plus: <><path d="M12 5v14M5 12h14" /></>,
  minus: <><path d="M5 12h14" /></>,
  check: <><path d="m4.5 12.5 5 5 10-10.5" /></>,
  x: <><path d="M6 6l12 12M18 6 6 18" /></>,
  'check-circle': <><circle cx="12" cy="12" r="9" /><path d="m8 12.4 2.8 2.8 5.2-5.7" /></>,
  'alert-triangle': <><path d="M10.3 4 2 18.2a2 2 0 0 0 1.7 3h16.6a2 2 0 0 0 1.7-3L13.7 4a2 2 0 0 0-3.4 0z" /><path d="M12 9.5v4M12 17.3h.01" /></>,
  'alert-circle': <><circle cx="12" cy="12" r="9" /><path d="M12 7.5V13M12 16.5h.01" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5.5M12 7.5h.01" /></>,
  play: <><path d="M7.5 4.8v14.4a.8.8 0 0 0 1.2.7l11.5-7.2a.8.8 0 0 0 0-1.4L8.7 4.1a.8.8 0 0 0-1.2.7z" /></>,
  pause: <><rect x="6" y="4.5" width="4" height="15" rx="1" /><rect x="14" y="4.5" width="4" height="15" rx="1" /></>,
  stop: <><rect x="5.5" y="5.5" width="13" height="13" rx="1.5" /></>,
  maximize: <><path d="M8.5 3.5H5A1.5 1.5 0 0 0 3.5 5v3.5M20.5 8.5V5A1.5 1.5 0 0 0 19 3.5h-3.5M15.5 20.5H19a1.5 1.5 0 0 0 1.5-1.5v-3.5M3.5 15.5V19A1.5 1.5 0 0 0 5 20.5h3.5" /></>,
  battery: <><rect x="2.5" y="7" width="16.5" height="10" rx="2" /><path d="M21.5 10.5v3" /><path d="M5.5 10v4M8.5 10v4M11.5 10v4" /></>,
  'battery-low': <><rect x="2.5" y="7" width="16.5" height="10" rx="2" /><path d="M21.5 10.5v3M5.5 10v4" /></>,
  'battery-charging': <><path d="M7.5 17H4.5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h3M14.5 7h2.5a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-2.5M21.5 10.5v3" /><path d="m11.8 6.5-2.6 5.5h3.6l-2.6 5.5" /></>,
  plug: <><path d="M9 2.5v5M15 2.5v5" /><path d="M6.5 7.5h11V11a5.5 5.5 0 0 1-11 0z" /><path d="M12 16.5v5" /></>,
  power: <><path d="M12 3v8.5" /><path d="M6.4 6.6a8 8 0 1 0 11.2 0" /></>,
  search: <><circle cx="11" cy="11" r="7" /><path d="m20.5 20.5-4.5-4.5" /></>,
  filter: <><path d="M3.5 5h17l-6.5 8v5.5l-4 2V13z" /></>,
  sliders: <><path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1" /><circle cx="15" cy="6" r="2" /><circle cx="9" cy="12" r="2" /><circle cx="17" cy="18" r="2" /></>,
  edit: <><path d="M16.5 3.6a2.1 2.1 0 0 1 3 3L8 18.1l-4 1 1-4z" /><path d="m14.5 5.6 3 3" /></>,
  trash: <><path d="M3.5 6h17M8.5 6V4.2A1.5 1.5 0 0 1 10 2.7h4a1.5 1.5 0 0 1 1.5 1.5V6M5.5 6l1 14a1.5 1.5 0 0 0 1.5 1.4h8a1.5 1.5 0 0 0 1.5-1.4l1-14" /><path d="M10 10.5v6.5M14 10.5v6.5" /></>,
  download: <><path d="M12 3.5v11.5M7 10.5l5 5 5-5" /><path d="M4 19.5h16" /></>,
  'external-link': <><path d="M14 3.5h6.5V10" /><path d="M20.5 3.5 11 13" /><path d="M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10" /></>,
  qr: <><rect x="3.5" y="3.5" width="6.5" height="6.5" rx="1" /><rect x="14" y="3.5" width="6.5" height="6.5" rx="1" /><rect x="3.5" y="14" width="6.5" height="6.5" rx="1" /><path d="M14 14h3v3M20.5 14v.01M14 20.5h6.5M20.5 17.5v3M17 17.5v.01" /></>,
  copy: <><rect x="8.5" y="8.5" width="12" height="12" rx="2" /><path d="M15.5 8.5V5A1.5 1.5 0 0 0 14 3.5H5A1.5 1.5 0 0 0 3.5 5v9A1.5 1.5 0 0 0 5 15.5h3.5" /></>,
  eye: <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="3" /></>,
  'eye-off': <><path d="M10.6 5.6A9.6 9.6 0 0 1 12 5.5c6 0 9.5 6.5 9.5 6.5a16.6 16.6 0 0 1-2.4 3.2M6.6 6.6A16.4 16.4 0 0 0 2.5 12s3.5 6.5 9.5 6.5a9.2 9.2 0 0 0 5.3-1.7" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /><path d="m3 3 18 18" /></>,
  lock: <><rect x="4" y="10.5" width="16" height="10.5" rx="2" /><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" /></>,
  key: <><circle cx="7.5" cy="15.5" r="4.5" /><path d="M10.7 12.3 20.5 2.5M16.5 6.5l3 3M14 9l2 2" /></>,
  door: <><path d="M5.5 21V4.5A1.5 1.5 0 0 1 7 3h10a1.5 1.5 0 0 1 1.5 1.5V21" /><path d="M3 21h18" /><path d="M14.5 12.5h.01" /></>,
  'log-out': <><path d="M9 20.5H5.5A1.5 1.5 0 0 1 4 19V5a1.5 1.5 0 0 1 1.5-1.5H9" /><path d="M16 16.5 20.5 12 16 7.5" /><path d="M20.5 12H9" /></>,
  'log-in': <><path d="M15 3.5h3.5A1.5 1.5 0 0 1 20 5v14a1.5 1.5 0 0 1-1.5 1.5H15" /><path d="M10 16.5 14.5 12 10 7.5" /><path d="M14.5 12h-11" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5v.2a2 2 0 0 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1h.2a2 2 0 0 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z" /></>,
  more: <><circle cx="5.5" cy="12" r="1.4" fill="currentColor" /><circle cx="12" cy="12" r="1.4" fill="currentColor" /><circle cx="18.5" cy="12" r="1.4" fill="currentColor" /></>,
  grid: <><rect x="4" y="4" width="6.5" height="6.5" rx="1.5" /><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" /><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" /><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5" /></>,
  menu: <><path d="M4 6.5h16M4 12h16M4 17.5h16" /></>,
  refresh: <><path d="M20 11A8 8 0 0 0 5.6 6.4L3.8 8.2" /><path d="M3.8 3.8v4.4h4.4" /><path d="M4 13a8 8 0 0 0 14.4 4.6l1.8-1.8" /><path d="M20.2 20.2v-4.4h-4.4" /></>,
  leaf: <><path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.5 19 2c1 2 2 4.2 2 8 0 5.5-4.8 10-10 10z" /><path d="M2.5 21c0-3 1.9-5.4 5.1-6.1 2.4-.5 4.4-1.6 5.4-2.9" /></>,
  dollar: <><path d="M12 2.5v19" /><path d="M16.5 6.5H10a3 3 0 0 0 0 6h4a3 3 0 0 1 0 6H7" /></>,
  receipt: <><path d="M5 2.5h14v19l-2.4-1.5-2.3 1.5-2.3-1.5-2.3 1.5-2.3-1.5L5 21.5z" /><path d="M8.5 7.5h7M8.5 11h7M8.5 14.5h4" /></>,
  file: <><path d="M14 2.5H6.5A1.5 1.5 0 0 0 5 4v16a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 20V7.5z" /><path d="M14 2.5v5h5M8.5 13h7M8.5 16.5h5" /></>,
  paperclip: <><path d="m20.5 11.2-8.6 8.6a5.6 5.6 0 0 1-7.9-7.9l8.6-8.6a3.8 3.8 0 0 1 5.3 5.3l-8.6 8.6a1.9 1.9 0 0 1-2.7-2.7l7.9-7.9" /></>,
  image: <><rect x="3" y="3.5" width="18" height="17" rx="2" /><circle cx="9" cy="9" r="1.8" /><path d="m21 15.5-5-5L5 20.5" /></>,
  phone: <><rect x="6.5" y="2.5" width="11" height="19" rx="2.5" /><path d="M11 18.5h2" /></>,
  tablet: <><rect x="4.5" y="2.5" width="15" height="19" rx="2" /><path d="M11 18.5h2" /></>,
  laptop: <><rect x="4" y="5" width="16" height="11" rx="1.5" /><path d="M2 19.5h20" /></>,
  watch: <><rect x="6.5" y="6.5" width="11" height="11" rx="3" /><path d="m9 6.5.5-4h5l.5 4M9 17.5l.5 4h5l.5-4" /><path d="M12 9.8v2.4l1.4 1" /></>,
  globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18" /><path d="M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18z" /></>,
  mail: <><rect x="2.5" y="5" width="19" height="14" rx="2" /><path d="m3 6.5 9 6.5 9-6.5" /></>,
  heart: <><path d="M12 20.5s-8-4.6-8-10.4a4.4 4.4 0 0 1 8-2.7 4.4 4.4 0 0 1 8 2.7c0 5.8-8 10.4-8 10.4z" /></>,
  star: <><path d="m12 3 2.7 5.6 6.1.8-4.4 4.3 1 6.1L12 17l-5.5 2.8 1-6.1-4.4-4.3 6.1-.8z" /></>,
} satisfies Record<string, ReactElement>;

export type IconName = keyof typeof SYMBOLS;

const NAMES = Object.keys(SYMBOLS) as IconName[];
/** Symbol ids carry the fp- prefix too, so they can't collide with an id on a page. */
const symbolId = (name: IconName) => `fp-i-${name}`;

/**
 * The sprite every <Icon> points at. Mount it exactly once, high in the tree (the
 * app shell), so the public pages (sign-in, guest welcome) have it too. Memoised:
 * it never changes, so the shell re-rendering never re-renders the symbols.
 */
export const IconSprite = memo(function IconSprite() {
  return (
    <svg className="fp-sprite" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false" data-icon-sprite>
      {NAMES.map((name) => (
        <symbol key={name} id={symbolId(name)} viewBox="0 0 24 24">
          {SYMBOLS[name]}
        </symbol>
      ))}
    </svg>
  );
});

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'children' | 'name'> {
  name: IconName;
  /** Makes the icon an image with this accessible name. Omit for decorative icons. */
  title?: string;
}

export function Icon({ name, title, className, ...rest }: IconProps) {
  const labelled = title
    ? { role: 'img' as const, 'aria-label': title }
    : { 'aria-hidden': true as const };
  return (
    <svg className={className ? `fp-icon ${className}` : 'fp-icon'} focusable="false" {...labelled} {...rest}>
      {title ? <title>{title}</title> : null}
      <use href={`#${symbolId(name)}`} />
    </svg>
  );
}
