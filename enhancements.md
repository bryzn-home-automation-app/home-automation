# Speed & Responsiveness Enhancements — `home-automation` UI

Goal: faster first paint, snappier tab switches, smoother charts, less data over the wire. No loss of fidelity — same numbers, same screens, just cheaper to get there.

## What's already good (don't redo)

- `vite.config.ts` has `manualChunks: { recharts: ['recharts'] }` — recharts is already split into its own bundle.
- `useUsageData` centralizes five `useQuery` calls so React Query's cache deduplicates across all pages that consume the hook.
- `content-visibility: auto` is set on `.perf-section`, `VirtualizedList` does windowing, `DeferredRender` lazy-mounts via `IntersectionObserver`.
- React Query defaults to `staleTime: 300_000` and `refetchOnWindowFocus: false` — no surprise refetches on tab focus.

So the bones are right. The wins below are about how the bones carry weight.

---

## Findings, ordered by ROI

### 1. The single biggest win: stop fetching every record, then aggregating client-side

**Where:** `frontend/src/hooks/useUsageData.ts:27-67` calls `/api/energy-usage/meter/{id}/recent?days=60`, which returns *every row* for 60 days. The frontend then loops over the array *three times* (`ElectricalUsage.tsx:50-72`, `HomeSummary.tsx:24-56`) to build daily/hourly maps for charts and the usage log.

At 60 days × 24 hours = **1,440 rows per meter**, two meters = 2,880 rows. Each row is ~200 bytes of JSON (id, meterId, timestamp, usageKwh, cost, source, sourceProvider, ingestionBatchId, processingVersion, createdAt — the full `EnergyUsage` entity, see `frontend/src/types/index.ts:34-46` and the `getAll` route at `EnergyUsageController.java:24-27`). That's ~570 KB raw JSON, with `createdAt` + `ingestionBatchId` + `processingVersion` carried on every single row even though the UI never displays them.

Three concrete changes, each independently small:

- **a.** Add a `?fields=` (or fixed projection) param to the `/recent` endpoint that returns only the columns the UI actually uses: `id, timestamp, usageKwh, source, sourceProvider`. Drops payload ~70%. The unused fields `meterId` (already in the path), `meter` (Hibernate-joined object — every row currently serializes the same meter twice), `cost`, `ingestionBatchId`, `processingVersion`, `createdAt` are dead weight in the JSON.
- **b.** Add server-side aggregation endpoints. The pattern of "filter to `source === 'CoServ Average Usage'`, then group by date summing `usageKwh`" happens *four times* in the frontend (`HomeSummary.tsx:24-56`, `ElectricalUsage.tsx:50-72`, `UsageChart.tsx:105-119`, `UsageWeatherChart.tsx:171-189`). Replace them with one endpoint: `GET /api/energy-usage/meter/{id}/daily?days=60` returning `[{ date, kWh, source }]`. The chart then receives ~60 rows instead of 1,440. The hourly filter becomes `?granularity=hourly`.
- **c.** Stop the `meter` nested object on every row. `EnergyUsage.meter` is a JPA relationship that the controller is serializing (Jackson default) — but the UI never reads it; it has `meterId` already. Either `@JsonIgnore` on the field, or use a DTO in the controller (`@GetMapping("/recent")` returns `EnergyUsage` directly, line 50-56 of `EnergyUsageController.java`). Switching to a DTO also unlocks the field projection in (a).

**Impact:** first paint of the Electric tab drops from "fetch 2,880 rows, then loop them 3 times" to "fetch 60 pre-aggregated daily rows." That's the difference between seeing a skeleton for ~600 ms and seeing data in ~80 ms on a typical connection.

**Data fidelity:** zero. Same numbers, same axes, same labels — just computed once on the server.

### 2. The Electric tab is making **4 sequential round-trips** to mount

