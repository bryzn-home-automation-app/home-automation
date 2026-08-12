# UI Improvements — `home-automation` Frontend

Evaluation date: 2026-08-11
Scope: `frontend/src/**` (App shell, pages, components, contexts, styles)

## What's working well

- **Design system is well-scoped.** All visual tokens (`--appbg`, `--appaccent`, etc.) flow through one CSS file (`frontend/src/index.css`) and `ThemeContext` toggles `data-theme` on the html element. Adding or rebranding a color is a one-file change.
- **Theme implementation is correct.** `ThemeContext` reads `localStorage`, falls back to `prefers-color-scheme`, and re-syncs when the OS preference changes. Persistence survives reloads.
- **Performance primitives are real, not theater.** `content-visibility: auto` on `.perf-section`, `DeferredRender` (IntersectionObserver), `VirtualizedList` (windowing), `manualChunks: { recharts: ['recharts'] }` in `vite.config.ts`. The hooks are actually used (`ElectricalUsage` wraps charts in `DeferredRender`, the usage log uses `VirtualizedList`).
- **Loading / empty / error states exist** on the components reviewed (StatTile skeleton, UsageChart empty placeholder, VirtualizedList "No usage data yet" message).
- **Responsive layout is consistent.** Sidebar collapses on `<lg`, bottom nav appears, and module cards re-flow. No two-page-shift jank.
- **Icons are inline SVG** (StatTile's `Icons` map) — no icon-font weight, themable via `currentColor`.
- **Accessibility isn't forgotten.** Theme toggle has `aria-label` + `title`, mobile menu has `aria-label`, focus rings via `focus-visible:ring-appaccent`.

## What's hurting the experience

### 1. The header is doing three jobs badly — not a dashboard, not a hero, not a status bar

`frontend/src/App.tsx:253-294` renders a `<header>` with a 4-line copy block ("Operations Console" eyebrow + "Utilities, alerts, and automations in one left-rail workspace." + a paragraph) and three small status tiles alongside it. The copy is *the same on every page*. A page that shows electric usage, a page that shows admin audit logs, and a page that shows the guest list all greet you with "Utilities, alerts, and automations in one left-rail workspace." That's not onboarding — it's noise.

Also, the three right-side tiles (Backend / Unread / Access) duplicate the same info already visible in the sidebar ("API Up" / role badge). It's reading twice in one viewport.

**Recommendation:** Make the header a *real* page header that each page sets via a `useDocumentTitle` / `<PageHeader title=... subtitle=... />` component, and drop the redundant status tiles (or move them to a single small pill row in the top-right). The current copy is a relic from when this was a marketing-style landing.

### 2. The "Modules" grid on Home overlaps content from `useUsageData` and lies about data freshness

`frontend/src/pages/HomeSummary.tsx:97-104` builds the `modules` array from `electricUsage.data?.length`, `gasUsage.data?.length`, etc. The pill says "Live" for Electric, but the "detail" string just shows the record count from the API — which is the *length of the array returned*, not whether the data is current. With pagination, that's misleading; without pagination, it's tautological.

Worse, the *Household* card hardcodes `2 members` (`HomeSummary.tsx:146`) and the *WiFi* card's pill reuses the same `guestCount.data` as the Users card. So clicking Users shows "2 members, 0 guests" and clicking WiFi shows the same "0 guests" but framed as WiFi traffic. Two different labels, one signal.

**Recommendation:** Either derive "Live" / "Tracking" pills from `lastElectricReading` (already in `/api/config`) or drop the pill entirely. Fix the hardcoded `2` to come from an actual API call. WiFi's "guests online" should be wired to a real WiFi presence signal, not the auth guest count.

### 3. The theme toggle thumb is a 🌙 / ☀️ glyph on a white circle — fights the dark theme

`frontend/src/index.css:198-205` defines `.theme-toggle-thumb` as a hardcoded `bg-white` circle. In dark mode the rest of the chrome is `bg-appbg` / `bg-appsurface-raised`, and the toggle thumb is a bright white disc with a moon emoji. It's a stock-control element; the rest of the app has been carefully themed. The thumb should be `bg-appbg` (dark) when in dark mode and `bg-white` when in light mode, or — better — use a pill-track design (`bg-appaccent` in active state, `bg-appinset` in inactive) so the toggle visually communicates "this is the selected mode."

**Recommendation:** Replace the white disc with a token-driven thumb. Bonus: the current thumb emoji loses in light mode because the label says "🌙" when dark and "☀️" when light, but the thumb's *position* tells you what the current theme is — the emoji duplicates the indicator. Use the emoji as the *only* state marker (drop the position transition), or drop the emoji and use just the position.

### 4. The maintenance dashboard is 45 KB on disk, single component, ~1100 lines

`frontend/src/pages/MaintenanceDashboard.tsx` is **45,954 bytes** with no sub-components extracted. Per file size it's the second-heaviest file in the entire `frontend/src` tree (after `GuestHome.tsx` at 25 KB). At that size it's almost certainly a kitchen-sink page with inline forms, tables, modals, and chart logic all jammed together. That makes it:

- unmaintainable (a 1100-line React component has 4+ unrelated state machines)
- unskippable for the lazy-loaded code split (it's bundled as one chunk, so the *whole* thing loads when the user clicks the tab)
- impossible to test in pieces (the existing test suite is auth/guards/login only)

**Recommendation:** Extract sub-components (`TaskForm`, `TaskList`, `TaskRow`, `ScheduleCalendar`, `CostChart`, etc.) into `frontend/src/components/maintenance/`. Each should be small enough to memo. The current shape makes Phase 4 ("Home Intelligence — mortgage tracking, maintenance history, documents") painful to layer on top.

### 5. The "guests" URL surface is duplicated and has two different pages

- `frontend/src/main.tsx:68` — `/guest` → `GuestLogin.tsx` (sign-in)
- `frontend/src/main.tsx:69` — `/guest/home` → `GuestHome.tsx` (their dashboard, 25 KB)
- `frontend/src/pages/admin/GuestManagement.tsx` — admin-side guest table

Three files, three surfaces, all named "guest" — but the first two are auth flows and the third is an admin tool. A guest scanning a QR code lands on `/guest`, enters their name, then lands on `/guest/home`. An admin looking at who's connected opens `GuestManagement`. The names are close enough that grepping for "guest" returns 40+ hits in the frontend.

**Recommendation:** Rename to disambiguate. `/guest/login` + `/guest/dashboard` for the public surfaces, or move the public guest pages under a `pages/guest/` directory next to the existing `pages/admin/`. Right now `pages/` mixes auth, dashboards, and admin tools in one flat directory.

### 6. Charts reuse the same `Trend` eyebrow + 11px uppercase label, with no real hierarchy

Every chart panel renders:

```jsx
<p className="text-[11px] font-medium uppercase tracking-[0.18em] text-apptext-muted">Trend</p>
<h3 className="mt-2 text-lg font-semibold text-apptext">{title}</h3>
```

across `UsageChart`, `MonthlyComparison`, `Weather24HourCard`, `WeatherContextCard`, `UsageWeatherChart`, the Home Usage Feed, the Notifications feed, the Maintenance section, and the Roomba tab. When you scroll the Electric page you see "TREND", "TREND", "WEATHER", "TREND" stacked under the same 11px muted caps. The eyebrow was meant to give type a rhythm; instead it makes every section indistinguishable.

**Recommendation:** Make eyebrows *carry information* — "Daily trend", "Hourly granularity", "30-day period totals" — or kill them and let the `h3` do its job. Right now the eyebrow text is a CSS experiment at the cost of scanning speed.

### 7. The estimated bill is anchored to "60 days" but the math is actually a moving window

`HomeSummary.tsx:19-21`:

```ts
const elecKwh = electricTotal.data?.totalKwh ?? 0;
const gasKwh = gasTotal.data?.totalKwh ?? 0;
const totalKwh = elecKwh + gasKwh;
const estimatedBill = totalKwh * kwhRate;
```

`p` label on screen: "Combined 60-day usage · ~$X estimated bill". The text is honest about the 60-day window, but the *meaning* of the number is "$X over the last 60 days," not "your estimated monthly bill." A user landing on the page will read this as "my bill is $X." Then `ElectricalUsage.tsx:226` shows "Estimated 60-Day Cost" with the same multiplication. So we have two surfaces both saying "estimated bill" but the math is the same sum.

**Recommendation:** Either compute the *monthly* projection (60-day total × 0.5, or 30-day avg × 30) and label it "Monthly estimate", or label the current number correctly as "60-day spend" and stop calling it a bill. Right now there's a quiet lie in the UI.

### 8. Accessibility gaps

Caught by reading the components, not by running an audit:

- **Sidebar nav links** (`App.tsx:107-159`) use `NavLink` with `aria-current` via the active class, but no `aria-label` distinguishes the main nav from the admin section.
- **The mobile bottom nav** (`App.tsx:308-333`) renders an unread badge with `className="absolute -top-0.5 right-1..."` but the parent `<NavLink>` is `flex flex-col items-center` — `position: absolute` here is fragile and the badge likely renders off the visible button in some cases. The unread count also has no `aria-label` like "Alerts, 3 unread" — screen reader users just hear "Alerts".
- **The home page "Modules" grid** is a list of 6 `<Link>` elements. A screen reader will read them as 6 consecutive links with no grouping — no `<nav>`, no `aria-label` on the section. Wrap in `<nav aria-label="System modules">`.
- **Color is the only signal in the hourly log badges** (`ElectricalUsage.tsx:194-198` — green < 2, yellow 2-4, red 5+). Add an `aria-label` like "2.3 kWh, medium" so the color is redundant, not load-bearing.
- **Focus trap missing on the mobile sidebar overlay.** It opens with a backdrop and slide-in panel (`App.tsx:238-250`) but `<Escape>` doesn't close it and focus is not moved into the panel when it opens. Keyboard users have to tab through the whole page behind the backdrop.

### 9. `StatTile` doesn't use its `trend` prop anywhere

`frontend/src/components/StatTile.tsx:7` declares `trend?: { direction, pct }` and renders a colored arrow + "vs last month" (lines 52-64), but no call site passes `trend`. It's a 14-line block of dead UI code that just waits for someone to wire it up. Either:

- compute the delta in `useUsageData` (7-day avg vs 30-day avg, e.g.) and pass it to all four tiles on `ElectricalUsage` and `HomeSummary`, or
- delete the prop and the render branch.

Dead UI is more dangerous than dead backend code — designers and PMs will *screenshot* it and add it to a deck.

### 10. The Maintenance and Admin paths are visually identical to user pages — no hierarchy signal

`App.tsx:148` uses `border-amber-300/40 bg-amber-300/15` for the admin nav rows. That's the only place in the app that introduces a non-emerald color for chrome — and it's hardcoded (`amber-300`), not driven by the design system tokens. If you ever change the accent, the admin "branding" silently becomes the wrong shade. Worse, the badge text in the header copy says "Admin" (`App.tsx:290`) but there's no persistent visual cue in the header itself that you're in an admin zone — a maintenance page and a user page look the same.

**Recommendation:** Either make admin chrome *visibly distinct* (a thin amber bar across the top of the page when `isAdmin` is true, or a section label inside the header), or remove the hardcoded amber and unify. The current halfway-state is a code smell.

## What I'd ship first (ordered by ROI)

1. **Fix the header copy per page** (1 day, biggest UX win). Add a `PageHeader` component, set per route. Drops the static "Operations Console" tagline from every page.
2. **Re-label "60-day spend" honestly** (30 min). The current "estimated bill" copy is the kind of thing a user screenshots and complains about.
3. **Add escape-to-close + focus trap on the mobile sidebar** (2-3 hrs). Pure a11y win, no design risk.
4. **Replace the theme toggle thumb** (1 hr). One file (`index.css`), one token.
5. **Wire `StatTile.trend` to real data or delete the prop** (2-4 hrs depending on how the delta logic is computed). Either path is small.
6. **Extract maintenance sub-components** (1-2 days, but pays back every time you touch that page).
7. **Rename `/guest` routes and reorganize `pages/`** (half day). Pure naming, but compounds forever after.

Items 8-10 are "should fix before the next feature ships"; items 1-4 are "fix this week if you can."

## What I did *not* find

- No broken imports or dead exports on the happy path.
- No inline `style={{}}` that should be tokens (with the one exception of the hardcoded gradient in `App.tsx:217-219`, which is fine because it's the *page background*, not a component).
- No untranslated `Math.random()` for layout IDs (good — no SSR hydration landmines).
- No `useEffect` doing data fetching that should be a `useQuery` (every async fetch in the files reviewed is in a query).
- The lazy-loaded routes are sensibly split; admin pages are behind a separate `<AdminRoute>` so they only load for admins.

The codebase is in better shape than most home-automation projects at this stage. The above is polish + honesty work, not "rebuild the UI" work.
