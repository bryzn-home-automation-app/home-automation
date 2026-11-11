# Faceplate (v2): assembly and quality review

Final build: `proto/dist/v2.html` (1,329 KB, one self-contained file, 19 required routes plus the hidden `#kit-gallery`).
Final screenshots: `proto/v2/shots/` holds every route at phone (390 × 844 @2x) and desktop (1440 × 900), in light and dark,
both as the first screenful (`<route>-<vp>-<theme>.png`) and as the whole page (`…-full.png`). That is 160 images.

## How it was checked

- `build.js v2`: no warnings and no contract violations.
- `shoot.js v2` and `shoot.js v2 --full`: no horizontal overflow and no console errors at either size or in either theme.
- `qa/clickthrough.js` clicks every visible `[data-nav]`, every sub-tab key and every `[data-open-modal]` at phone and desktop.
  - It asserts the right screen, panel or dialog became visible.
  - For dialogs it also checks that each one fits the viewport, has a close control and an accessible name, and closes with Escape and with its close button.
  - It fails on any console error.
  - Final run: all passed. That covered 100 of 111 nav links, all 159 tab keys and 221 of 297 dialog triggers. The rest are hidden in the default state at both sizes: role-gated items, phone-only or desktop-only twins, and rows inside collapsed lists.
- `qa/probe.js` is new in this pass. It opens every route, every sub-view and every dialog with every `<details>` open, and clicks every trigger of every dialog so that script-filled dialogs are tested with real data. It runs at 390, 1440, 820 and 320 wide and reports:
  - a key/value label overlapped by its value
  - a clock time broken from its AM/PM
  - anything sticking out of the viewport
  - text clipped without an ellipsis

  Final run: nothing found.
- I looked at every route's full page at phone and desktop in both themes. I also looked at:
  - every sub-view at phone (light and dark) and desktop (light)
  - every dialog at phone (light and dark) and desktop (light)
  - tablet first screens
  - the guest and member role views

  I zoomed in at 2x where something looked off.

## What I changed in this pass

The five authors and an earlier QA pass had already done most of the work. Every screen follows the skeleton, uses the kit, and agrees on the household's numbers. An earlier QA pass moved the guest lobby and Who's home onto the kit's presence board. I fixed what was still wrong, preferring kit-level fixes so the same mistake can't recur on another page.

1. **Kit: key/value rows could not hold a long value.** The value was `nowrap` and the label could shrink to nothing. In Roomba's run detail, "Rooms" was printed underneath "Kitchen, as asked. iRobot hasn't confirmed it yet", and the six-room list did the same.
   - The value now keeps its natural width up to 75% of the row, then wraps under itself (balanced). The label takes the rest.
   - I diffed every kv row in the app before and after. Only the over-long values changed.
2. **Kit: a row's trail could spill out of the row.** A badge plus a value plus a chevron is wider than half the row, and the Roomba list was 4px too wide at 320px. Trails now wrap: "Stopped early" sits above "88 sq ft".
3. **Kit: off switches were nearly invisible in dark.** A dark knob sat in a dark well. The off knob now has a graphite edge in light and a graphite face in dark, so it reads as a control at about 3:1. The on state is unchanged.
4. **Typesetting pass (`app.js`)**, so these can't break across lines:
   - a clock time and its AM/PM ("Next: freeze, 6 / PM" on Profile, "1 and 8 / AM" in the weather preview)
   - a month and its day ("Nov / 15")
   - a figure and a short unit ("1,124 / sq ft")

   It runs once over the page and again over text that screen scripts write later (dialog details, counters). In the real app this belongs in the date and number formatters.
5. **Utilities, electric dial.** "PREDICTED BILL" collided with the forecast hatching and the last-bill tick. The centre stack now drops a little into the dial's open bottom and clears both.
6. **Numbers that disagreed between screens:**
   - Danny Tran asked to join at **3:02 PM**. People said 3:05 PM; Activity log and Who's home say 3:02 PM.
   - The Backyard clip is now at **4:22 PM**. The fixture had 4:34 PM, but the tile ("38 min ago"), the Cameras verdict and Home all say the last motion was at 4:22 PM. The change is made in the devices generator, not by hand.
7. **Jargon.** Roomba's "For the curious" said "Mission number" and "Mission ID", the exact word the brief bans. They are now "Run number" and "Run ID".
8. **Role preview.** Previewing as a guest showed "Bryan · Guest" on Profile. Profile, the edit dialog and the top-strip avatar now follow the role being previewed:
   - **Admin:** Bryan (sky), @bryan
   - **Member:** Mai (rose), mai@example.com
   - **Guest:** Alex (teal), "Guest pass until Wed, Dec 9"