**Where:** `ElectricalUsage.tsx:107-153`. On mount:
1. `useUsageData()` fires 5 queries (meters, config, electricUsage, gasUsage, electricTotal, gasTotal).
2. Once `electricMeter` resolves, `fetchWeatherForRange(start, end)` fires.
3. Once `weather` resolves, `summaryQueries` (4 calls, `useQueries`) fires for the 4 period cards (month, quarter, year, lifetime).

Step 2 waits on step 1. Step 3 waits on step 2. Even with the cache, the *first* visit to this tab is a chain of round-trips.

Two changes:

- **a.** Fire the period summary queries in parallel with weather — neither depends on the other. Move them to the top level of the hook, or split the page so the summary grid and the chart are independent mount units.
- **b.** Use a single batched "page" endpoint for the Electric tab: `GET /api/electric-page?days=60` returning `{ daily: [...], hourly: [...], summaries: { month, quarter, year, lifetime }, weather: {...}, config: {...}, lastReading: ... }`. Server-side this is one SQL connection's worth of work and one JSON response.

**Impact:** first Electric-tab paint becomes a single round-trip instead of a chain. On a 50 ms RTT, that's a 250-400 ms win before the data even shows up.

**Data fidelity:** zero. Same data, same fields, same numbers — just one envelope.

### 3. The summary cards make 4 round-trips to compute values the server could compute in one query

**Where:** `ElectricalUsage.tsx:143-173`. `useQueries` fires 4 separate `GET /api/energy-usage/meter/{id}/summary?start=...&end=...` calls (month, quarter, year, lifetime). Each one is a separate SQL round-trip to PostgreSQL.

On the server side, `EnergyUsageService.getSummary` (lines 48-79) makes **5 SQL queries per call** (`sumUsageBetween`, `avgUsageBetween`, `countByMeterIdAndTimestampBetween`, plus two `findFirstBy...` for highest/lowest). Four summary calls = **20 SQL queries** for one section of the Electric page.

Two changes:

- **a.** Server-side: write a single SQL CTE / native query that returns all four periods in one shot. Or use `GROUP BY date_trunc('month', timestamp)` for the rollups and a window function for highest/lowest per period. One query, four rows back.
- **b.** Client-side: same as #2b — fold the summaries into the page-level endpoint. The 4 call sites can read from a single object.

**Impact:** 20 SQL round-trips collapse to 1. The Electric page's "summary" section lights up as soon as the rest of the page does, not 200-400 ms after.

**Data fidelity:** zero. `start`/`end` are derived from `dataStartDate` in the config; the 4 windows are deterministic.

### 4. The chart range filter is recomputing the entire chart data on every keystroke / theme toggle

**Where:** `UsageChart.tsx:105-119` and `UsageWeatherChart.tsx:171-262` re-build their `byDate`/`byHour` maps and the final `chartData` array on every render. They're `useMemo`'d, but their dependency is the *full* `data` prop. When the parent re-renders (which happens any time the App shell re-renders, including theme toggle), if the prop reference changes, the work re-runs.

Worse: the parent `ElectricalUsage.tsx` builds a new `chartData` array via `useMemo` (line 43-48) on the same `realData` reference, so the inner memos are correct in steady state. But the *Recharts* `<LineChart>` and `<ResponsiveContainer>` re-mount when their parent re-renders because `margin` is a new object literal every render (`UsageChart.tsx:137`, `UsageWeatherChart.tsx:380`).

Concrete fixes:

- **a.** Move the object literals out of JSX into module-scope constants. `margin={{ top: 5, right: 10, left: 0, bottom: 5 }}` should be `const MARGIN = { top: 5, right: 10, left: 0, bottom: 5 } as const` at the top of the file. The same applies to `tick`, `axisLine`, `dot` props that are inline objects.
- **b.** Wrap `Line`, `XAxis`, `YAxis`, `CartesianGrid`, `Tooltip` in memoized sub-components so Recharts's `defaultProps` change-detection skips them on parent re-render.
- **c.** Theme changes (the biggest re-render trigger after the first paint) shouldn't invalidate the chart's data. Either pass `isDark` once and read it inside a memoized `<ChartTooltip>` subcomponent, or — better — only re-render the `Tooltip` contentStyle on theme change, not the whole chart.

