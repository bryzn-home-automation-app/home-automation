# HomeOS redesign — brief shared by all three concepts

The owner (Bryan) asked for a more modern, sophisticated UI for his family's home app that stays **simple for its everyday users**,
where **every tab feels like part of one app** (same layout logic everywhere) while each tab still has **something unique about its
purpose**. He will compare three concepts against what he has today and pick one. Each concept is a clickable HTML prototype of the
whole app (19 screens), built to `proto/_shared/CONTRACT.md`.

The app: a self-hosted home dashboard for one household in North Texas. Used daily, mostly on iPhones as a Home Screen app, also on a
desktop browser. People: Bryan (admin), Mai and Linh (members), occasional guests. Roles: admin sees everything; members see everything
except admin tools; guests do not see Cameras or Maintenance.

## What is wrong today (fix these in every concept)

1. **The header eats the phone screen.** A shared header card (brand row, eyebrow pill, title, greeting, pixel-art strip, three status
   chips) takes ~250–300px on every tab, and ten pages add a second hero card with another title and a marketing sentence. Content
   starts below the fold. → One compact header. Exactly one title per page. Content in the first screen.
2. **Operator jargon in a family app.** "Operations Console", "Backend Healthy", "Access Admin", "Modules", "Phase 1 · CoServ
   Integration", "AC/Heat Ecobee", "MAE", "missions", raw enums (ELECTRICAL, IN PROGRESS, ADMIN), raw ISO dates. → Plain words.
3. **Alerts are buried** (a small bell at the bottom of the menu). → Alerts get a first-class, always-visible entry with the unread count.
4. **Tabs look like three different apps.** 5 card radii, ~25 shadows, 8 primary-button variants, 8 segmented-control implementations,
   2 status-colour systems, 6 loading patterns, 231 emoji used as icons next to a few SVGs, 6 different ways a page begins.
   → One page skeleton, one card, one button family, one segmented control, one badge, one icon set, one set of loading/empty/error states.
5. **No verdict.** Pages show many equal-weight tiles; the person has to work out "is everything OK?" themselves. → Every page opens
   with the answer to the question the person came with (see table below), then the detail.
6. **Nested scroll boxes** (lists that scroll inside the scrolling page) and hover-only information (tooltips) on a phone-first app.
   → The page scrolls, nothing else. Nothing important is hover-only.
7. **Desktop has no max width**; cards stretch edge to edge on wide monitors.
8. **Primary actions are hidden** (Roomba "Clean" is one of six equal tiles in a card labelled "Admin").

## Information architecture (identical in all three concepts — only its presentation differs)