9. **QA tooling** for whoever touches this next, all in `qa/`:
   - `probe.js`: layout probe, as above.
   - `clickthrough.js`: now waits for the 700 ms "Signing you in…" key before checking the route, has a `--kinds` filter, and reports why a panel has no size.
   - `zoom.js`: shoots any element or clip at 2x.
   - `trails.js`: lists wrapped row trails.
   - `sheet.js`, `jobs.js`, `montage.js`: contact sheets.
   - Before editing, I confirmed every generator (`_kit-tools/build-utility.js`, `_devices-tools/gen.js`, `_house-tools/gen-*.js`, `_you-tools/gen-whats-new.js`, `_admin-tools/gen-*.js`) reproduces its screen byte for byte. All my edits to generated screens went through the generators.
10. I removed the authors' private builds and shot folders (`dist/v2-*.html`, `v2/shots-*`).

## What is still weak

These are honest, roughly in the order the owner would notice them.

- **The verdict lamp has no written policy.**
  - Home ("A few things need a look") and Diagnostics show an amber lamp while listing a red row under it: server storage on Home, the Gmail sign-in on Diagnostics.
  - Cameras shows a blue lamp ("Someone was on the driveway") over two amber rows.

  Each can be defended on its own, but the rule isn't stated anywhere, and "status impossible to misread" is this concept's promise. A one-line rule is needed, for example "the lamp is the worst row listed, except that a person-sighting answer stays Info".
- **First screenful on a phone.** The answer and the instrument always fit. But:
  - On Home and Utilities the dial sits above the verdict, so the readout wells start just below the fold.
  - On Guest Wi-Fi and Maintenance the big primary key ("Show the code full screen", "Add a record") is one short scroll down. On Wi-Fi the QR itself answers the question, and tapping it enlarges it.
- **Admin pages stay dense.**
  - Diagnostics event titles carry raw scheduler names (`HourlySyncScheduler`).
  - The event dialog's title includes `(invalid_grant)`.

  They are allowed to be technical, but they are the least "family" part of the app.
- **Durations aren't formatted one way.** App usage writes "8 h 44 min" in mono in its meters and in Archivo in its table. Other pages say "2 hr 56 min". The kit has no duration rule.
- **Missing states.**
  - Climate and Cameras have no stale-data banner and no "can't reach Home Assistant" page state.
  - Roomba has no error state.
  - App usage and Server health have no in-page error.

  The prototype shows error-with-Try-again in Diagnostics (water bills), on the Garage tile and on Utilities · Water, and empty states in People, the Activity log filters, the Guests door list and Maintenance search.
- **Small type.**
  - Map room labels on a phone are 9.5px caps, below the 11.5px label size.
  - The water bill dial's "$110.67" fits its ring with little room to spare.
- **Role preview is partial.** Profile and the avatar follow the role, but People still marks Bryan as "You".
- **Tablet (820px)** uses the phone shell, as the IA says. The two-column instrument panel on Roomba and Cameras leaves white space under the map or tile.
- **Sign in on desktop** is a 460px card in a lot of empty enamel. It is right for a front door, but it is the plainest screen.
- **Visitor colours** are 12, not the spec's 32.
- **A behaviour change hides in the redesign.** Members can start a Roomba clean; today only admins can.
- **The light-theme daylight arc** is white on grey and relies on its legend to read as daylight rather than progress.

## How Faceplate maps onto the real codebase

Today: React 18 and Tailwind v4.
- `frontend/src/index.css` maps about 150 `--app*` CSS variables into `@theme` as `--color-app*`.
- Dark is the default theme. `ThemeContext` adds palettes, each with its own accent and six decorative tones.
- The shell is in `App.tsx`, with `PageHeader` and `PixelScene` on every page.
- There are 47 components and 25 pages (18 plus 7 admin).
- Charts use recharts, and motion uses framer-motion.

### Shared components it needs (most replace something that exists in several versions today)