**Impact:** chart updates on tab switch go from "rebuild 60 chart points, re-mount 8 Recharts children" to "pass the same memoized references down." Visible as: no jank when toggling the theme while looking at a chart.

**Data fidelity:** zero.

### 5. `VirtualizedList` rebuilds the slice on every scroll event

**Where:** `VirtualizedList.tsx:25-37` does `items.slice(start, end)` inside a `useMemo` whose deps include `items`. On every scroll, `scrollTop` changes → memo invalidates → `items.slice` runs again, even though `items` and `itemHeight` haven't changed.

Two fixes:

- **a.** Split the memo: keep a memo for `{ startIndex, endIndex, totalHeight, offsetTop }` keyed on `[items.length, itemHeight, height, scrollTop, overscan]`, and a *separate* memo (or just `useMemo` inline) for `items.slice(...)` keyed on `[items, startIndex, endIndex]`. With `items` being a stable reference, the slice memo only invalidates on actual scroll.
- **b.** Better: just call `items.slice` inline in render. For a windowed slice of ~20 items out of 30-100, the cost of a `slice` is negligible — the memo overhead is more than the work. Profile first, but my read is that *removing* the memo here is a win.

**Impact:** smooth scroll on the usage log (currently it can hitch when a parent state update invalidates the same memo).

**Data fidelity:** zero.

### 6. `IntersectionObserver` in `useDeferredMount` is created per-render

**Where:** `useDeferredMount.ts:13-34`. The `useEffect` deps are `[rootMargin, shouldRender, triggerOnce]`. `rootMargin` and `triggerOnce` are read from the `options` argument passed by the caller. If a caller writes `useDeferredMount({ rootMargin: '240px' })` (as `DeferredRender` does, line 19), a new object literal is created every render → the effect re-runs every render → the observer is torn down and recreated every render.

Two fixes:

- **a.** In `DeferredRender`, hoist the options object: `const DEFERRED_OPTIONS = { rootMargin: '240px' }` at module scope, or default `rootMargin` to the string in the hook signature (`useDeferredMount({ rootMargin }: { rootMargin?: string } = {})`) and pass `rootMargin` as a primitive prop.
- **b.** Inside the hook, use `useRef` to hold the latest `rootMargin` and read it in the callback. That way, prop changes don't tear down the observer unless the actual value changes.

**Impact:** measurable on pages that have multiple `<DeferredRender>` (Electric, Home). The effect-reattach cycle currently happens ~16×/sec on the React DevTools profiler; after the fix, it's once per mount.

**Data fidelity:** zero.

### 7. The "Modules" pill on Home Summary is recomputed every render

**Where:** `HomeSummary.tsx:97-104` builds a 6-element `modules` array on every render. Each iteration re-stringifies `electricUsage.data?.length`. The `m` variable (line 83) is shadowed — `m` is `maintenance.data` *and* the loop variable name on line 205 (`modules.map((m) => ...)`). The shadowing isn't a bug, but the `m.detail` field is `Loading...` for ~50 ms after every query refetch, which causes a visible flash.

Fix: build the modules array inside `useMemo` keyed on `[electricUsage.data, gasUsage.data, maintenance.data, unreadCount.data, guestCount.data]`. And rename the loop variable to `mod` to kill the shadow.

**Impact:** subtle — eliminates a re-render caused by the parent re-running the entire array build when an unrelated query (`config`) refetches.

**Data fidelity:** zero.

### 8. The 60-second `refetchInterval` is firing *six* queries simultaneously across the app

**Where:** `useUsageData.ts:35, 44, 55, 64` — four queries with `refetchInterval: 60_000`. `App.tsx:16-29` adds two more (`health`, `notifications-unread-count`) with the same interval. That's **6 parallel refetches** firing at roughly the same wall-clock time, every minute, regardless of which page the user is on.