| group | route id | label | notes |
|---|---|---|---|
| Everyday | `home` | Home | |
| | `utility` | Utilities | sub-views Electric · Gas · Water (Electric has "Usage & bills" and "Forecast & stats") |
| | `climate` | Climate | was "AC/Heat Ecobee" |
| | `cameras` | Cameras | sub-views Live · Recordings. Hidden for guests |
| | `roomba` | Roomba | sub-views Overview · Maintenance (robot parts) |
| House | `maintenance` | Maintenance | home upkeep log. Hidden for guests |
| | `wifi` | Guest Wi-Fi | |
| | `people` | People | was "Users" |
| You | `alerts` | Alerts | was "Notifications"; shows unread count everywhere it is linked |
| | `profile` | Profile | appearance, phone alerts, link this device |
| | `whats-new` | What's new | |
| Admin (admin only, `data-role-only="admin"`) | `admin-presence` | Who's home | |
| | `admin-guests` | Guests | |
| | `admin-logs` | Activity log | was "Audit Logs" |
| | `admin-usage` | App usage | |
| | `admin-nuc` | Server health | was "NUC Health" |
| | `admin-debug` | Diagnostics | was "Debug" (tabs Overview · Sync · Events · Forecast · Tools) |
| Public (`data-chrome="none"`) | `login` | Sign in | |
| | `guest-portal` | Guest welcome | guest sign-in + lobby in one screen (name, invite code → who's at the house) |

Phone bottom bar: the five Everyday destinations must be one tap away (plus a way to reach everything else and Alerts).

## The one page skeleton (each concept draws it its own way, but the ORDER is the same on every tab)

1. **Title** (one, from the shell) — short label, no marketing copy.
2. **The answer** — the page's verdict in plain words, with the page's hero element (see "unique element" below).
3. **Key facts** — at most 3–4 numbers/readouts that back the answer.
4. **View switch** (only if the page has sub-views) — one segmented control style everywhere.
5. **Detail cards** — charts, lists, history. Rarely-needed or technical material is collapsed behind a disclosure, not deleted.
6. **Actions** — the primary action is visually primary and near the top when the page is about doing (Roomba, Climate, Wi-Fi, Maintenance).

Nothing from the current app is dropped: every function described in the specs must have a home in the prototype (it may be reorganised,
shortened, or tucked into a disclosure / dialog). Dialogs to include at least: 24-hour forecast (Home), bill viewer (Utilities), confirm
thermostat change (Climate), recording player (Cameras), start-a-clean and run detail (Roomba), add/edit record + record detail
(Maintenance), enlarged QR (Wi-Fi), edit profile (Profile), event detail (Diagnostics).

## What each page must answer first, and its unique element

| page | the question | the answer (example wording) | unique element to celebrate |
|---|---|---|---|
| Home | Do I need to do anything? What's it like outside? | weather now + next hours; anything needing attention; who's home | the "house at a glance": outside + inside in one look; shortcuts to every tab |
| Utilities · Electric | What will the bill be? Are we using more than usual? | predicted bill for this cycle ($114, Nov 5–Dec 5, 26 days left); yesterday vs predicted | actual-vs-predicted usage with a Today marker; usage vs temperature |
| Utilities · Gas | What was the gas bill and why? | last bill $37.23; more than half is fixed charges; next bill ~Dec 9 | the fixed-vs-usage split of the bill |
| Utilities · Water | What is due and when? | latest bill $110.67 due Nov 24; 11,400 gal | five-part charge breakdown |
| Climate | What temperature is it inside, what is it set to? | current temp per thermostat, mode, setpoints; change it | the thermostat control itself; who changed it last (person vs schedule) |
| Cameras | Is anything happening? Show me. | live tiles; last motion; battery | the camera views; recordings by day |
| Roomba | Is it running, is it OK? Start a clean. | state sentence, battery, big Clean action | the family's own floor map with the live robot dot and named rooms |
| Maintenance | What needs doing next? When was X last done and what did it cost? | next due / overdue jobs; recent work; yearly spend | the house's logbook / timeline, warranties, receipts |
| Guest Wi-Fi | Let a guest join. | big QR, network name, password, copy | hand-your-phone-to-a-guest moment |
| People | Who's in the household, who's online? | roster with roles + online; approvals for admin | faces + personal accent colours |
| Alerts | What happened? What's unread? | newest first, grouped by day, severity visible; mark all read | the house's voice |
| Profile | Change how the app looks; phone alerts. | appearance (light/dark/auto + palette), phone alerts, alert types, weather alerts, this device | the person's accent colour and avatar |
| What's new | What changed? | latest release in plain language; older ones collapsed | friendly changelog (New / Improved / Fixed) |
| Who's home | Is everyone home? | person cards Home/Away since…; devices behind a disclosure | people as the hero |
| Guests | Who has guest access, until when? | active guests + expiry; invite a guest | the door list |
| Activity log | Who did what, when? | day-grouped timeline (sign-ins, thermostat changes, guests) | "who turned the heat up?" |
| App usage | Which tabs earn their place? | top tabs + per person | the app's own screen-time report |
| Server health | Is the home server OK? | one verdict + six vital signs; trends | the vital-signs cluster |
| Diagnostics | Did last night's data arrive? Is anything erroring? | one verdict ("Data is up to date") + 14-day coverage strip; manual sync | the data-pipeline story |
| Sign in | Let me in. | one big "Sign in with Home" button; guest link | the front door |
| Guest welcome | I'm visiting. | name + invite code → welcome + who's around | the welcome mat |

## Content rules (all concepts)

- Take real content and sample values **verbatim from the specs** in `scratchpad/specs/*.md` (home, utility, climate-cameras, roomba,
  maintenance-wifi-guest, account, admin, shell) so all three concepts show the same household and the same numbers. Fixtures with more
  data are in `scratchpad/fixtures/*.json` (large — peek, don't load whole). "Now" is Mon Nov 9 2026, about 5:00 PM.
- Sentence case everywhere. Plain verbs. No operator jargon on family pages; admin pages may be technical but use the same components.
- Formats: dates "Mon, Nov 9" (add the year only when it is not this year); times "5:00 PM"; money "$114.20" (no cents on large estimates:
  "about $114"); ranges "Nov 5 – Dec 5"; relative "2 hr ago"; numbers grouped "11,400 gal"; temperatures °F (server temps too).
- Status vocabulary: **OK** (green), **Heads-up** (amber), **Problem** (red), **Info** (blue/neutral) — always with a word or icon, never colour alone.
- Role labels: Admin, Member, Guest.
- Every list has an empty state that says what will appear; every data card has an error state with "Try again" (show at least one
  example of each somewhere in the prototype, e.g. in Diagnostics or as a secondary tab state).
- Freshness: show "Updated 5:00 PM" style cues where data is live or synced.
- Technical/rare material goes behind a disclosure ("Show details", "For the curious", "Manage devices").

## Craft rules

- Read `proto/_shared/CONTRACT.md` and follow it exactly (file layout, data-attributes, quality floor).
- Charts: inline SVG with a `viewBox` and `preserveAspectRatio`, drawn from data without measuring the DOM (screens are `hidden` when
  the page loads, so `getBoundingClientRect()` returns 0). Chart colours come from CSS custom properties so both themes work without re-rendering.
- Icons: an inline SVG sprite in `shell.html` (`<symbol id="i-…">`), used as `<svg class="icon"><use href="#i-name"/></svg>`.
- The same component must look the same on every screen. If you need something the kit does not have, compose it from kit pieces.
- Phone (390px) first; then make 1440px genuinely good, not a stretched phone.