| Faceplate piece | Replaces or absorbs |
|---|---|
| `AppShell`: TopStrip, KeyColumn, KeyRow, More sheet | the header card, `PageHeader`, the menu, the bottom bar in `App.tsx` |
| `InstrumentPanel` with `Verdict`, `Readouts`, `Readout`, `LampRow`, `AttentionList` | `StatTile`, `UsageSummaryGrid`, the ten hero cards |
| `Dial` (SVG, multi-ring, segments, marks, pointer, sweep) | thermostat card visuals, gauges in `NucHealth`, battery rings |
| `Panel` / `PanelHead` / `PanelFoot`, `Disclosure` (row and key variants) | five card radii and about 25 shadows |
| `Seg`, `Chips`, `Swatches` (one data-tabs-like API) | eight segmented-control implementations |
| `List`/`Row`, `DataTable` (stacks under 640px), `KV`, `Timeline`, `Board` (presence) | the many list, table and log layouts |
| `Button` family, `IconButton`, `Badge`, `Lamp`, `Tag`, `Count` | eight primary-button variants and two status-colour systems |
| `Field`, `Input`, `Select`, `Switch`, `Check`, `Stepper`, `Dropzone` | per-page forms, `ThermostatControls`, `AlertTypeSettings` toggles |
| `Dialog` (sheet on phone, centred on desktop; narrow, wide and full sizes) | the 10+ `*Modal.tsx` shells (`CleanModal`, `RoomSplitModal`, `BillPdfModal`…) |
| `Notice`, `Empty`, `ErrorState`, `Skeleton` | six loading patterns |
| `MediaFrame` (camera tile), `FloorMap` | `CameraTile`, `RoombaMap` (both keep their logic) |
| Charts: `LineChart`, `Bars`, `Stack`, `Heat`, `Diverge`, `Spark`, `Ring` | recharts usages in `ForecastChart`, `UsageWeatherChart`, `CameraBatteryChart`, `ThermostatHistoryChart`, `TrendOutlookChart`, `MonthlyComparison` |

The charts are the main decision.
- **Port the prototype's `charts.js` into small React SVG components.** It is about 31 KB, never measures the DOM, takes colours from tokens and always shows a readout line. Its value-not-hover-only readout is part of the concept.
- **Keep recharts and restyle it.** This is possible, but its hover tooltips fight that design.

### Themes, palettes and the pixel art

- **Tokens:**
  - `tokens.css` replaces the `--app*` set: `--appbg` becomes `--enamel`, `--appsurface` becomes `--panel`, `--appinset` becomes `--well`, `--apptext` becomes `--ink`, `--apptext-muted` becomes `--graphite`, and `--appborder` becomes `--hairline`.
  - `--appaccent*` is removed: selection becomes ink.
  - The `@theme` block keeps the same shape, so Tailwind utilities keep working with new names (`bg-panel`, `text-graphite`).
- **Default theme:** it flips from dark to light. "Auto" follows sunset at home (5:31 PM), which the Profile switchgear already offers.
- **Palettes:** they become enamel finishes (Default, Ocean, Sunset, Violet) that tint surfaces only. Ink, lamps and chart colours never change. The per-palette accent and the six decorative tones in `ThemeContext` go away. That is the biggest visible loss for anyone who chose a colourful palette. Personal colour survives as the avatar, the presence board and the guest badge.
- **Pixel-art scenes (`PixelScene`):** they leave the header. That header is what eats 250–300px of every phone screen today. They have no place in Faceplate's chrome. If the family is attached to them, they could live on as the sleep screen (`SleepScreen.tsx`) or an Easter egg in What's new, but I recommend retiring them.
- **Fonts:** Archivo (variable width) and DM Mono should be self-hosted. The app runs on the home server, so it should not depend on Google Fonts.

### Rough effort (one developer who knows the codebase)

| Work | Days |
|---|---|
| Tokens, Tailwind `@theme` mapping, ThemeContext finishes, fonts | 2 |
| Shell (strip, key column, key row, More sheet, Alerts lamp) and kit components | 5–6 |
| Dial and the chart set as React SVG components | 3–4 |
| 19 screens rebuilt on the kit (half a day to a day and a half each; Utilities, Diagnostics, Server health and Maintenance are the big ones) | 13–16 |
| Tests (the Vitest suites in `frontend/src/test/` assert on today's markup and text), Playwright checks like `qa/probe.js`, iPhone pass | 3–4 |
| **Total** | **about 26–32 days (5–6 weeks)** |

It can ship page by page behind the new shell, Home and Utilities first. They prove the kit, and the kit is already proven on them here.

### Risks

- **The iPhone bottom bar.** This prototype scrolls the window under a fixed key row. The real app had to move phone pages into their own scroll box in v1.9.2, because iOS 26 floats a fixed bottom bar while the window scrolls. The Faceplate shell must keep the v1.9.2 approach (scroll box, safe-area padding, `useScrollLock` for sheets), or the key row will drift again.
- **Light by default and zero accent colour** are the concept's identity, and also the change most likely to be felt as "less fun". Expect pushback from family members who picked a bright palette.
- **Custom SVG charts** must cope with the real data volume (30 days of hourly data, about 720 points) and stay accessible. The prototype's charts thin their ticks and keep a keyboard readout, but they have only been tried on fixture-sized data.
- **One component set replacing about 45 components** is a large diff for a household app that deploys straight to the NUC. A page-by-page rollout with the old pages still routable reduces the blast radius.
- **Behaviour changes hidden in a redesign:**
  - Members starting Roomba cleans.
  - Profile's accent colour shrinking to the avatar colour.
  - Alerts moving out of the menu into the strip.

  These need an explicit yes from the owner, not just a visual approval.
