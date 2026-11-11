# Faceplate in the real app: implementation notes

Faceplate is being built into `frontend/` in stages. This file is the working guide for every stage: what exists, the
rules for using it, and what is still open. **Add to it as you go** (a section per phase, and update the shared sections
when you change something they describe).

| phase | what | status |
|---|---|---|
| 1a | tokens, theme system, kit stylesheet, icons | done (this file's first version) |
| 1b | shared components (`src/components/ui/**`), `utils/format.ts`, `utils/status.ts` | done (see "The React kit (1b)" and "Phase 1b log" at the end) |
| 1c | the shell (strip, key column, key row, More sheet), route registry, header, shell overlays | done (see "Shell and routes" and "Phase 1c log" at the end) |
| 1d | integration: review fixes, self-hosted fonts, dead CSS removed, every screen shot in both themes | done (see "Phase 1d log" at the end) |
| 2 | page-by-page conversion, then a final integration pass | done (see "Phase 2 and final pass" at the end); section 0 stays the rulebook for any new page |
| — | Maintenance tab | **deferred** by the owner (see `MAINTENANCE-TODO.md`): it keeps its layout and only inherits tokens and the frame |

Design sources: `BRIEF.md`, `BRIEF-common.md`, `KIT.md` (component guide, written for the prototype's markup), `prototype/`.

---

## 0. Converting a page (phase 2): start here

Everything a page author needs, as a checklist with pointers to the detail further down. Do the steps in order; the
page is done when the last one passes.

**Before you start**

1. Read the page's bugs in `bugs.json` (`locations` names the file) and the page's screen in the prototype
   (`prototype/faceplate-prototype.html#<route>`; screenshots are listed in the 1d log). Data hooks, API modules,
   routes, guards and permissions stay exactly as they are: only the drawing changes, plus the listed bug fixes
   (Roomba's controls stay admin-only, though the prototype shows them to members).
2. **Not Maintenance.** `MaintenanceDashboard.tsx` and `api/maintenance.ts` are deferred by the owner; write notes in
   `MAINTENANCE-TODO.md` instead.

**The page's shape** (detail: "The React kit (1b)", "Page skeleton"; tokens: section 2.3; class rule: section 3.1)

3. Root `<Screen>`. First block `<InstrumentPanel instrument=… verdict={<Verdict tone=…>…</Verdict>} readouts=…>`:
   one instrument, **one verdict sentence that says what is going on and what to do** (it is the page's summary; its
   tone comes from `utils/status`, never a colour), and the readout wells. Then the view switch (`<Seg>` +
   `<SegPanel>`, with `useSearchParamState` for any view people come back to, B-075), then `<Panel>`s.
4. **No title, no hero.** The shell draws the only `h1` from `routes.ts`. A page adds its freshness line with
   ``usePageMeta({ subtitle: `Updated ${formatTime(q.dataUpdatedAt)}` })`` (`components/shell/PageMeta.tsx`) and
   never names itself. Drop `useDocumentTitle` calls (the shell sets the tab title).
5. Every React Query result goes through `<QueryState query={q} what="the bills" empty={<EmptyState …/>}>{(data) =>
   …}</QueryState>` (B-005, B-187). It draws the skeleton, the "couldn't load … / Try again" error and the empty
   state, so a failed load never reads as "nothing here" or `$0.00`. Don't wrap a disabled query (`enabled: false`):
   it would stay on the skeleton.
6. Every dialog is `<Dialog>` / `<ConfirmDialog>`; every `window.confirm` / `alert` is `useConfirm()`. Never leave a
   hidden dialog mounted (PullToRefresh pauses while one is in the DOM). A link inside a dialog that navigates closes
   it in the same click and uses `replace` (see "Layout and platform behaviour").
7. Every date, time, range, money, number and duration goes through `utils/format.ts` (home time zone; pass server
   strings raw, not through `new Date` or `parseServerTs`). Every status word and tone goes through `utils/status.ts`
   (`severityStatus`, `roombaPhaseStatus`, `roleLabel`, …). Role names: `ROLE_LABEL` / `roleLabel` (B-053).
8. Charts (Recharts): call `useChartTheme()` before any early return and spread `t.axis`, `t.grid`, `t.tooltip`; use
   `formatDateTime` in `labelFormatter` (B-039). Series colours from `CHART_COLOURS` / `toneColor()`, never a literal.

**Delete as you convert** (legacy the kit replaces; none of it should survive in a converted page)

- **Hero cards**: the big rounded intro card with an eyebrow, a marketing headline ("Digital service history for
  your home.", "Connect with a single scan.", "Daily electricity usage with quick cost context.") and a paragraph,
  plus the stat tiles inside it. The verdict panel replaces all of it.
- **Eyebrows** in letter-spaced caps above panel titles (`tracking-[0.3em] uppercase …` "ELECTRIC MODULE",
  "TREND & OUTLOOK"); use `Panel eyebrow=` only where the prototype has one.
- **Emoji used as icons** (in tabs, chips, headings, buttons, notification categories, stat tiles): `<Icon name=…>`
  (`Icon.tsx` lists the 106 names; section 4 says how to add one).
- **Raw palette classes and card recipes**: `bg-emerald-*`, `text-sky-400`, `border-amber-300/40`, `from-… to-…`
  gradients, `bg-white/5`, `bg-black/50` scrims, `shadow-[…]`, `backdrop-blur`, `rounded-[28px]` / `rounded-2xl` card
  recipes, `bg-appsurface-raised` panels, `bg-appaccent` as a status colour. Tone comes from `utils/status`; surfaces
  from the kit.
- **Per-page Card helpers**: the page's own `StatCard` / `KpiCard` / tile / pill / badge / modal components and
  `RoleBadge`: replace with `Panel`, `Readout`, `Badge`, `Lamp`, `Dialog`. Delete the helper file when its last user
  is gone.
- **Hand-rolled segmented controls and tab strips**: `<Seg>`.
- **Local formatting helpers** (`minutesLabel` in `utils/tabs.ts`, `duration` in `utils/host.ts`, ad-hoc
  `toLocaleString`): `utils/format.ts`.
- When the last old page is gone: the light-only pastel remap block in `index.css` (`:root:not([data-theme="dark"])`,
  7.2), `.guest-bg` if unused, `modal-overlay` / `modal-panel` if unused. (Final pass: `.guest-bg`, `modal-overlay`
  and `modal-panel` are gone; the pastel remap stays until Maintenance is converted.)

**Check it**

9. From `frontend/`: `npx tsc --noEmit -p tsconfig.json`, `npx vitest run`, `npm run build`, then the `@keyframes` /
   `fp-` check in 7.4. Update tests whose expectations changed with the design; keep their intent and coverage, never
   delete one to make it pass.
10. Shoot the page with the harness ("Screenshot harness" in the 1d log) at phone 390×844 and desktop 1440×900, light
    and dark, and look at every image beside the prototype's: no white-on-white, no vanished borders, no ink-on-ink
    keys, charts readable, nothing wider than the phone, touch targets 44px, inputs 16px on phones.

---

## 1. Where things are

| file | holds |
|---|---|
| `frontend/src/index.css` | every `--app*` token (light on `:root`, dark, the four finishes, the scale), the Tailwind `@theme` mapping, global base rules, the old app's utilities and keyframes |
| `frontend/src/styles/faceplate.css` | the kit: every `fp-*` component class, ported from `prototype/kit.css`. Imported by index.css into Tailwind's **components** layer |
| `frontend/src/components/ui/Icon.tsx` | `<Icon name="…" />`, `<IconSprite />`, the `IconName` union (106 icons from `prototype/shell.html`) |
| `frontend/src/components/ui/*` (index.ts) | the React kit (1b): every shared component over the `fp-` classes. Import from `components/ui`. Cheat-sheet at the end of this file |
| `frontend/src/utils/format.ts` | every date, time, range, money, number, duration and plural people read, in the **home's** time zone |
| `frontend/src/utils/status.ts` | the one map from server enums to a tone (ok / headsup / problem / info / neutral) and a plain label; role labels |
| `frontend/src/context/ThemeContext.tsx` | theme mode, finish (palette), Auto/sunset, the JS chart colour constants |
| `frontend/src/components/ThemePicker.tsx` | the appearance switchgear (Profile), already on the kit: a worked example of kit markup in JSX |
| `frontend/index.html` | the start-up theme script, `theme-color` |
| `frontend/src/assets/fonts/*.woff2` | Archivo (variable weight + width) and DM Mono 400/500, Latin and Latin Extended, self-hosted since 1d. `@font-face` rules at the top of `index.css`; Vite fingerprints them into `/assets/` (cached a year by nginx) |

Tests that guard this layer: `indexCss.test.ts` (the stylesheet compiles completely, every kit class is `fp-`, no literal
colours in the kit, no stray comment terminator), `paletteContrast.test.ts` (contrast of every token in both themes and
every finish; finishes tint surfaces only), `smartTheme.test.tsx`, `ThemePalette.test.tsx`, `themeBoot.test.tsx` (runs
the real start-up script and compares it with ThemeProvider), `themePicker.test.tsx`.

---

## 2. Tokens

Every old token name still exists and still maps into Tailwind (`bg-appsurface`, `text-apptext-muted`,
`border-appborder`…), so the ~45 components that are not converted yet keep rendering, now in Faceplate colours.
New code uses the same names. Light is defined on `:root` (so the page is light with no `data-theme` at all); dark is
`[data-theme="dark"]` layered over it.

### 2.1 What each old token means now

| token | was | now (light / dark) |
|---|---|---|
| `--appbg` | page background | **enamel** `#e9ecea` / `#121416` |
| `--appsurface` | card | **panel** `#f7f8f7` / `#1b1e21`, flat, 1px hairline, no shadow |
| `--appsurface-raised` | translucent card (88–94%) | = `--appsurface`, **solid** (a dialog drawn with it no longer shows the page through; B-008) |
| `--appinset` | inset tile (dark mode *lightened* it) | **well** `#dfe3e0` / `#0d0f10`: recessed, darker than the panel in both themes |
| `--appinset-strong` | nested/hovered inset | **well, hovered or nested** `#d3d8d5` / `#070809` |
| `--apptext` | primary text | **ink** `#15181a` / `#eef1ef` |
| `--apptext-soft` | secondary text | ink-to-graphite step `#33393d` / `#cdd2d5` |
| `--apptext-muted` | muted text | **graphite** `#4e555a` / `#a7aeb3` |
| `--apptext-dim` | dimmest text | `#52595e` / `#969da2` (>= 4.5:1 on every well) |
| `--apptext-success / -warning / -danger / -info` | status text | lamp text: `#0e6637 #794f00 #aa241d #1c56ad` / the lamps `#3ddc84 #ffb627 #ff6b5e #6fa8ff` |
| `--appborder` / `-light` / `-hover` | borders | **hairline** ink at 14% / 8% / = `--appborder-strong` (26%) |
| `--appaccent` | brand colour (emerald, or the palette's hue) | **ink**: a solid accent fill is now the ink key |
| `--appaccent-fg` | text on an accent fill | the panel colour (light) / `#15181a` (dark): the ink key's lettering |
| `--appaccent-text` | accent-coloured text | ink |
| `--appaccent-soft` / `-border` | tinted selection | neutral ink wash 8% / ink hairline 34%: the old "soft selected" state reads as a pressed neutral key |
| `--appsuccess / --appwarning` | status fills | the **lamps** ok `#22a35a`/`#3ddc84`, heads-up `#e0a100`/`#ffb627` |
| `--appdanger` / `-fg` | danger fill + its text | the **destructive key** `#b3261e`/`#ff6b5e` with white / `#15181a` (a deeper red than the problem lamp so the label clears 4.5:1) |
| `--appglow*` | decorative radial glows | `transparent` (retired) |
| `--appshadow`, `--appshadow-lg` | shadow colours | fully transparent: every `shadow-[..var(--appshadow)]` renders nothing |
| `--appchart-bg` | separate chart backdrop | = panel (charts sit on panels) |
| `--appchart-grid / -tick / -border` | chart chrome | ink at 9% / graphite / hairline |
| `--appchart-heat / -cool / -charge` | data hues | `#d9480f #1c7ed6 #1e9150` / `#ff8a4c #6fb6ff #3ddc84` |

Tailwind's stock shadow scale (`shadow-sm` … `shadow-2xl`) is flattened to nothing as well. Faceplate has **no drop
shadows**; recesses use `--appwell-shadow` (an inner shadow), keys a 1px inset lip.

### 2.2 New tokens

All `--app*`, all mapped into `@theme` where a utility makes sense.

- **Surfaces**: `--appkey`, `--appkey-hover` (raised key face), `--appkey-lip`, `--appkey-lip-ink`, `--appwell-shadow`,
  `--approw-hover`, `--appskel-shine`, `--appborder-strong`, `--appfocus`, `--appink-faint` (ticks and disabled marks, never text).
- **Lamps**: `--applamp-ok / -warn / -problem / -info / -off / -edge`, tints `--apptint-*`, edges `--appedge-*` (ok, warn, problem, info).
- **Charts**: `--appchart-ink / -graphite / -soft / -water / -gas / -band / -cursor / -empty`.
- **Dial**: `--appdial-track / -day / -night / -tick`. **Overlays**: `--appscrim`, `--apptoast-bg / -fg`.
- **Always dark / always white**: `--appmedia-bg / -ink / -ink-soft / -scrim / -rec` (camera footage), `--appplate / -ink / -soft / -edge` (QR, visitor badge, bill paper).
- **Map**: `--appmap-floor / -wall / -room / -dot`. **People**: `--appavatar-ink` (initials are always ink on the person's colour), `--appavatar-ring`, `--appavatar-default`. `--appmask` (alpha masks).
- **Type**: `--appfont` (Archivo), `--appfont-mono` (DM Mono); sizes `--appfs-label` 11.5 · `-key` 11 · `-small` 13 · `-body` 15 · `-lead` 18 (21 from lg) · `-section` 16 · `-title` 22 · `-title-lg` 28 · `-num-xl` 44 · `-num-l` 28 · `-num-m` 18 · `-mono-s` 11.5 · `-mono` 13; `--applh-tight / -body`; `--appstretch-label` 112% · `-num` 88% · `-key` 94%.
- **Radius**: `--appradius-panel` 12 · `-key` 10 · `-well` 8 · `-chip` 8 · `-tag` 6.
- **Sizes**: `--apptap` 44 · `--apptap-sm` 36 · `--appstrip-h` 48 · `--appstrip-h-phone` 52 · `--appkeycol-w` 96 · `--appkeyrow-h` 64 · `--appcontent-max` 1240 · `--appgutter` / `--apppanel-pad` / `--appgap` (16/16/12, 24/20/16 from 40rem, 40/24/20 from 64rem) · `--appicon` 20 · `--applamp-size` 9 · `--appdial-max` 240 (300 from 64rem).
- **Motion**: `--appease`, `--appdur-fast` 120ms, `--appdur-sweep` 500ms.
- **Finish swatches**: `--appfinish-default / -ocean / -sunset / -violet`.

New Tailwind utilities: `bg-appkey`, `bg-applamp-ok`, `bg-apptint-warn`, `border-appedge-problem`, `text-appchart-heat`,
`border-appborder-strong`, `rounded-panel / -key / -well / -chip / -tag`, `text-label / -small / -body / -lead /
-section / -title / -num-xl / -num-l / -num-m`, and `font-sans` / `font-mono` are now Archivo / DM Mono.

### 2.3 Prototype token → app token

Use this when porting a screen's `prototype/screens/<route>.css` (the kit itself is already ported):

| prototype | app | prototype | app |
|---|---|---|---|
| `--enamel` | `--appbg` | `--ink` | `--apptext` |
| `--panel` | `--appsurface` | `--graphite` | `--apptext-muted` |
| `--well` / `--well-deep` | `--appinset` / `--appinset-strong` | `--graphite-soft` | `--appink-faint` |
| `--key-face` / `-hover` | `--appkey` / `--appkey-hover` | `--on-ink` | `--appaccent-fg` |
| `--key-lip` / `--primary-lip` | `--appkey-lip` / `--appkey-lip-ink` | `--hairline` / `-strong` | `--appborder` / `--appborder-strong` |
| `--well-shadow`, `--row-hover`, `--skel-shine`, `--focus` | `--appwell-shadow`, `--approw-hover`, `--appskel-shine`, `--appfocus` | `--text-ok/warn/problem/info` | `--apptext-success/warning/danger/info` |
| `--lamp-*`, `--tint-*`, `--edge-*` | `--applamp-*`, `--apptint-*`, `--appedge-*` | `--danger-fill` / `--on-danger` | `--appdanger` / `--appdanger-fg` |
| `--chart-*`, `--dial-*`, `--map-*`, `--media-*`, `--plate*` | `--appchart-*`, `--appdial-*`, `--appmap-*`, `--appmedia-*`, `--appplate*` | `--scrim`, `--toast-bg/fg` | `--appscrim`, `--apptoast-bg/fg` |
| `--font` / `--mono` | `--appfont` / `--appfont-mono` | `--t-label` … `--t-mono` | `--appfs-label` … `--appfs-mono` |
| `--r-panel` … `--r-tag` | `--appradius-panel` … `--appradius-tag` | `--tap`, `--gutter`, `--panel-pad`, `--gap`, `--icon` | `--apptap`, `--appgutter`, `--apppanel-pad`, `--appgap`, `--appicon` |
| `--ease`, `--t-fast`, `--t-sweep` | `--appease`, `--appdur-fast`, `--appdur-sweep` | `--person-*` | real people carry their own `accentColor`; set it as `--fp-who` |

Not ported (prototype-only): `--scene-*` (drawn camera scenes; the app shows real footage) and `--s-1…9` (use Tailwind spacing).

---

## 3. The kit: `fp-` classes

### 3.1 The rule

**Every kit class starts with `fp-`, state classes included.** The prototype's bare names (`.grid`, `.row`, `.list`,
`.btn`, `.label`, `.small`, `.link`…) collide with Tailwind utilities. The prefix was added mechanically to every
class in `kit.css`, so the translation from prototype markup is mechanical too:

| prototype | JSX |
|---|---|
| `class="btn btn--primary btn--lg"` | `className="fp-btn fp-btn--primary fp-btn--lg"` |
| `class="seg-key is-active"` | `className="fp-seg-key fp-is-active"`, **or better** the ARIA state (below) |
| `<span class="label">Yesterday</span>` | `<span className="fp-label">Yesterday</span>` |
| `<svg class="icon" aria-hidden="true"><use href="#i-bolt"/></svg>` | `<Icon name="bolt" />` |
| `style="--p: 62%"`, `--sw`, `--who`, `--c`, `--v`, `--x`/`--y`, `--size`, `--lamp`, `--dial-max` | `style={{ '--fp-p': '62%' } as CSSProperties}`; every per-element knob is `--fp-*` |
| `data-tabs` / `data-tab-panel` | React state; tabs get `role="tab"` + `aria-selected`, panels `role="tabpanel"` |
| `data-open-modal` / `data-modal` / `data-close-modal` | React state + the existing dialog hooks (3.4) |
| `data-nav="route"` | `<NavLink>`; the active key gets `aria-current="page"` (NavLink does this) |
| `data-role-only="admin"` | conditional rendering from `useAuth()` (`isAdmin`, `user.role !== 'GUEST'`) |
| `data-toggle` | a controlled `aria-pressed` / `aria-checked` |
| `data-toast` | `fp-toast` exists as a style; there is still no toast runtime (1b left it out: no page needs one yet). Render `<div className="fp-toast" role="status">` from page state if one does |
| `data-chart="…"` | the React chart components (phase 2 ports `prototype/charts.js`; it emits the `fp-chart*`, `fp-ch-*`, `fp-bar*`, `fp-heat*`, `fp-dv-*`, `fp-dl-*` markup) |
| `hidden` | conditional rendering |

`indexCss.test.ts` fails if a class without the prefix is added to `faceplate.css`.

### 3.2 Selection without classes

So React code doesn't have to mirror state into class names, the kit also selects on the ARIA state the element
should carry anyway:

- `fp-seg-key`: `aria-selected="true"` (tabs), `aria-checked="true"` (radios), `aria-pressed="true"` (toggles).
- `fp-chip`: `aria-pressed`, `aria-selected`, `aria-checked`. `fp-swatch-key`: `aria-checked`, `aria-pressed`, `aria-selected`.
- `fp-navkey`, `fp-rowkey`, `fp-padkey`, `fp-strip-plate`, `fp-strip-avatar`: `aria-current="page"` (and its `.fp-count` inverts).
- `fp-rowkey--more`: lit while `aria-expanded="true"` (the More sheet is open).
- `fp-switch`: `role="switch"` + `aria-checked`. `fp-icon-btn`: `aria-pressed="true"`.
- Inputs: `aria-invalid="true"` draws the problem border (as `.fp-field.fp-is-invalid` does).

### 3.3 Layering and overrides

`index.css` imports the kit with `@import "./styles/faceplate.css" layer(components)`. Utilities beat components, so
`className="fp-panel p-0"` works and Tailwind can tune any kit element. Unlayered rules in `index.css` beat both.

### 3.4 Differences from the prototype kit

- **Base resets are Tailwind's preflight**, not the kit's section 0. Kept from it, in `index.css` `@layer base`: the
  visible focus outline (`:focus-visible`, 2px `--appfocus`) and ink-inversion `::selection`.
- **Icons size by font-size** (`.fp-icon` is `1em`), so an `<Icon>` next to text matches it. Kit components set exact
  sizes (button icon 18, nav key 19, key row 22, row lead 20…). `fp-icon--s` 16 / `--m` 20 / `--l` 28.
- **`fp-screen`** (a converted page's root) also sets the 15px body text; so does `fp-dialog`. Old pages stay 16px.
- **Buttons point**: Tailwind's preflight gives `<button>` the default cursor; the kit's keys set `cursor: pointer`.
- **Camera tiles** show real footage: put the `<img>`/`<video>` in `.fp-media-frame` with class `fp-media-feed`
  (fills the frame, greys out under `.fp-is-offline`). The prototype's drawn `.scene-*` art is gone.
- **`fp-toast`** is a complete style (fixed above the key row); give the element `role="status"`.
- **The More sheet** hides from lg up via `.fp-dialog--more` (was `[data-modal="more"]`).
- **Reduced motion** is handled per kit animation, not with the prototype's global "every animation 1ms" clamp
  (which would also have frozen the old pages' spinners).
- **Keyframes and the container name** are prefixed too (`fp-dialog-in`, `fp-dial-sweep`…, container `fp-board`).
- **Breakpoints** are rem range queries like Tailwind's: `width >= 40rem` (640), `>= 45rem` (720, the `.fp-ip` split),
  `>= 64rem` (1024 = lg), `width < 40rem`.

### 3.5 Dialogs on the kit

**Use `<Dialog>` / `<ConfirmDialog>` from `components/ui`** (1b); they do everything below. The raw markup, for reference:
`fp-dialog` (scrim, z 70) > `fp-dialog-panel` > `fp-dialog-head` / `fp-dialog-body` (scrolls) / `fp-dialog-foot`; a sheet
on phones, centred from 40rem; sizes `--narrow` 440, default 600, `--wide` 880, `--full`. The kit only draws it. Every
dialog still needs the app's behaviour: `role="dialog"` + `aria-modal="true"` + `aria-labelledby` on the panel,
`useFocusTrap` (Escape, focus return), `useScrollLock`, `useBackToClose`, and the safe-area padding the kit already
applies (`env(safe-area-inset-*)`). Never `backdrop-blur` (scrolling jank; WeatherForecastModal explains).

---

## 4. Icons

```tsx
import { Icon, IconSprite, type IconName } from '../components/ui/Icon';

<IconSprite />                                   // once, high in the tree (see 7.1)
<Icon name="thermometer" />                      // decorative: aria-hidden, sized by font-size
<Icon name="alert-triangle" title="Heads-up" />  // meaningful on its own: role="img" + accessible name
<button className="fp-icon-btn" aria-label="Edit"><Icon name="edit" /></button>  // icon-only control: label the button
```

The sprite symbols are `#fp-i-<name>`. Names and the nav icon for each page are listed in `Icon.tsx` and `KIT.md` §9.
**No emoji as icons** in converted code. To add an icon, draw it on the 24px grid with 1.5px round strokes and add it to
`SYMBOLS` (the `IconName` union follows).

---

## 5. Palettes are finishes

`data-palette` still exists with the same ids (people's phones have them saved; `index.css`, the start-up script and
ThemeContext key on them). A palette is now an **enamel finish**: it may change only the page, panel, well, key faces,
the unlit lamp, the map floor and the hairlines. Never ink, lamps, status text or chart colours, so status reads
the same in every finish. `paletteContrast.test.ts` enforces that list.

| id | label people see | swatch |
|---|---|---|
| `default` | Enamel | `--appfinish-default` |
| `ocean` | Sea glass | `--appfinish-ocean` |
| `sunset` | Sandstone | `--appfinish-sunset` |
| `violet` | Lilac | `--appfinish-violet` |

The JS chart constants follow: `CHART_SERIES` (usage = ink, temperature = heat), `DATA_SERIES` (actual = ink,
predicted = graphite via the new `predicted` key and `predictedColor()`, heads-up amber, gas/water hues), and the
Maintenance-only `KPI_TONES` are the **same for every palette**. Their per-palette shapes stay so callers compile.
They are hex (Recharts writes SVG attributes, where `var()` is unreliable) and mirror the `--appchart-*` tokens.

---

## 6. Theme behaviour

- **Modes**: `light`, `dark`, `auto` (sunrise/sunset at home; needs the home's coordinates from `/api/config`, falls
  back to the device until it has them), `system` ("Device": follows the phone's setting, live).
- **No saved choice = light**, the designed default (it used to follow the device). Anyone with a saved choice keeps it.
  A choice is saved only when someone makes one (`setMode`), `system` included, under `localStorage.theme`.
- **Back to the device (B-057)**: the Profile switch has a fourth key, Device. The old toggle in the shell (`toggleTheme`)
  is still an explicit light/dark choice.
- **No flash on start (B-056)**: an inline script at the top of `index.html` sets `data-theme` and `data-palette`
  before the first paint, from the same keys ThemeContext reads. Auto has no sun maths there, so ThemeProvider saves
  `localStorage['theme-resolved']` (the theme it last showed) and the script paints that. ThemeProvider sets the
  attributes in layout effects, so its first frame is also right. `themeBoot.test.tsx` runs the real script against
  ThemeProvider for each case; keep them in step if you add a mode or finish.
- **Browser chrome (B-012)**: ThemeProvider writes the resolved `--appbg` into `<meta name="theme-color">` (Safari tab
  bar, Android status bar, desktop PWA title bar); the start-up script sets the dark value early.
- **iPhone status bar (B-012)**: `apple-mobile-web-app-status-bar-style` stays `black-translucent` (the app draws
  under the bar and handles the inset itself). iOS then always draws a white clock and battery and reads the meta only at
  launch, so in the light theme, as a Home Screen app (`display-mode: standalone`), `index.css` lays an ink band
  exactly the height of `env(safe-area-inset-top)` over the top of the screen. It is 0px in a browser tab and on desktop.
  **Not yet seen on a real iPhone.** The alternative is the `default` status-bar style plus removing the manual top
  inset everywhere, which needs device testing.
- `.theme-switching` still suppresses transitions for the frame a theme or finish flips.

---

## 7. Notes for the next phases

### 7.1 Shell (1c)

**Done.** These were the brief for 1c; how it came out is in "Shell and routes" at the end of this file.

- **Mount `<IconSprite />` once.** The public pages (Login, Register, Guest) are not inside `App`, so mount it above
  the router (`main.tsx`) or in both places with care. Never twice: the symbol ids would repeat. Until it is mounted,
  every `<Icon>` renders empty (ThemePicker's key icons included; its words still carry it).
- **Remove `App.tsx`'s backdrop layers** (the fixed `-z-10` div with the slate / navy gradients and the glow
  gradients, and the `h-[32rem]` wash). They hard-code the old colours and cover `bg-appbg`, so the enamel and the
  finishes don't show behind the cards (B-050), and the dark page is navy behind neutral panels.
- Shell styles are in the kit: `fp-strip` (+ `fp-wordmark`, `fp-strip-clock`, `fp-strip-titles`, `fp-strip-plate--house /
  --alerts`, `fp-strip-avatar`, `fp-strip-theme`), `fp-frame`, `fp-keycol` + `fp-keycol-group` + `fp-navkey`, `fp-content`
  + `fp-pagehead`, `fp-keyrow` + `fp-rowkey` (+ `--more`), the More sheet `fp-dialog--more` + `fp-keypad-group` /
  `fp-keypad` / `fp-padkey` + `fp-more-foot` / `fp-more-theme`, and `fp-count`.
- They were written for a window that scrolls. Keep the v1.9.2 behaviour instead: below lg the page scrolls inside
  `[data-page-scroller]` (read the comments in `App.tsx`), the fixed key row has **no backdrop blur**, and the strip /
  scroller keep the safe-area insets. `fp-content`'s bottom padding already clears the key row and the home indicator.
- The light-theme status band (6) covers the top inset; the strip needs nothing for it.

### 7.2 Pages (2)

- Root `<Screen>` (`fp-screen`); first the `<InstrumentPanel>` (instrument + verdict + readouts), then the view
  switch (`<Seg>`), then `<Panel>`s. **Build with the React kit** (cheat-sheet at the end); drop to raw `fp-` markup
  (`KIT.md`, translated with 3.1) only for what the kit doesn't wrap (the board's `fp-lamps`-style one-offs, a page's
  own instrument parts).
- An old page converted wholesale should stop using `rounded-[28px]`, `shadow-[…]`, `bg-appsurface-raised`, emoji and
  the pastel `*-300` classes. The light theme still remaps `{emerald,green,teal,amber,yellow,orange,rose,red,pink,
  fuchsia,sky,cyan,blue,indigo,violet,purple}-{200,300,400}` to text-safe shades for the old pages (`:root:not([data-theme="dark"])`
  in index.css). Delete that block when the last old page is gone.
- Chart components: hooks before any early return (they measure nothing, but the rule stands). Colours from the
  tokens; hex only where Recharts needs an attribute.

### 7.3 Type

- Archivo (variable width) + DM Mono, **self-hosted** since 1d (`src/assets/fonts`, `@font-face` at the top of
  `index.css`, `font-display: swap`). They used to come from Google Fonts through a CSS `@import`, which made the
  first paint wait on a third-party host: with the internet down and the LAN up, the app sat blank. Nothing loads
  from Google now; don't add it back. The generic Tailwind steps now land on Faceplate's: `text-3xs` 11.5 (label), `text-2xs` 12, `text-xs` 13
  (small), `text-sm` 15 (body), `text-lg` 18, `text-xl` 20, `text-2xl` 22 (title), `text-3xl` 28. The old desktop
  bump (each small step +1px from lg) is gone: Faceplate keeps one size per role on every width.
- **Inputs stay 16px below lg** (iOS zooms into smaller ones; B-009): an unlayered rule in `index.css` lifts every text
  input, select and textarea, whatever its class. The kit's inputs are 16px anyway.

### 7.4 Gotchas (all still true)

- Never write a comment terminator inside a CSS comment. It once ended a comment early and Tailwind dropped the rest
  of index.css from production while the build stayed green. `indexCss.test.ts` guards both files.
- In arbitrary Tailwind breakpoints use rem (`max-[40rem]`), never px: px breakpoints sort after rem ones and lose.
- After CSS changes run `npm run build` and check `dist/assets/index-*.css` still has every `@keyframes` (the kit's
  are `fp-*`) and the `fp-` rules.
- Old pages may still put `shadow-[…var(--appshadow)]`, `backdrop-blur` or translucent `bg-black/50` scrims around;
  those are theirs to remove when converted.

---

## 8. Phase 1a log

**Bugs fixed** (ids in `bugs.json`):

- B-057: no way back to "follow my device" (Device mode).
- B-056: a saved theme flashed the other one on a cold start (start-up script + layout effects).
- B-012: browser `theme-color` was fixed navy and the iPhone status bar was invisible in light (meta follows the
  theme; ink status band). The status band still wants a check on an iPhone.
- B-008: dialogs were see-through (`--appsurface-raised` is solid).
- B-009: inputs under 16px made iOS zoom (global rule). Plausible-only in the audit; confirm on an iPhone.

**Changed for every page by the tokens alone**: Faceplate colours and fonts, flat cards (no shadows, no glows), ink
selection instead of the emerald/palette accent, darker recessed wells in dark mode.

**Open, outside 1a's files**:

- B-050 (backdrop in `App.tsx` hides the enamel and the finishes): phase 1c, see 7.1.
- B-067 (Home's info dot is `bg-appaccent`, now ink, same as the unread dot): HomeSummary, phase 2.
- B-096 (dim "Refuse" legend in dark): the new dark water colours all clear 4.5:1, so it reads now; the fix the bug
  asks for (neutral legend text in both themes) is still WaterUsage's, phase 2.
- `public/manifest.webmanifest` still has `background_color` / `theme_color` `#020617` (navy): the Home Screen
  splash is navy before a light app. Change both to `#e9ecea` with the shell.
- Fonts come from Google Fonts. The app runs on the home server, so self-hosting Archivo and DM Mono
  (woff2 in `public/fonts`, `@font-face` in index.css) would remove that dependency. Not done (no downloads in 1a). **Done in 1d** (in `src/assets/fonts`, so they are fingerprinted and cached).

**Maintenance (deferred; for the owner's pass)**: the tab only inherited 1a's global changes. Specifically:
`KPI_TONES` no longer change with the palette (its summary tiles keep the default tones in every finish); the global
16px rule now covers its filter selects and search (on a phone the search box wraps to its own row, still fine); its
primary button is now the ink key. Its bugs, including the squashed table header (B-148, seen in 1a's screenshots), are
in `MAINTENANCE-TODO.md`, untouched.

---

## Shell and routes (1c)

### Files

| file | holds |
|---|---|
| `frontend/src/routes.ts` | **the route registry**: every page's `id` (its App usage key), `path`, `label` (menus), `short` (under a key), `title` (header, phone strip, browser tab), `group` (Everyday / House / You / Admin), `icon`, `access` (`all` / `member` = not guests / `admin`), `keyRow` (one of the phone row's five). Also `routeForPath`, `canSee`, `visibleRoutes`, `GROUP_LABEL`, `ROLE_LABEL` (Admin / Member / Guest) |
| `frontend/src/App.tsx` | the shell: health + unread queries, sleep, presence, the scroll box, and the pieces below |
| `frontend/src/components/shell/TopStrip.tsx` | `fp-strip`: wordmark, clock (DM Mono), House lamp, Alerts plate, theme key, avatar (desktop); title + freshness line, bell + count, avatar (below lg) |
| `frontend/src/components/shell/KeyColumn.tsx` | `fp-keycol` (lg and up): grouped `fp-navkey`s, Sign out at the foot, a fade + chevron while keys are hidden below |
| `frontend/src/components/shell/KeyRow.tsx` | `fp-keyrow` (below lg): the five Everyday keys (Cameras not for guests) + More |
| `frontend/src/components/shell/MoreSheet.tsx` | the More sheet (`fp-dialog--more`): House / You / Admin keypads, Light · Dark, Sign out |
| `frontend/src/components/shell/houseStatus.ts` | the House lamp's state from the `/api/health` query: `checking` / `ok` / `problem` (database down) / `offline` |
| `frontend/src/components/shell/PageMeta.tsx` | `usePageMeta({ subtitle, title })`, how a page adds to its header |
| `frontend/src/components/shell/ShellAvatar.tsx` | the strip's avatar (`fp-avatar`, opaque, readable initials) |
| `frontend/src/components/shell/NotFound.tsx` | the 404 page (outside the shell) |
| `frontend/src/components/PageHeader.tsx` | `fp-pagehead`: group label, the page's one `h1`, freshness line |

`utils/tabs.ts` names App usage rows from the registry, so a new page is named there as soon as it has a route.
`main.tsx` still owns the router (lazy chunks, guards, redirects); `shell.test.tsx` fails if a registry path is
missing from it, or if a route's `id` isn't `tabKey(path)`.

### How a page gets its title, freshness line and verdict

- **Title**: from the registry, nothing to do. The shell renders it once, as the page's only `h1` (in `fp-pagehead`,
  visible from lg; below lg the kit hides it visually and the strip shows the same words). The browser tab reads
  "Title · HomeOS" (Home is just "HomeOS"). **A page never renders its own title or hero card**; unconverted pages
  still do, and phase 2 removes them.
- **Freshness line** ("Updated 5:00 PM", "Checked 5:00 PM"): call `usePageMeta({ subtitle })` in the page. It shows
  beside the title on desktop and under it in the phone strip, and is cleared when the page unmounts. Keep it short
  and factual; build it with the 1b formatters (`Updated ${formatTime(query.dataUpdatedAt)}`, `utils/format.ts`).
- **A title that depends on the viewer** (rare): `usePageMeta({ title })` overrides the registry title in the header
  and the tab. Don't use it to rename a page; rename it in the registry.
- **Verdict**: not the shell's. It is the first thing in the page, in its `fp-ip` instrument panel (7.2). The shell's
  only verdict is the strip's House lamp (is the home server answering) and the Alerts count.

### How to add a page

1. Add the route to `main.tsx` (inside `<App />`, under the right guard: `MemberRoute` for not-guests, `AdminRoute`).
2. Add one entry to `ROUTES` in `routes.ts` with the same path and matching `access`. Order within a group is menu
   order. Pick an icon from `Icon.tsx` (or draw one, section 4); plain words, sentence case; `short` only differs
   from `label` when the label is too wide for an 80px key.
3. That's all: the key column, the More sheet, the header, the tab title and App usage pick it up. Only the five
   Everyday pages are on the phone key row (`keyRow`); don't add a sixth, the row is full at 390px.

### Layout and platform behaviour (kept from v1.9.x)

- **Below lg the page scrolls inside `[data-page-scroller]`**, a 100dvh box; the window never moves (the iOS 26
  floating-bottom-bar fix). The strip is `position: sticky` *inside* that box (from lg, inside the window), so the
  kit's window-scrolling styles work unchanged. The key row is `position: fixed` outside it, `touch-none`, opaque,
  **no backdrop blur**. `fp-content`'s bottom padding clears the key row and the home indicator.
- **Safe areas**: the strip pads itself by `env(safe-area-inset-top)`; the light-theme status band (6) sits on top of
  that padding. The key row and dialogs pad the bottom inset.
- **Scroll to top on a new page**: unchanged, keyed on the pathname only (a `?view=` change keeps its scroll).
- **PullToRefresh**, the **sleep screen**, **chunk-error recovery** (ErrorBoundary per page, keyed on the path) and
  **useJitteredInterval** polling are unchanged. PullToRefresh now does nothing while any overlay is open
  (`role=dialog`/`alertdialog`, `aria-modal`, `.fp-dialog`, `.modal-overlay`).
- **More sheet**: `useFocusTrap` (focus in, Tab trapped, Escape, focus back to the More key), `useScrollLock`,
  `useBackToClose`, scrim tap closes. A page key closes it in the same click that navigates **with `replace`**, so
  the sheet's own Back entry becomes the new page: history is [page, new page] and one Back returns. (Before 1d it
  pushed, which left the sheet's duplicate entry under the new page, and the second Back did nothing visible.) Any
  link in an overlay that navigates should do the same; ReleaseNotesModal's "See all updates" does. The sheet also
  closes on any route change, when the app falls asleep, and when the window crosses lg (from lg it is hidden by CSS,
  and hidden isn't closed: its scroll lock and focus trap would stay live).
- **Overlay stacking** (z-index): kit dialogs and the More sheet 70, the "Still there?" countdown 75, the skip link
  and toasts 80, the sleep screen 90. Nothing may cover the sleep screen. The More sheet and What's new are not
  rendered while asleep (a deploy reloads the wall tablet and would open What's new over the night-light).
- **House lamp**: Checking (unlit) until the first answer, OK, Problem (server up, database down), Offline (the last
  check failed, whatever was cached). While offline it re-checks every 30 s instead of every 2 min. It links to
  Server health for an admin, Home for everyone else.
- **Desktop key column**: 18 keys don't fit a short laptop window. The column scrolls with its scrollbar hidden (kit),
  so a fade with a chevron shows at its foot while keys are hidden below.
- **Skip link**: the first Tab stop is "Skip to content", which focuses `<main id="main">`.
- `<IconSprite />` is mounted once in `main.tsx`, above the router, so public pages have icons too.

### Loading, errors, guards

- `PageSkeleton` renders **inside** the shell by default: only the page body (an `fp-ip`-shaped or list/cards/form
  shape from `fp-skel` pieces), `role="status"` "Loading". Public routes pass `fullPage` for the enamel page around
  it. Variants: `stats-charts`, `list`, `cards` (Profile), `form`, `hero`, `default`.
- `ErrorBoundary`: an `fp-empty` (error tint) with Reload; a stale chunk says "A new version is ready".
- `Guard.tsx`: `ProtectedRoute`'s wait is a full enamel page (no shell yet); the member/admin guards' waits are one
  status line inside the shell. Redirects are unchanged.
- `NotFound`: outside the shell (signed-out people reach it too), a bare faceplate with "Go to Home".

### For phase 2

- `usePageMeta` is the only header API; remove each page's hero card / own `h1`/`h2` title and marketing line as you
  convert it, and start the page with `<div className="fp-screen">` + its `fp-ip`.
- `PixelScene.tsx` and its `px-*` keyframes were deleted in 1d, with `.theme-toggle*` and `@utility pb-safe`.
- `profile/Avatar.tsx` still draws the translucent gradient (B-158) and one-letter initials; the shell's avatar is
  `ShellAvatar` (same initials rule). Converge them when Profile and People are converted (B-183).
- Pages still call `useDocumentTitle` here and there (Utility, Updates); the shell sets the tab title from the
  registry, so drop those calls when converting.

---

## Phase 1c log

**Bugs fixed** (ids in `bugs.json`):

- B-011: the backend lamp said Offline while checking and Healthy through an outage (`houseStatus`, faster re-check).
- B-013: the header's Backend / Unread / Access chips, the role tile and the second status pill are gone; one compact
  strip, one title.
- B-010: the desktop menu hid the admin pages below an unmarked scroll (key column + "more below" fade).
- B-045: Maintenance and Diagnostics no longer share the wrench (wrench / activity, from the registry).
- B-046: the stale "Phase 1 · CoServ Integration" footer is gone. B-054 with it (the sleep screen is opaque too).
- B-047, B-048: the header pixel scenes are gone (the clipped camera, the admin pages' Home scene).
- B-049: emoji before every tab name are gone; icons are `aria-hidden`; both navigations are labelled "Main".
- B-050: the backdrop gradient and glows in `App.tsx` are gone; the enamel and the finishes show.
- B-051: the loading placeholder is the page body inside the shell, not a full page; Electric, Gas and Water are
  prefetched with Utilities.
- B-052: key row labels share one baseline; "Climate" fits on one line.
- B-053 (shell part): the shell no longer prints raw roles or calls a guest "Member" (`ROLE_LABEL` exists for the pages).
- B-055: the sleep countdown is no longer a live region read every second; it speaks at 30 and 10 seconds.
- B-043 (shell part): What's new is a kit dialog with focus moved in and trapped, Escape, back gesture, focus return;
  PullToRefresh ignores drags while any overlay is open (incl. unmarked `.modal-overlay` forms).
- B-158 (shell part): the strip avatar has readable initials on an opaque colour.
- B-180: App usage names "admin/nuc" Server health (all names come from the registry).
- B-012 (remainder): `manifest.webmanifest` background/theme colours are the light enamel `#e9ecea`, not navy. The
  manifest can't follow the theme, so a dark-theme phone sees a light splash for a moment.
- B-026 (shell part): the header's global "Unread" chip that disagreed with the Notifications page is gone.

**Not fixed here** (outside the shell's files, or not trivial):

- B-014 (a transient `/auth/me` failure signs people out): needs a third session state in `AuthContext` and a "can't
  reach home" card in `ProtectedRoute`; not trivial, left for its own change.
- B-058 (return to the page you were on after signing in): `Login.tsx`.
- B-059 (Register form shown when password sign-in is off): `Register.tsx`.
- B-064 (Home's Maintenance card bounces guests): `HomeSummary.tsx` (the guard's redirect is unchanged).
- B-075 (Utilities forgets Gas/Water across reloads and sleep): `Utility.tsx` should keep `?view=` in the URL.
- B-116 (recording thumbnails start late in the phone scroll box): `CameraRecordings` should observe against
  `[data-page-scroller]`.
- B-006 (lists in fixed-height scroll boxes inside the page): the pages' `VirtualizedList` uses.
- B-183 (initials differ on Users): `UserManagement.tsx`.
- B-188 (`npm run lint` can't run): developer tooling, not the shell.

**Maintenance (deferred)**: untouched. It renders inside the new frame (key column / key row, the shell's "House ·
Maintenance" header above its own hero card) and is guarded and gated exactly as before (members only). Notes for
the owner's pass: its Add / Edit / Detail overlays aren't marked as dialogs and don't use `.modal-overlay`, so
PullToRefresh's new overlay check doesn't see them (the B-043 pull-behind-the-form issue remains there); its hero
card now sits under the shell's title, so the page shows "Maintenance" twice until it is converted.

---

## The React kit (1b)

`frontend/src/components/ui/`: thin, typed, accessible components over the `fp-` classes, **the single
implementation of each thing the pages share** (it replaces 89 button recipes, 8 segmented controls, 19 hand-built
dialogs and 6 loading patterns). Import everything from the barrel:

```tsx
import { Screen, InstrumentPanel, Verdict, Readouts, Readout, Panel, Button, Seg, useSearchParamState,
  QueryState, Dialog } from '../components/ui';
import { formatTime, formatMoney } from '../utils/format';
import { severityStatus } from '../utils/status';
```

Conventions every component follows:

- **State lives in ARIA**, which is also what the kit CSS selects on (3.2): `aria-selected` / `aria-checked` /
  `aria-pressed` / `aria-current` / `aria-invalid`. Never mirror state into a class.
- Every component passes `className` through, so a Tailwind utility can still tune it (3.3).
- Status is a **tone** from `utils/status` (`ok | headsup | problem | info | neutral`), never a colour. Chart colours
  are a **ChartTone** (`ink | graphite | soft | heat | cool | water | gas | ok | warn | problem | info | day | night |
  track | empty | band`) resolved to a token with `toneColor()`.
- Icon-only controls require a `label`; lamps take `label` (or `true` for the tone's word) when no word sits beside them.
- Per-element knobs go through `knobs({ '--fp-p': '62%' })` (typed `CSSProperties` with `--fp-*`), not a cast.
- Interactive things are real `<button type="button">` / router `<Link>`; nothing is a clickable `<div>`.

| file | components |
|---|---|
| `Layout.tsx` | `Screen`, `Panel`, `PanelHead`, `PanelFoot`, `SectionHead`, `Stack`, `Cluster`, `Spread`, `Grid`, `Split`, `Disclosure` |
| `Instrument.tsx` | `InstrumentPanel`, `Verdict`, `Readouts`, `Readout`, `Num` |
| `Button.tsx` | `Button`, `LinkButton`, `ExternalButton`, `IconButton`, `ButtonRow`, `buttonClass()` |
| `Seg.tsx` | `Seg`, `SegPanel`, `useSearchParamState`, `segTabId()`, `segPanelId()` |
| `Controls.tsx` | `Chips`, `Switch`, `Stepper`, `Swatches` |
| `Form.tsx` | `Field`, `Input`, `Textarea`, `Select`, `Checkbox`, `Radio`, `Fieldset`, `FormGrid`, `InputGroup` |
| `List.tsx` | `List`, `Row` |
| `Data.tsx` | `DataTable`, `KeyValue` + `KV`, `Timeline`, `Progress`, `Meter`, `MeterRow` |
| `Status.tsx` | `Lamp`, `Badge`, `StatusText`, `toneTextClass()`, `Tag`, `Count`, `LampRow` |
| `Feedback.tsx` | `Notice`, `EmptyState`, `ErrorState`, `SkelLine/Num/Block/Circle/Readout/Row/Rows`, `SkelInstrumentPanel`, `SkelPanel`, `Loading`, `QueryState` |
| `Dialog.tsx` | `Dialog`, `ConfirmDialog`, `useConfirm` |
| `Instruments.tsx` | `Dial`, `DialCentre`, `DialLegend`, `LegendKey`, `Ring`, `Gauge`, `Spark`, `ShareBar`, `LampMatrix`, `toneColor()`, `polar()`, `arcPath()` |
| `People.tsx` | `Avatar`, `AvatarStack`, `Board`, `MediaFrame`, `initials()`, `avatarInk()`, `contrastRatio()` |
| `chartTheme.ts` | `useChartTheme()`, `CHART_THEME`, `CHART_COLOURS`, `buildChartTheme()` (Recharts) |
| `cx.ts` | `cx()` (class join), `knobs()` |

### Page skeleton

```tsx
<Screen>
  <InstrumentPanel
    instrument={<Dial … />}
    verdict={<Verdict tone="headsup" note="Partly cloudy and 67° now.">A few things need a look.</Verdict>}
    readouts={
      <Readouts>
        <Readout label="Yesterday" value="35.5" unit="kWh" note="9% over the 32.6 forecast" noteIcon="arrow-up" />
        <Readout label="This cycle" value={formatAbout(114)} to="/utility" />      {/* a link well, with chevron */}
        <Readout label="Driveway" value="27" unit="%" tone="headsup" onClick={openCamera} />
      </Readouts>
    }
    foot={<><span className="fp-mono">Updated {formatTime(q.dataUpdatedAt)}</span><Button size="sm" onClick={() => q.refetch()}>Check now</Button></>}
  >
    <Button variant="primary" size="lg" block icon="play">Clean</Button>   {/* a "doing" page's main action */}
  </InstrumentPanel>

  <Seg id="roomba-view" label="Roomba" value={view} onChange={setView} options={VIEWS} />
  <SegPanel id="roomba-view" value={view}>
    <Panel title="Recent runs" subtitle="Last 30 days" action={<LinkButton size="sm" variant="quiet" to="…" iconEnd="arrow-right">See all</LinkButton>}>
      …
    </Panel>
  </SegPanel>
</Screen>
```

`InstrumentPanel` is named by the verdict sentence (a context hands the id to the `Verdict`); the verdict's lamp says
its word to screen readers. `Readouts count={3}` when some wells are role-gated, so the desktop row fits what shows.

### Layout

```tsx
<Panel title="Billing history" eyebrow="Electric" subtitle="Last 12 bills" action={<Chips … />} footer={…}>…</Panel>
<Panel flush title="For the curious"><Disclosure variant="row" summary="Show details" openSummary="Hide details">…</Disclosure></Panel>
<Panel level={3} title="…">          // h3 inside a dialog or a sub-section
<Stack gap="s">  <Cluster loose>  <Spread top>  <Grid cols={3} tight>  <Split ratio="even">
```

A `Panel` with a `title` is a `<section aria-labelledby>`; without one it is a plain `div`. Never a panel in a panel.

### Buttons

```tsx
<Button variant="primary" onClick={save}>Save record</Button>          // one per view
<Button>Secondary</Button>  <Button variant="quiet">Cancel</Button>
<Button variant="danger" onClick={() => setConfirming(true)}>Delete record</Button>
<Button size="sm" icon="file">View bill</Button>   <Button size="lg" block icon="play">Clean</Button>
<Button busy={save.isPending} busyLabel="Saving…">Save</Button>         // stays focusable, ignores taps
<LinkButton to="/notifications" variant="quiet" size="sm" iconEnd="arrow-right">See all</LinkButton>
<ExternalButton href={pdfUrl} size="sm">Open the PDF</ExternalButton>   // new tab, rel=noopener
<IconButton icon="edit" label="Edit Upstairs" />   <IconButton icon="x" variant="quiet" label="Close" small />
<IconButton icon="maximize" label="Full screen" pressed={full} onClick={toggle} />
<label className={buttonClass({ size: 'sm' })}>…<input type="file" hidden /></label>   // the rare non-button
```

### View switch (`Seg`) and URL state

```tsx
const VIEWS = [{ value: 'electric', label: 'Electric', icon: 'bolt' }, { value: 'gas', label: 'Gas', icon: 'flame' },
  { value: 'water', label: 'Water', icon: 'droplet' }] as const;
const [view, setView] = useSearchParamState('view', ['electric', 'gas', 'water'] as const, 'electric');
<Seg id="utility-view" label="Utility" value={view} onChange={setView} options={VIEWS} />
<SegPanel id="utility-view" value={view}>{view === 'gas' ? <Gas /> : …}</SegPanel>

<Seg kind="radio" fit="inline" label="Mode" value={mode} onChange={setMode} options={MODES} />   // a setting, no panel
```

- Tabs: `role=tablist` + `tab` + `aria-selected` + `aria-controls` → `SegPanel` (`role=tabpanel`, labelled by the tab);
  only the selected key is a Tab stop; arrow keys, Home and End move (and select). `kind="radio"`:
  `radiogroup` / `radio` / `aria-checked`.
- `fit`: `auto` (full width on a phone, content width from 640px), `inline`, `fill`.
- `useSearchParamState(key, allowed, fallback)`: the value lives in `?key=`; the default is left out of the URL, an
  unknown value falls back, changes **replace** the history entry and keep other params. That is what makes a view
  survive a reload, Back, the sleep screen (which unmounts the page) and a shared link. Use it for every view a person
  would expect to come back to (Utility view, Electric sub-tab, Diagnostics tab, Cameras Live/Recordings, Roomba
  Overview/Maintenance). Ids are global: prefix with the route.

### Controls

```tsx
<Chips label="Range" value={range} onChange={setRange} options={[{ value: '24h', label: '24 h' }, { value: '7d', label: '7 days' }]} />
<Chips multiple label="Alert types" value={types} onChange={setTypes} options={…} />    // chips can carry count / icon
<List><li><Switch checked={on} onChange={save} busy={m.isPending} label="Rain overnight" help="A heads-up at 8 PM when rain is likely" /></li></List>
<Switch bare label="Daily report" checked={…} onChange={…} />                            // just the track; the label (string or JSX) is read, not shown
<Stepper label="Heat to" value={70} min={60} max={85} unit="°" onChange={setHeat} />  // keys "Lower heat to" / "Raise heat to"
<Swatches label="Your colour" value={c} onChange={setC} options={[{ value: '#38bdf8', label: 'Sky', color: '#38bdf8' }]} />
```

Every toggle is a button with `aria-pressed` (chips, swatches) or `role=switch` + `aria-checked`, in a group named by
`label` (so two "All" chips on one page are told apart; B-041).

### Forms

```tsx
<FormGrid>
  <Field label="Job title" error={errors.title}><Input value={t} onChange={(e) => setT(e.target.value)} /></Field>
  <Field label="Category"><Select value={cat} onChange={…} options={CATEGORIES} /></Field>
  <Field label="Notes" optional wide help="Anything the next person should know"><Textarea … /></Field>
</FormGrid>
<Field label="Search"><Input type="search" icon="search" placeholder="Search jobs" /></Field>
<InputGroup><Input mono readOnly value={password} aria-label="Password" /><Button icon="copy">Copy</Button></InputGroup>
<Fieldset legend="Priority"><Radio name="p" label="Normal" defaultChecked /><Radio name="p" label="High" /></Fieldset>
<Checkbox label="Peak hour" help="When one hour uses 5 kWh or more" />
```

`Field` gives the control its id, the label's `htmlFor`, `aria-describedby` (error, then help) and `aria-invalid`
(B-042). Explicit props on the control still win. All text controls are 16px (B-009).

### Lists and data

```tsx
<List>
  <Row to="/maintenance" icon="wrench" title="Replace HVAC air filters" meta="Sun, Nov 15 · HVAC" value="$38.97" />
  <Row onClick={() => open(a)} lamp={severityStatus(a.severity).tone} title={a.title} meta={formatStamp(a.createdAt)} compact unread={!a.read} />
  <Row lead={<Avatar name="Mai" color={c} size="sm" decorative />} title="Mai" meta="Home since 7:39 AM" trail={<Badge tone="ok">Home</Badge>} />
</List>
<List inset> … </List>   <List cols> … </List>     // a framed group / two columns from lg

<DataTable rowKey={(b) => b.id} rows={bills} caption="Electric bills" columns={[
  { key: 'period', header: 'Period', kind: 'title', cell: (b) => formatDateRange(b.start, b.end) },
  { key: 'used', header: 'Used', num: true, cell: (b) => formatNumber(b.kwh, { unit: 'kWh' }) },
  { key: 'total', header: 'Electric', kind: 'key', num: true, strong: true, cell: (b) => formatMoney(b.electric) },
  { key: 'view', header: 'Bill', hideHeader: true, kind: 'action', cell: (b) => <Button size="sm" icon="file" onClick={…}>View bill</Button> },
]} />

<KeyValue>
  <KV kind="group" label="Flat charges" value="$20.37" swatch={toneColor('ink')} />
  <KV kind="sub" label="Customer charge" value="$19.25" />
  <KV label="Network" value="MapleHouse-Guest" mono />
  <KV kind="total" label="Gas total" value="$37.23" />
</KeyValue>

<Timeline items={events.map((e) => ({ id: e.id, at: e.at, time: formatTime(e.at), title: e.title, meta: e.where, tone: 'info', onClick: () => open(e) }))} />

<MeterRow label="Filter life" value="62%"><Progress value={62} label="Filter life" tone="ok" /></MeterRow>
<MeterRow label="Drive C:" value="92% full"><Meter value={0.92} label="Drive C:" tone="problem" valueText="92% full" /></MeterRow>
```

- `Row` renders its own `<li>`; anything else in a `List` (a `Switch`) needs its own `<li>`. A button row's accessible
  name is its visible text (title, meta, value), never a generic aria-label (B-132). `unread` adds "Unread." for
  screen readers.
- Lists and tables never scroll inside the page (B-006): past ~8 rows end with a `Disclosure variant="row"`
  ("Show 12 more") or a "See all" link. `DataTable` stacks into labelled blocks under 640px (every cell gets its
  column's `data-label`), so it needs no sideways scroll box and no virtual list.
- `Timeline` groups by the **home's** calendar day, newest first (pass items newest first).

### Status

```tsx
const s = severityStatus(n.severity);       // { tone: 'headsup', label: 'Heads-up' }
<Badge status={s} />   <Badge tone="ok">Home</Badge>   <Badge plain icon="clock">2 hr ago</Badge>   <Badge ink plain icon="sparkles">New</Badge>
<Lamp tone="problem" label />               // the lamp, and "Problem" for screen readers
<StatusText status={batteryStatus(27)} />   <Tag>{roleLabel(user.role)}</Tag>   <Count value={3} label="3 unread" />
<LampRow label="Systems" items={[{ key: 'power', label: 'Power', tone: 'ok', to: '/utility' }, …]} />
```

`utils/status.ts` is the **one** mapping from server enums to `{ tone, label }`: `severityStatus` (notifications),
`notificationCategory` (label + icon, no colour), `roleLabel` / `ROLE_LABEL` (Admin / Member / Guest; B-053;
`status.test.ts` keeps it equal to the shell's copy in `routes.ts`), `accountStatus`, `guestSessionStatus`,
`deviceLinkStatus`, `eventLevelStatus` (Diagnostics ERROR / WARN / INFO), `checkStatus` (server health checks),
`roombaPhaseStatus` (evac = "Emptying the bin", B-140; a mid-clean recharge; an error first), `batteryStatus`
(heads-up under 30%, problem under 15%), `onlineStatus`, and, enum only for the deferred tab, `priorityStatus` /
`jobStatus`. Also `worstTone()` (a verdict's lamp is the worst row listed), `TONE_WORD`, `kitTone()`, `humanize()`
(unknown enum values become neutral words, never blank or SHOUTING). Add new enums here, not in pages.

### Feedback and loading

```tsx
<QueryState query={billsQuery} what="the bills" loading={<SkelRows count={4} />}
  empty={<EmptyState icon="receipt" title="No water bills yet">Bills appear here a day after they arrive.</EmptyState>}>
  {(bills) => <DataTable … rows={bills} />}
</QueryState>

<Notice tone="headsup" title="Can't reach the thermostats." action={<Button size="sm" onClick={retry}>Try again</Button>}>Showing data from 4:58 PM.</Notice>
<Notice tone="neutral">Gas is only read once a month.</Notice>
<ErrorState title="Couldn't load the forecast" onRetry={() => q.refetch()} retrying={q.isFetching} />
<Loading label="Loading the forecast"><SkelInstrumentPanel readouts={3} /><SkelPanel chart /></Loading>
```

`QueryState` enforces the rule 15 screens broke (B-005, B-187): **nothing loaded yet** → skeleton (announced once);
**first load failed** → `ErrorState` with a working Try again (never "nothing here"); **loaded but empty** (`[]`, or
`null` from a 204) → your `empty`; **a refresh failed while data is held** → the data stays, with a slim heads-up
`Notice` ("Couldn't refresh the bills. Showing what came in at 4:58 PM." + Try again). `isEmpty` overrides what counts
as empty. A disabled query (`enabled: false`) shows the skeleton forever: don't wrap one. `EmptyState` text says what
will appear and when; with a search or filter in play, say so and how to clear it (B-004). Skeletons render inside
the page's own layout (B-051); `PageSkeleton` (shell) is for the route's lazy chunk.

### Dialogs

```tsx
<Dialog open={open} onClose={close} eyebrow="Maintenance" title="Add a record" closeOnBackdrop={!dirty}
  footer={<><Button variant="quiet" onClick={close}>Cancel</Button><Button variant="primary" busy={save.isPending} onClick={submit}>Save record</Button></>}>
  …form…
</Dialog>
<Dialog open size="wide" fullOnPhone wellBody title="October bill" tools={<IconButton icon="download" variant="quiet" label="Download" />} footerSplit footer={…}>…</Dialog>

<ConfirmDialog open={confirming} tone="danger" title="Delete this record?" confirmLabel="Delete record"
  busy={del.isPending} busyLabel="Deleting…" onConfirm={() => del.mutate()} onCancel={() => setConfirming(false)}>
  It can't be undone.
</ConfirmDialog>

const [confirm, confirmDialog] = useConfirm();        // window.confirm, as a promise
if (await confirm({ title: 'Expire every guest?', confirmLabel: 'Expire all', tone: 'danger' })) expireAll();
return <>{page}{confirmDialog}</>;
await confirm({ title: 'Saved', confirmLabel: 'Got it', cancelLabel: null });   // window.alert
```

What `Dialog` does, so pages never hand-build one again (B-043, B-008): `role=dialog` (ConfirmDialog:
`alertdialog`) + `aria-modal` + labelled by its title, described by `subtitle` (or by `describedBy`, an element
id, which wins: ConfirmDialog points it at its message, so a screen reader hears the consequence, not only the title); focus moves in (the first focusable,
or `initialFocusRef`), Tab is trapped (`useFocusTrap`), and focus returns to the opener on close *or unmount*;
Escape, the back gesture (`useBackToClose`) and a backdrop tap close it (`closeOnBackdrop={false}` while a form has
unsaved input); `useScrollLock`; opaque panel; sheet on a phone, centred from 640px; `size` narrow 440 / default 600
/ wide 880; `fullOnPhone` for players, documents and long forms; body scrolls inside, dvh max-height and safe-area
padding from the kit. It portals to `document.body` (clear of `[data-page-scroller]` and PullToRefresh's transform).
PullToRefresh already pauses while any `role=dialog` is open.

**A dialog opened from inside a dialog** portals into its parent's panel, so the two focus traps agree, and only the
top one answers Escape and Back. A dialog closed by a key while another stays open drops its history entry with
`history.back()`; that pop is skipped by the one underneath. Known limit (in `useBackToClose`, not the kit): after that
the parent's own entry is left behind when it closes, so one later Back does nothing visible.

`ConfirmDialog` focuses Cancel first (Enter never destroys by accident), has no close key, and ignores Escape / Back
while `busy`.

### Instruments

```tsx
<Dial rings={[{ r: 88, w: 10, min: 60, max: 85, ticks: 25, major: 5, labels: [[60, '60°'], [85, '85°']],
  segments: [{ from: 60, to: 68, tone: 'heat' }, { from: 75, to: 85, tone: 'cool' }],
  marks: [{ at: 68, tone: 'heat' }, { at: 75, tone: 'cool' }], needle: { at: 70.6 } }]}>
  <DialCentre label="Downstairs" note="Idle · 68–75°"><Num size="xl" value="71°" /></DialCentre>
</Dial>
<DialLegend items={[{ label: 'Heat to', value: '68°', tone: 'heat', key: 'box' }, { label: 'Cool to', value: '75°', tone: 'cool', key: 'box' }]} />

<Dial start={180} sweep={360} rings={…}>…</Dial>      // 24-hour clock, midnight at the bottom
<Dial half start={-90} sweep={180} rings={…}>…</Dial> // half dial: use Num size="m" in the centre
<Ring value={0.87} tone="ok" size={72} label="87% charged"><Num size="s" value="87" unit="%" /></Ring>
<Gauge value={58} min={20} max={100} zones={[{ from: 80, to: 100, tone: 'warn' }]} size={120} label="CPU 58 °F">…</Gauge>
<Spark values={last7} tone="ink" area label="Rising this week" />          // sized by its box's width
<ShareBar label="Gas bill by charge" parts={[{ key: 'flat', label: 'Flat charges', value: 20.37, tone: 'ink' }, …]} format={(v) => formatMoney(v)} />
<LampMatrix caption="13 of the last 14 days are complete." words={{ ok: 'All 24 hours', warn: 'Partial day', problem: 'Missing' }}
  cells={days.map((d) => ({ label: formatDate(d.day), short: …, state: d.state, note: `${d.hours} of 24 hours` }))} />
```

All ported from `prototype/charts.js`: inline SVG in a viewBox (240 × 240 around 120,120; spark 100 × h), no DOM
measuring to draw, colours from tokens via `toneColor()` (a theme or finish switch needs no re-render), the dial's
data arcs sweep in once through a mask and the pointer swings in (CSS, off under reduced motion). `size` sets
`--fp-dial-max` (default the `--appdial-max` token: 240 phone / 300 desktop). Give a dial a `label` when its centre
doesn't say everything; otherwise its SVG is decorative and the centre text is read. `LampMatrix` always shows a
readout line (the latest cell by default; pointer, finger or arrow keys / Home / End with the strip focused move it),
so no fact is hover-only. Not ported (phase 2, if a page needs them): line / bars / stack / diverge charts as SVG;
the pages keep Recharts for those.

**Recharts** (the big time-series) adopts one look in phase 2:

```tsx
const t = useChartTheme();             // before any early return
<CartesianGrid {...t.grid} />  <XAxis dataKey="t" {...t.axis} />  <YAxis {...t.axis} width={36} />
<Tooltip {...t.tooltip} labelFormatter={(v) => formatDateTime(v)} />   // B-039: a 7/30-day tooltip names the date
<Line dataKey="kwh" stroke={t.series.ink} strokeWidth={2} dot={false} />
<Line dataKey="predicted" stroke={t.series.graphite} strokeDasharray={t.dash} dot={false} />
<ReferenceLine y={avg} {...t.reference} />
```

Hex values (Recharts writes SVG attributes), mirrored from the `--appchart-*` / lamp tokens per theme, the same for
every finish. `CHART_COLOURS` has them raw. They agree with `CHART_SERIES` / `DATA_SERIES` in ThemeContext; new code
uses `useChartTheme().series`.

### People and media

```tsx
<Avatar name="Mai" color={user.accentColor} photoUrl={user.avatarUrl} size="lg" lamp="ok" lampLabel="home" />
<Avatar name="Bryan" color={c} size="sm" decorative />   // the name is written beside it
<AvatarStack label="Bryan and Mai are home"><Avatar … size="xs" decorative />…</AvatarStack>
<Board strip label="Who's around now" people={[{ key: 1, name: 'Bryan', color: c, state: 'Home', tone: 'ok', when: 'Sun, 6:12 PM' }, …]} />
<MediaFrame feed={<img className="fp-media-feed" src={still} alt="" />} name="Driveway" tag={{ text: 'Live', live: true }}
  time="5:00:12 PM" note="Person · 1 min ago" viewfinder caption={<>…battery… <IconButton icon="maximize" variant="quiet" label="Full screen" /></>} />
<MediaFrame offline={<><Icon name="zap-off" />Offline since Sun, 4:12 PM</>} … />
```

`Avatar` initials are whichever of ink or white contrasts more with the person's own colour (`avatarInk()`; B-158:
white on a pale disc measured 1.2–2:1). Initials follow the shell's rule (first letter of each word, at most two:
"Bryan" B, "Danny Tran" DT) so a person reads the same everywhere (B-183). A broken photo falls back to initials.
Sizes `xs 24 · sm 30 · md 36 · lg 56 · xl 88`.

### Formatting (`utils/format.ts`)

| function | gives |
|---|---|
| `formatDate(v)` / `formatShortDate(v)` / `formatWeekday(v)` | "Mon, Nov 9" (", 2025" only when not this year) / "Nov 9" / "Mon" |
| `formatTime(v)` / `formatHour(v or 0–23)` / `formatDateTime(v)` | "5:00 PM" / "5 PM", "Noon", "12 AM" / "Mon, Nov 9, 5:00 PM" |
| `formatStamp(v)` | an event in a list: today "8:05 AM", "Yesterday, 3:44 PM", this week "Sat, 10:10 PM", older "Fri, Oct 30" |
| `formatDayName(v)` | "Today" / "Yesterday" / "Tomorrow" / "Thu, Nov 5" |
| `formatRelative(v)` | "Just now", "2 min ago", "2 hr ago", "Yesterday", "3 days ago", then the date; ahead "in 5 min", "Tomorrow" |
| `formatDateRange(a, b)` / `formatTimeRange(a, b)` | "Nov 5 – Dec 5" (years when needed) / "6:40 PM – Tue, 5:32 AM" when it crosses midnight (B-134) |
| `formatMonthYear(v)` | "Oct ’26": a bill by the month its cycle ends (B-098) |
| `formatDuration(min)` / `formatDurationBetween(a, b)` | **the one style**: "under 1 min", "45 min", "2 hr 56 min", "14 hr", "3 days 4 hr" |
| `formatMoney(n, { cents, signed })` / `formatAbout(n)` / `formatRate(n, unit)` | "$1,234.50", "−$1.50", "+$3.20", "$114" / "about $114" / "$0.1171/kWh" |
| `formatNumber(n, { decimals, fixed, unit, signed })` / `formatPercent` / `formatTemp` | "11,400 gal", "35.5 kWh", "−3.2" / "27%" / "71°" |
| `plural(n, 'day')` / `pluralWord` / `formatList` | "3 days" / "days" / "Bryan, Mai and Linh" |
| `homeClock(v)`, `homeDayKey(v)`, `homeToday()`, `daysBetween(a, b)`, `toInstant(v)` | the home-clock building blocks |

- **Everything is the home's clock** (`HOME_TIME_ZONE = 'America/Chicago'`), not the device's, so a phone on a trip
  still calls 11 PM at home "11 PM" and "today" home's today (B-073, B-076 and B-093 were UTC or device-zone day
  maths; phase 2 replaces those call sites). How a value is read depends on its shape: a `Date`, epoch ms or an ISO
  string with Z / an offset is an instant; `"2026-11-09"` is a calendar day, never shifted; a zone-less
  `"2026-11-09 17:00:00.0"` is the backend's LocalDateTime, already home wall-clock, shown as written.
- Missing or unreadable → `DASH` ("—"). Figures and units, month and day, time and AM/PM are joined with a no-break
  space (`NBSP`), so "1,124 sq ft" never wraps apart; tests that compare text should normalise ` `. Negatives use
  a real minus (`MINUS`, "−"), never "−0".
- `utils/localDate.ts` (device-local `localTodayIso`, `parseLocalDate`) and `utils/host.ts`'s formatters still exist
  for the unconverted pages; converted code uses `format.ts`.

### Tests for the kit

`format.test.ts` (passes under any device `TZ`), `status.test.ts`, `seg.test.tsx` (tablist semantics, keys, URL
state), `dialog.test.tsx` (naming, focus in / trap / return, Escape, backdrop opt-out, Back, scroll lock, nested
dialogs, ConfirmDialog, useConfirm), `uiKit.test.tsx` (QueryState's four states, Avatar contrast, Field wiring,
toggles' ARIA, Button busy, Panel / InstrumentPanel naming, Row, DataTable labels, Timeline home days, Progress, the
instruments render from data with no layout reads).

---

## Phase 1b log

**What exists**: the kit above (`components/ui/*`: 15 modules + `index.ts`), `utils/format.ts`, `utils/status.ts`,
and five test files. No page uses the kit yet; nothing visible changed, and no behaviour, permission, data hook, API
module or route changed.

**Bugs**: none is closed by 1b alone, because each lives in a page that phase 2 converts. The kit is the fix each page
adopts; when converting, use it and close these:

| bug | the kit's part |
|---|---|
| B-005, B-187 (failed load shown as empty; one failed refresh replaces the page) | `QueryState` |
| B-004 (filtered list says "no records") | `EmptyState` guidance |
| B-006 (lists in short scroll boxes) | `List` / `DataTable` stacking; no `VirtualizedList` |
| B-008, B-043 (see-through, focus-less, back-swipe-leaving dialogs) | `Dialog` / `ConfirmDialog`; B-037's missing confirmation via `useConfirm` |
| B-039 (tooltips name only a weekday) | `useChartTheme` + `formatDateTime` in `labelFormatter` |
| B-040, B-098, B-134 (computer dates, ungrouped gallons, month labels, overnight end time) | `format.ts` |
| B-041, B-042 (unannounced pills, nameless fields) | `Chips` / `Seg` / `Switch` ARIA, `Field` wiring |
| B-053 (role names) | `roleLabel` (page part: Users, Profile's `RoleBadge`) |
| B-073, B-076, B-093 (UTC / device-zone day maths) | `homeToday`, `homeClock`, `daysBetween` |
| B-074, B-075 (tabs without panels or keys; views forgotten on reload) | `Seg` + `SegPanel` + `useSearchParamState` |
| B-132 (same-day runs read alike) | `Row` names a button row by its visible text |
| B-140 (Emptying shown as Cleaning) | `roombaPhaseStatus` |
| B-158, B-183 (pale avatar initials; initials differ) | `Avatar` + `avatarInk` + `initials` |
| B-044 (stat-tile icons contradict labels) | `Readout` has no decorative icon; a `noteIcon` only for direction |

**Decisions to know about**

- Duration style is "2 hr 56 min" everywhere (REVIEW.md flagged two styles); `utils/tabs.ts` `minutesLabel` and
  `utils/host.ts` `duration` still write "3 h 5 min" for their pages until converted.
- Avatar initials follow the existing app and the shell (one letter for a one-word name), not the prototype's two.
- Maintenance priority labels (for when the tab is converted): Low / Normal / High / Urgent; statuses Scheduled /
  In progress / Done / Cancelled. Only the enum mapping exists; nothing in the Maintenance tab changed.
- No toast runtime and no `FloorMap` / SVG line-bar charts yet: no converted page needs them so far.

**Open, for whoever picks it up**

- `ShellAvatar` (`initialsOf`, `letteringFor`) and `routes.ts` `ROLE_LABEL` duplicate `People.tsx` / `status.ts`
  (same results; `status.test.ts` guards the role labels). Have the shell import the kit's when it next changes.
- `useBackToClose` marks its entry popped on any popstate, so nested dialogs can leave one stale history entry (see
  Dialogs). A small hook change (ignore a pop whose new state still carries this entry's token) would remove it.
- `parseServerTs` (utils/serverTime) still reads zone-less server times on the device's clock; `format.ts` reads them
  on the home's. Converted pages should pass the raw string to `format.ts` rather than a parsed `Date`.
- The kit was checked by tests and the type checker, not yet by eye in a browser: the first converted page should be
  screenshotted at phone and desktop, light and dark (the dial especially).

**Maintenance (deferred)**: untouched by 1b (`MaintenanceDashboard.tsx` and `api/maintenance.ts` not edited); it
compiles and its tests pass.

---

## Phase 1d log

Integration of 1a–1c, the review's findings, and a look at every screen.

### Review findings

| finding | verdict | what changed |
|---|---|---|
| major: kit dialogs (z 70) drew over the sleep screen (z 60) and the countdown (z 50); What's new could open over the night-light after a deploy | **confirmed** | `App.tsx`: the More sheet renders `open={moreOpen && !asleep}` and an effect closes it on sleep; `{!asleep && <ReleaseNotesModal />}` (it records the version only on close, so it reopens after waking). `SleepScreen` z-90, `SleepWarning` z-75. Test: shell.test "closes the More sheet when the app falls asleep" |
| minor: choosing a page in the More sheet left the sheet's history entry, so one Back did nothing | **confirmed** | `NavLink … replace` in MoreSheet, `Link … replace` for "See all updates". Test: history grows by exactly one entry (fails without `replace`) |
| minor: ConfirmDialog's message wasn't its accessible description | **confirmed** | `Dialog describedBy`; ConfirmDialog ties its message by id. Tests in dialog.test |
| minor: `formatRelative` said "Yesterday" for three minutes across midnight | **confirmed** | minutes are checked before the day; midnight cases in format.test |
| minor: the More sheet stayed open (scroll lock, focus trap, Back entry) when the window crossed lg | **confirmed** | `matchMedia('(min-width: 64rem)')` closes it. Test with a stubbed matchMedia |
| minor: Google Fonts `@import` blocked first paint, and the app can't paint offline from the internet | **confirmed** | fonts self-hosted (`src/assets/fonts`, `@font-face` in index.css), preconnects removed. Built CSS has no `googleapis` |
| minor: `Switch bare` had no name with a JSX label | **confirmed** | bare renders its label in an `fp-sr-only` span inside the button. Test in uiKit.test |
| minor: dead CSS (`.theme-toggle*`, `pb-safe`, `px-*`) and the unused `PixelScene.tsx` | **confirmed** (the review said indexCss.test listed no `px-*` names; it did, as sentinels) | deleted; indexCss.test now checks `.guest-bg` as the last rule, `modal-overlay` as the utility, and `roomba-halo-pulse` / `spin` / `pulse` keyframes |

### Verification

- `npx tsc --noEmit -p tsconfig.json`: clean. `npx vitest run`: 45 files, all pass. `npm run build`: clean.
- `dist/assets/index-*.css`: every `@keyframes` (`fp-dial-needle`, `fp-dial-sweep`, `fp-dialog-in`, `fp-lamp-pulse`,
  `fp-map-ping`, `fp-rec-blink`, `fp-scrim-in`, `fp-sheet-in`, `fp-skel-shine`, `ping`, `pulse`,
  `roomba-halo-pulse`, `spin`), all six `[data-theme][data-palette]` blocks, 411 distinct `fp-` classes, the six
  font files under `/assets/`, and the file's last rule (`.guest-bg`).

### Screenshot harness

A Playwright script that renders the real frontend against mocked API fixtures (the API is never called). It lives
outside the repo, in the session scratchpad:

```
cd frontend && npx vite --port 5199 --strictPort          # leave running; stop it when done
cd <scratchpad>/after && BASE_URL=http://127.0.0.1:5199 node capture.js                # every screen
BASE_URL=http://127.0.0.1:5199 node capture.js --only roomba --vp phone --theme light  # one page, one view
```

`<scratchpad>` is `C:/Users/Bryan/AppData/Local/Temp/claude/C--code-repos-claude-repos-home-automation/aab116ea-8348-4745-85ca-9374a9dd93fb/scratchpad`.
Fixtures are `<scratchpad>/fixtures/*.json` (`_overrides.json` loads last). Shots land in `after/p1/shots/` as
`<shot>-<phone|desktop>-<light|dark>[-full].png` with a `manifest.json` (console errors, unmatched requests, and
flags for horizontal overflow, error boundaries and leftover skeletons). Theme comes from `localStorage.theme`
(`light` / `dark`); add a shot by adding an entry to `SHOTS` (a `setup(page)` can click into a view or open a
dialog). Prototype screens for comparison: `<scratchpad>/proto/v2/shots/<route>-<phone|desktop>-<light|dark>.png`.
Copy the script before changing it for a phase-2 run, so the 1d baseline stays.

### What the screens showed (33 screens and 13 overlays, phone and desktop, both themes; 356 images)

- **The shell matches the prototype** in structure and finish: the strip (wordmark, mono clock, House lamp, Alerts
  plate, theme key, avatar; the phone strip's title, bell and avatar), the desktop key column with group labels and
  the inverted current key, the phone key row with the inverted current key and More's count, the More sheet's
  keypads and Light / Dark switch, the What's new kit dialog, the "Still there?" panel and the sleep screen. No
  horizontal overflow on any phone screen.
- **Every unconverted page is legible and usable in both themes**: no white-on-white, borders visible, primary keys
  ink-on-enamel in light and enamel-on-ink in dark, chart axes and series readable. They still look like the old app
  inside the new frame (hero cards, emoji, rounded pastel tiles), which is what phase 2 removes.
- Still wrong, all in pages (phase 2), none new to the shell:
  - Climate (phone): the Heat to / Cool to `+` keys stick out of their boxes (B-020; it was already so).
  - Roomba run details (phone): the long Mission ID runs past the dialog's edge.
  - Utility Electric (desktop): "$0.1171/kWh" touches its tile's edge in the hero (the hero goes in phase 2).
  - Guest management (phone): expiry pills wrap mid-time ("Dec 7, 10:02 / AM").
  - Debug (phone): the tab strip is cut at the right edge with no scroll cue.
  - Guest home (phone): the "Who's at the House?" card is squeezed to a narrow column by the top-right keys.
  - Old page modals (Forecast, Edit profile, Clean, run details) are still the old overlays: they work and are opaque, but are not kit dialogs yet.
  - Home: still the old layout (weather card, module tiles), not the dial and board of the prototype.
- Harness gaps, not app bugs: Guest Wi-Fi has no QR without `VITE_WIFI_SSID`, so the QR overlay shot can't be taken;
  live camera tiles show "format isn't supported" (no real stream).
- Maintenance (deferred): it renders in the frame and works in both themes; in its Add dialog on desktop, the
  "Emergency" priority key runs under the Status select. Noted in `MAINTENANCE-TODO.md`.

### Still open

- B-014 (a transient `/auth/me` failure signs people out): fixed in the final pass (see "Phase 2 and final pass").
- `useBackToClose` with nested dialogs can still leave one stale entry (see "Dialogs"); not changed in 1d.
- Not seen on a real iPhone: the sticky strip inside the scroll box, the light status band, safe areas, the fonts.
- The manifest's splash is light (`#e9ecea`) for dark-theme users for a moment; it can't follow the theme.
- `ROLE_LABEL` (routes.ts) and the kit's `roleLabel`, and `ShellAvatar`'s initials and the kit's `initials()`, are
  still duplicates with identical results; converge them when People and Profile are converted.


---

## Phase 2 and final pass

Phase 2 converted every page except Maintenance, in seven areas worked in parallel; a final pass then tied them
together. The per-area reports went to the coordinator; this is the short record.

### What each area did

| area | pages | in short |
|---|---|---|
| Home | `HomeSummary.tsx`, `pages/home/summary.ts` | the dial-and-board home: day/rain ring, lamp row (Power, Climate, Roomba, Alerts), "needs a look" list, readouts, next hours, the shortcut list to every page the person can open, recent alerts |
| Utilities | `Utility.tsx`, `ElectricalUsage.tsx`, `GasUsage.tsx`, `WaterUsage.tsx`, the chart components, `pages/utility/parts.tsx` | one page with Electric / Gas / Water (`?view=`); the predicted-bill dial with "How the $… is worked out"; Usage & bills / Forecast & stats; per-bill gas and water gauges; the legend, tooltip and Show-more pieces (now in the kit, below) |
| Climate + Cameras | `Climate.tsx`, `Thermostat*`, `Cameras.tsx`, `CameraTile.tsx`, `CameraRecordings.tsx`, the battery chart | a thermostat dial per floor (`?thermostat=`), steppers, mode and comfort keys, last change and history; Cameras Live / Recordings with the player dialog and per-camera chips |
| Roomba | `Roomba.tsx`, `RoombaMap.tsx`, the room dialogs, `utils/roombaStatus.ts`, `components/roomba/` | the map as the instrument, one verdict from `roombaVerdict`, queued commands with their state, Overview / Maintenance, runs behind Show more; controls stay admin-only |
| Wi-Fi, sign-in, guests | `WiFiPage.tsx`, `Login.tsx`, `Register.tsx`, `GuestLogin.tsx`, `GuestHome.tsx`, `pages/door/`, `pages/guest/`, `pages/wifi/` | the "front door" frame for signed-out pages, the visitor badge, the QR card and its full-screen dialog |
| People, Alerts, Profile, What's new | `UserManagement.tsx`, `Notifications.tsx`, `ProfilePage.tsx`, `Updates.tsx`, the profile and alert settings components | the lobby row of people, join requests, the Manage dialog; the alert counts plate and filters; profile identity, appearance switchgear, Alerts / Weather / This device |
| Admin | `pages/admin/*` (Who's home, Guests, Activity log, App usage, Server health, Diagnostics) | each on the instrument + verdict + readouts skeleton; Diagnostics tabs in `?tab=`; the activity clock; the server gauges |

### Final pass

- **Roomba status in one place.** Home's own `roombaState` is gone: `pages/home/summary.ts` has `homeRoomba()` and
  `roombaDetail()` built on `utils/roombaStatus.roombaState`, so Home and the Roomba page can't disagree (a stale
  reading is "Offline. Last seen cleaning, 2 hr ago"; the bin emptying is "Emptying the bin", never "Cleaning").
  Home only raises the tone (not the word) for the robot's own "needs a look" flag, as the Roomba verdict does.
  `homeSummary.test.ts` checks every phase against the shared helper.
- **B-014 fixed.** `AuthContext` has `sessionCheck: 'ok' | 'unreachable'`, `retrySession()` and `retryingSession`.
  Only a 401/403 from `/auth/me` clears the token; a network error, 5xx or timeout keeps it, marks the check
  unreachable and retries by itself (2 s, 4, 8, 16, then every 30 s; at once on `online` and when the app comes back
  to the front). `ProtectedRoute` shows "Can't reach the home server" with Try again (drawn like the not-found page)
  instead of sending the person to sign in. Tests in `Guards.test.tsx`: network error, 502 then Try again, the
  `online` event, the timer, 401, 403, and a 401 found by a retry.
- **Dead code removed:** `StatTile.tsx`, `IntegrationPanel.tsx`, `Weather24HourCard.tsx` (no importers),
  `getWeatherEmojiForHour`, `updatedText` (thermostat), `localTodayIso`, and from `index.css` the unused
  `modal-overlay` / `modal-panel` utilities, `.perf-section`, `.qr-canvas` and `.guest-bg`. Kept on purpose: the
  light-only pastel remap (`:root:not([data-theme="dark"])`), because Maintenance still uses palette classes;
  `WeatherContextCard.tsx` and the emoji helpers it uses (no page renders it, but it has its own tests); tested
  helpers no page calls any more (`minutesLabel`, `utils/host` `duration` / `since` / `restartCause`). `PixelScene.tsx`
  was already deleted in 1d.
- **Built CSS keyframes: nothing lost.** 1a had 20 `@keyframes` blocks (13 plus the seven pixel-scene ones), 1d 13,
  now 12: `ping` went because no page uses Tailwind's ping animation any more (Tailwind only emits its own keyframes for
  utilities in use). Every keyframes block declared in `index.css` and the kit is in the build, as are the six finish
  blocks and the file's last rule. `indexCss.test.ts` now reads the last rule and every declared `@keyframes` name
  from the source instead of hard-coded sentinels, and replays a stray comment terminator to prove the checks fail.
  Gotcha found on the way: Tailwind scans tests and these docs too, so writing a utility's name in a comment (the
  ping one, here) is enough to bring its CSS back into the build.
- **Kit additions** (`components/ui`, `styles/faceplate.css`), tested in `uiKit.test.tsx`:
  - `ChartLegend`, `TooltipCard`, `TooltipLine` (`ui/Chart.tsx`) and `ShowMore` (`ui/Layout.tsx`), promoted from
    `pages/utility/parts.tsx` (which keeps `niceTicks`, `DEFERRED_CHART`, `meterGated`).
  - A `Ring` with a `size` holds that width in a flex row (`Dial fixed`, `.fp-dial--fixed`); the fixed-width
    wrappers in Roomba and Guests are gone.
  - A flush `Panel` no longer lets a `List` spill past its edges (the list's negative margins only apply inside a
    padded panel).
  - `Switch` has a disabled look; `Chips` take `disabled` per option or for the whole row.
  - `Seg` keys share the well equally but never shrink below their own label (on a phone, Diagnostics' "Events 2"
    key ran into its neighbours).
- Small page fixes from the screenshots: Server health's "Wi-Fi 92%" no longer breaks at the hyphen; its older power
  events say "Show N older events / Hide older events" like the other lists.

### What the screens showed (final: 60 shots, phone 390×844 and desktop 1440×900, light and dark; 484 images)

The harness copy is `<scratchpad>/after/capture-final.js` (shots in `after/final/`). It adds `role: 'USER' | 'GUEST'`
(the signed-in person's role) and `meStatus` (fail `/auth/me`, for the unreachable screen) to a shot.

- Every converted page follows the skeleton: the shell's title and freshness line, one instrument panel with a
  verdict and readout wells, the view switch, panels. Readout wells, list rows, keys, chips, dates and numbers look
  the same from page to page, in both themes, on phone and desktop. No horizontal overflow, error boundary or
  leftover skeleton on any shot; no unreadable text found in either theme.
- Member and guest views: a member's Roomba page says only an admin can start or stop the robot; a guest's key row
  has no Cameras and Climate's set points are read-only; a member's People page has no join requests.
- Maintenance (deferred) renders and works inside the new frame in both themes; its own hero, pastel tiles and old
  dialogs are unchanged (notes in `MAINTENANCE-TODO.md`).

### Still open

- The freshness line says "Checked …" on Utilities > Electric, Who's home and Server health (when the source was
  last checked) and "Updated …" elsewhere, so switching Electric to Gas changes the word. Deliberate per page, but
  worth one rule.
- The What's new dialog opens with its close key showing the focus ring; the other dialogs don't.
- Harness limits, not app bugs: the bill PDF and recorded clips 404 (no files), live tiles say the format isn't
  supported, and Profile's badge comes from `/auth/profile`, so a role-swapped shot still says Admin.
- Not seen on a real iPhone (see the 1d list); `useBackToClose` with nested dialogs; the manifest splash colour; the
  `ROLE_LABEL` / `roleLabel` duplicate (all from 1d).