Three fixes:

- **a.** Stagger the intervals with small jitter: `60_000 + Math.floor(Math.random() * 5_000)` so they don't stampede. With 6 simultaneous requests on every minute boundary, you're 6× the connection-pool pressure for ~200 ms.
- **b.** Pause the refetch when the tab is hidden: `useQuery({ refetchInterval: 60_000, refetchIntervalInBackground: false })` (this is the React Query default; just make sure it's set). The current code doesn't set it, so backgrounded tabs are still pinging.
- **c.** Even better: only refetch the data for the *active* tab. Lift `enabled` to depend on the current route, or split `useUsageData` per-page so the Gas page doesn't keep electric-usage queries alive when the user is on the Electric page.

**Impact:** quieter network, lower Postgres load, less battery. Visually invisible, operationally meaningful.

**Data fidelity:** zero. The data is the same; we just fetch it less.

### 9. The Maintenance and Roomba pages are loaded on first paint via the route tree

**Where:** `main.tsx:21-28` lazy-loads 9 page components. Good. But `SuspenseFallback` (line 46-56) is a single shared fallback that just shows "Loading..." — the *whole* page goes blank while the chunk downloads. For a 45 KB `MaintenanceDashboard` chunk, on a slow connection, that's a visible blank screen.

Fix: use route-level `Suspense` boundaries with `React.lazy` + per-route fallbacks that match the page's *shape* (a `StatTile` skeleton for the Electric page, a chart skeleton for the Weather page). Better yet, use a single `<PageSkeleton>` component with a `variant` prop. The user gets a layout-shaped placeholder instead of a generic spinner.

**Impact:** perceived time-to-interactive on the tab switch drops dramatically — users see a placeholder that looks like the page they were going to.

**Data fidelity:** zero. Placeholders don't carry data.

### 10. The hourly log table renders 48 rows *plus* a virtualized list

**Where:** `ElectricalUsage.tsx:407-444` — the hourly filter shows 48 rows via `<VirtualizedList height={432} itemHeight={58} overscan={6}>`. With 48 rows × 58 px = 2,784 px of content, only ~8 rows are ever in the viewport. But:

- The list allocates 48 row keys.
- Each row re-runs `getHourlyLevel(Number(d.usageKwh))` and `weatherByHour.get(...)` on every scroll.
- `weatherByHour` is a `Map` of every hourly temperature record over the full range — could be thousands of entries, scanned by string key per row.

Fix:

- **a.** Reduce `hourlyLogData` to the last 24 hours when "24h" filter is active (and 72, 168 for 3d/week) — the data the user actually wants. 48 rows is arbitrary.
- **b.** Pre-compute the level and the joined temperature per row at the data-prep stage, not at render time. Then the row component just reads a memoized derived field.
- **c.** Drop the unused `endIndex` line at `VirtualizedList.tsx:58` — it's a dead `endIndex === 0 ? null : null` ternary that reads as if it's doing something but does nothing.

**Impact:** hourly log scroll is smooth, no per-row map lookup.

**Data fidelity:** zero. Same rows, same numbers, just pre-joined.

### 11. Recharts `ResponsiveContainer` re-renders on every parent re-render

**Where:** every chart uses `<ResponsiveContainer width="100%" height={280} debounce={80}>`. The `debounce={80}` helps with resize events, but the *children* (the `<LineChart>`) re-render whenever the parent component re-renders, because the `margin` and `data` props are passed as fresh references.

Fix: wrap each chart's contents in a memoized sub-component. The pattern is:

```tsx
const ChartBody = memo(function ChartBody({ data, theme }) { ... });

<ResponsiveContainer>
  <LineChart data={data}>
    <ChartBody theme={theme} />
  </LineChart>
</ResponsiveContainer>
```

`LineChart` is already memoized internally, but its `data` prop is a new array reference from the parent's `useMemo` whenever the source data changes (which is correct). The internal memo can't help when the prop reference is fresh.

**Impact:** chart re-render on theme toggle goes from "rebuild the whole LineChart subtree" to "skip — props are unchanged."

**Data fidelity:** zero.

### 12. The `/api/energy-usage` GET (`EnergyUsageController.java:25-27`) is a footgun

**Where:** the bare `GET /api/energy-usage` endpoint (line 25) returns *every EnergyUsage row in the database* with no meter filter, no time filter, no pagination. If anyone in the codebase ever hits it, the response is unbounded.

The README says it's a compatibility view, but there's no rate limit, no max-rows cap, no `LIMIT` clause in `EnergyUsageService.getAll` (line 20-22, `repository.findAll()`).

Fix: either remove the endpoint (it doesn't appear to be used by the frontend — `fetchRecentUsage` is what's called), or add a hard cap of 1000 rows with a 400 response if no meter ID is supplied.

**Impact:** zero on the frontend (it doesn't use it), but eliminates a "page hangs" trap on the backend.

**Data fidelity:** zero.

### 13. The `loading` prop on the summary grid is a single boolean for 4 cards

**Where:** `UsageSummaryGrid.tsx:48` — `loading ? 'Loading...' : ...` is passed for the whole grid, but the data is per-card. When card 1 is loaded and card 4 isn't, the user sees "Loading..." on cards 2-4 but a number on card 1, with no visual distinction. From a perceived-speed standpoint this reads as "the page is half-loaded."

Fix: make `summary` per-card (each row carries its own `loading` flag from the corresponding `summaryQueries[i].isLoading`).

**Impact:** users see numbers as they arrive, not a binary "loading" state for the whole grid.

**Data fidelity:** zero.

---

## What I would *not* do

- **Don't virtualize the home page modules grid** — there are 6 items. Windowing has overhead, and 6 elements render in <1 ms.
- **Don't add IndexedDB caching** to the energy-usage endpoint. React Query's in-memory cache is enough; IndexedDB adds complexity (stale-on-update logic, schema migrations) without a real win when the data refreshes every 60 seconds.
- **Don't switch from Recharts** to a lighter library (uPlot, visx). Recharts is a known cost, but the rest of the app is already coded against it and the bundle is split. The wins above give you more for less migration pain.
- **Don't debounce the theme toggle** — instant feedback on theme is part of the experience.

## 30-day plan, in order

1. **#1c** (drop the nested `meter` object from the EnergyUsage DTO). One-line change in the JPA entity, instant ~30% payload reduction.
2. **#1a** (add `?fields=` projection to `/recent`). Half a day of work, ~70% payload reduction.
3. **#4** (hoist object literals in chart components). One hour, eliminates the theme-toggle jank.
4. **#6** (stabilize the `useDeferredMount` deps). One hour, fixes a per-render effect loop.
5. **#2a** (parallelize the weather + summary queries). One hour, drops a 200-400 ms chain.
6. **#1b** (server-side daily aggregation endpoint). Half a day, this is the chart-data shape change that pays back everywhere.
7. **#3a** (single SQL for the 4 summary periods). Half a day, the largest backend win.
8. **#8** (stagger refetch intervals). One hour of grep-and-edit.
9. **#5** (simplify `VirtualizedList`). One hour.
10. **#9** (per-page `Suspense` fallbacks). Two hours.

Items 1-5 are "ship this week." Items 6-8 are "ship this sprint." Items 9-10 are "ship when convenient."

The biggest single lever is **#1** (server-side aggregation + field projection). Together with **#3** (one-shot summary query), the Electric tab's first paint can plausibly drop from 600-800 ms to 100-200 ms without changing a single user-visible number.

The second-biggest lever is **#2** (one round-trip instead of a chain). The first-paint win there is a 250-400 ms saving on the tab's mount path.

Everything else is polish that compounds.
