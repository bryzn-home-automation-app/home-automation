# Faceplate kit — the guide (v2)

You build screens for **Faceplate**: the house as a well-made appliance. Matte enamel, black lettering, one instrument
that answers the question, a few lamps that light only when they mean something. **There is no accent colour.**
Selection is ink-on-enamel inversion (an ink-filled key). Colour appears only as status lamps/badges and chart data.

**If it is not in this file, it does not exist.** Do not read kit.css to find classes; do not invent generic classes.
Reference screens to copy patterns from: `screens/home.html` (answer + lists + a dialog) and `screens/utility.html`
(sub-views, charts, tables, a full-height dialog). Every component below is rendered and labelled on the hidden route
`#kit-gallery` (`screens/kit-gallery.html`) — open it in both themes before you start.

---

## 0. The ten rules

1. Your file is one `<section class="screen" data-route="…">` fragment. No `<script>`, no `<style>`, no literal colours.
2. **One title per page, and the shell draws it** from `data-title`. Never put an `<h1>`, a hero, or a marketing sentence in your screen.
3. Every page opens with **the instrument panel** (`.ip`): the instrument + the verdict + 2–4 readouts. Nothing above it except a *subject switch* (see §2).
4. Then the view switch (if any), then detail panels, then rare/technical material behind a disclosure. Same order on every page.
5. Selected = ink fill. Primary button = ink fill. Never colour a button, a nav item, a tab or a heading.
6. Status uses exactly four words and four lamps: **OK** (green), **Heads-up** (amber), **Problem** (red), **Info** (blue). Always a word or icon next to the colour.
7. Cards by role: a `.panel` per detail section; inside a panel, group with readout wells, `.list--inset`, `.kv` or hairlines. **Never a panel inside a panel. Never a grid of equal tiles as the page.**
8. Numbers: `.num` (tabular, condensed) with the unit in `.unit` (mono). Times, dates in meta, IDs and clock values in `.mono`.
9. Phone first (390px): nothing overflows, every target ≥ 44px, the page scrolls — nothing else does (dialog bodies are the only exception).
10. Look at your screen: private build + screenshots at phone and desktop, light and dark, and fix until it is right.

---

## 1. Files, builds, screenshots

You may create only: `screens/<route>.html`, optionally `screens/<route>.css` (unique element only, §13) and
`screens/<route>.js` (tiny behaviour, IIFE). Never edit `tokens.css`, `kit.css`, `shell.html`, `charts.js`, `KIT.md`
or `_shared/`. If you truly need something the kit lacks, compose it from kit pieces; if impossible, put it in your
screen CSS and mention it in your hand-off notes.

```
node <proto>/_shared/build.js v2 --tag <you> --only home,<your routes>
node <proto>/_shared/shoot.js v2 --tag <you> --routes <your routes> --full
node <proto>/_shared/shoot.js v2 --tag <you> --routes <route> --tab <group>:<name>     # a sub-view
node <proto>/_shared/shoot.js v2 --tag <you> --routes <route> --modal <id>             # a dialog
```
Shots land in `proto/v2/shots-<you>/`. The report must say **no overflow or console errors**.

---

## 2. The page template (copy this)

```html
<section class="screen" data-route="climate" data-title="Climate" data-eyebrow="Everyday" data-subtitle="Updated 5:00 PM">

  <!-- 1–3. THE ANSWER: instrument + verdict + readouts -->
  <section class="ip" aria-labelledby="climate-verdict">
    <div class="ip-instrument">
      <!-- your page's instrument (a data-chart="dial", a map, the camera tiles, a QR plate…) -->
      <div class="dial-legend">…optional legend…</div>
    </div>
    <div class="ip-body">
      <div class="verdict">
        <span class="lamp lamp--ok"></span>
        <p class="verdict-text" id="climate-verdict">71° downstairs, 69° upstairs and heating.</p>
        <p class="verdict-note">Mai set Upstairs to 70° at 4:56 PM. Downstairs follows the schedule.</p>
      </div>
      <div class="readouts">
        <div class="readout">…</div>  <!-- 2 to 4 -->
      </div>
      <!-- optional: the page's primary action, an attention list, a disclosure, an .ip-foot -->
    </div>
  </section>

  <!-- 4. VIEW SWITCH (only if the page has sub-views) -->
  <div class="seg" data-tabs="climate-view" role="tablist" aria-label="Thermostat">
    <button class="seg-key is-active" type="button" role="tab" data-tab="down">Downstairs</button>
    <button class="seg-key" type="button" role="tab" data-tab="up">Upstairs</button>
  </div>

  <!-- 5. DETAIL PANELS -->
  <div class="stack stack--page" data-tab-panel="climate-view:down">
    <section class="panel" aria-labelledby="climate-hist">
      <header class="panel-head">
        <div><h2 class="panel-title" id="climate-hist">Last 24 hours</h2><p class="panel-sub">Inside temperature and setpoints</p></div>
        <div class="panel-action"><button class="btn btn--sm btn--quiet" type="button">See week</button></div>
      </header>
      …
    </section>
  </div>
  <div class="stack stack--page" data-tab-panel="climate-view:up" hidden>…</div>

  <!-- 6. Dialogs for this page live at the END of the fragment -->
  <div class="dialog" data-modal="climate-confirm" hidden role="dialog" aria-modal="true" aria-labelledby="…">…</div>
</section>
```

**Screen attributes**
- `data-title` — the page name from the IA, exactly: Home, Utilities, Climate, Cameras, Roomba, Maintenance, Guest Wi-Fi, People, Alerts, Profile, What's new, Who's home, Guests, Activity log, App usage, Server health, Diagnostics. Shown as the desktop `<h1>` and in silk-screen caps in the phone strip.
- `data-eyebrow` — the IA group: `Everyday`, `House`, `You` or `Admin` (desktop only, above the title).
- `data-subtitle` — a **freshness cue** in the form `Updated 5:00 PM` / `Checked 9:45 AM` / `Live`. Shown in mono beside the desktop title and under the phone title. Omit if the page has no live data. Never a sentence.
- Full-screen pages (`login`, `guest-portal`) add `data-chrome="none"` and get no shell: build them as a centred faceplate (`.panel` on `--enamel`), still with kit components.

**Order and placement**
- The page's root is a flex column with the standard page gap; just stack panels. Use `.split` / `.grid-*` for side-by-side panels on desktop.
- **Subject switch vs view switch.** If the sub-views are *different subjects* each with their own answer (Utilities: Electric / Gas / Water), the `.seg` goes **first**, above the `.ip`, and each subject panel holds its own `.ip`. If they are *different detail of the same subject* (Cameras: Live / Recordings; Roomba: Overview / Maintenance; Diagnostics tabs), the `.seg` goes **after** the `.ip`. Never two stacked segmented controls without content between.
- Wrap each tab panel in `<div class="stack stack--page" data-tab-panel="group:name">`; hide all but the first with `hidden`.
- Primary action: on "doing" pages (Roomba, Climate, Wi-Fi, Maintenance) the action lives **inside `.ip-body`**, under the readouts — e.g. a `.btn--primary.btn--lg.btn--block` "Clean" on Roomba, "Add a record" on Maintenance.
- Technical/rare material goes last, in `<section class="panel panel--flush"><details class="disclosure disclosure--row">…` ("For the curious", "Show details", "Manage devices").

---

## 3. Writing the answer

The `.ip` answers the question the person came with (table in BRIEF-common.md), in plain family words.

- **Verdict** = one sentence, ≤ 12 words, starts with the fact, not with "Your". Good: "Heading for about $114 this cycle." / "Rosie is docked and charged." / "A few things need a look." Bad: "Electric Module Overview", "Everything is operating within normal parameters".
- **Lamp** on the verdict: `lamp--ok` when nothing needs doing; `lamp--warn` when something should be looked at soon; `lamp--problem` when something is broken or blocked; `lamp--info` for neutral news (e.g. "Rain from 1 AM"). Never leave the verdict without a lamp.
- **Verdict note** = one or two sentences of *why* or *what next*, with numbers. ≤ 30 words.
- **Readouts** = 2–4 facts that back the verdict. Label in 1–2 words (silk-screen), value with unit, a one-line note with context or comparison ("9% over the 32.6 forecast", "Last 7 days"). Make a readout a link (`a.readout data-nav`) when it is the way to the detail.
- If several items need attention, list them right under the verdict in a `.list.list--inset` of compact rows with lamp leads (Home shows this).
- Freshness: `.ip-foot` with mono text ("Meter data through Sun, 11:00 PM") and optionally a small action, or rely on `data-subtitle`.
- Mind roles: content that only admins see gets `data-role-only="admin"` (guests also lose `member` items). Phrase verdicts so they stay true when role-only rows disappear ("A few things need a look", not "3 things").

---

## 4. Tokens you may use in screen CSS

Surfaces `--enamel` (page) · `--panel` · `--well` (recessed) · `--well-deep` · `--key-face` · `--key-face-hover` · `--row-hover`
Ink `--ink` · `--graphite` (secondary text) · `--graphite-soft` (decorative ticks only, never text) · `--on-ink` · `--hairline` · `--hairline-strong` · `--focus`
Lamps (fills) `--lamp-ok` `--lamp-warn` `--lamp-problem` `--lamp-info` `--lamp-off` `--lamp-edge`; text `--text-ok` `--text-warn` `--text-problem` `--text-info`; tints `--tint-*`; edges `--edge-*`
Danger `--danger-fill` `--on-danger`
Charts `--chart-ink` `--chart-graphite` `--chart-soft` `--chart-heat` `--chart-cool` `--chart-water` `--chart-gas` `--chart-grid` `--chart-band` `--chart-cursor` `--chart-empty`
Dial `--dial-track` `--dial-day` `--dial-night` `--dial-tick`
Media (always dark) `--media-bg` `--media-ink` `--media-ink-soft` `--media-scrim` `--media-rec` `--scene-sky` `--scene-far` `--scene-near` `--scene-ground` `--scene-line` `--scene-light`
Label plate (always white: QR, visitor badge, paper) `--plate` `--plate-ink` `--plate-soft` `--plate-edge`
Map `--map-floor` `--map-wall` `--map-room` `--map-dot`
People `--person-bryan` (sky) `--person-mai` (rose) `--person-linh` (purple) `--person-alex` (teal, guest) `--person-jordan` (amber, guest) `--person-danny` `--person-kim` · `--avatar-ink` · `--avatar-ring`
Type `--font` `--mono` `--t-label` `--t-small` `--t-body` `--t-lead` `--t-section` `--t-title` `--t-num-xl` `--t-num-l` `--t-num-m` `--stretch-label` `--stretch-num`
Space `--s-1`…`--s-9` (4, 8, 12, 16, 20, 24, 32, 40, 56) · `--gutter` · `--panel-pad` · `--gap`
Palettes `html[data-palette="ocean|sunset|violet"]` tint the enamel, panels and wells only (Profile sets it); `--finish-*` are the swatch samples. Ink, lamps and chart colours never change.
Radius `--r-panel` 12 · `--r-key` 10 · `--r-well` 8 · `--r-chip` 8 · `--r-tag` 6 — circles for dials/lamps. **No shadows** except `--well-shadow` (inner, for recesses).
Sizes `--tap` 44 · `--tap-sm` 36 · `--dial-max` · Motion `--ease` `--t-fast` `--t-sweep`

---

## 5. Type

| class | use |
|---|---|
| `.label` | silk-screen label: 11.5px, UPPERCASE, wide. The **only** uppercase in the app. Readout labels, field labels, small section labels, dialog eyebrows. |
| `.verdict-text` | the verdict sentence (18px phone / 21px desktop). One per answer. |
| `.panel-title` | panel heading (16px/600). Use `<h2>` in screens (`<h3>` inside dialogs/sub-sections). |
| `.panel-sub` | one-line description under a panel title (13px graphite). |
| body | 15px, `.prose` for multi-paragraph text (max 68ch). |
| `.small` / `.muted` | 13px / graphite. |
| `.mono` | DM Mono: times, dates in meta lines, IDs, versions, the clock, units. |
| `.num` `.num--xl` `.num--m` `.num--s` | readout numerals 28 / 44 / 18 / 15, tabular, condensed. Always put the unit in `<span class="unit">kWh</span>` inside. |
| `.t-ok` `.t-warn` `.t-problem` `.t-info` | status-coloured text (always with words). |
| `.strong` · `.trunc` · `.t-center` `.t-right` · `.sr-only` | helpers. |
| `.link` | inline text link (underlined). |
| `.code` | inline mono chip for IDs: `<span class="code">FIX-E-0048213</span>` |

---

## 6. Layout utilities

| class | does |
|---|---|
| `.stack` (`--xs` 4, `--s` 8, `--m` 12, default 16, `--l` 24, `--page` = page gap) | vertical flex with gap |
| `.cluster` (`--l`) | wrapping row, gap 8 (16) |
| `.spread` (`--top`) | space-between row |
| `.grid-2` `.grid-3` `.grid-4` (+ `.grid-tight`) | 1 column on phone; 2 from 640px; 3/4 from 1024px |
| `.split` (7:5) `.split--even` (1:1) `.split--wide` (2:1) | two columns from 1024px; stacked below. Children are usually `.stack.stack--page` holding panels. |
| `.hide-phone` / `.hide-wide` | hide under / from 640px |
| `.mt-s` `.mt-m` | margin-top 8 / 16 |
| `.self-start` | don't stretch in a flex column |

Desktop content is capped at 1240px. Use the width: put related panels side by side with `.split`, and use `.list--cols`, `.kv--cols`, `.grid-*` inside panels.

---

## 7. Components

### 7.1 Instrument panel `.ip`
When: always, once, first (after a subject switch only). Two columns from 720px (instrument ~40%), stacked on phone (instrument on top, dial max 240px).
```html
<section class="ip" aria-labelledby="x-verdict">
  <div class="ip-instrument"> …instrument… <div class="dial-legend">…</div> <ul class="lamps">…</ul> </div>
  <div class="ip-body"> .verdict · (.list--inset attention rows) · .readouts · (primary action) · (.disclosure) · (.ip-foot) </div>
</section>
```
`.ip-foot`: `<div class="ip-foot"><span class="mono">Updated 5:00 PM</span><button class="btn btn--sm" type="button">Check now</button></div>`
Don't: put two `.ip`s in one view; put a panel inside `.ip`; skip the instrument.

### 7.2 Verdict `.verdict`
```html
<div class="verdict">
  <span class="lamp lamp--warn"></span>
  <p class="verdict-text" id="home-verdict">A few things need a look.</p>
  <p class="verdict-note">Partly cloudy and 67° now. Rain is likely from 1 to 9 AM.</p>
</div>
```

### 7.3 Readouts `.readouts > .readout`
Recessed wells. 2 per row on phone (an odd last one spans), 2–4 in a row on desktop (count-aware). `.readouts--2x2` forces 2×2.
```html
<div class="readouts">
  <div class="readout">
    <span class="label">Yesterday</span>
    <span class="readout-value"><span class="num">35.5<span class="unit">kWh</span></span></span>
    <span class="readout-note"><svg class="icon" aria-hidden="true"><use href="#i-arrow-up"/></svg>9% over the 32.6 forecast</span>
  </div>
  <a class="readout" href="#people" data-nav="people">…</a>          <!-- link readout: chevron appears -->
</div>
```
A readout that opens a dialog or jumps to a tab is a `<button class="readout" type="button">` (same look and chevron). Role-hidden wells are not counted: app.js keeps the row full width.
Variants: lamp in the label `<span class="label"><span class="lamp lamp--warn lamp--s"></span>Temperature</span>`; `.readout--plain` (no well). Readouts also work inside a `.panel` for a stats group ("How good is the forecast").
Don't: more than 4; sentences as values; colour the number.

### 7.4 Lamp row `.lamps` (indicator panel)
A row of system lamps with silk-screen labels; each can link. Home uses it under the 24-hour ring; Diagnostics can use it for the pipeline.
```html
<ul class="lamps" aria-label="Systems">
  <li><a class="lamps-item" href="#utility" data-nav="utility"><span class="lamp lamp--ok"></span><span class="label">Power</span><span class="sr-only">OK</span></a></li>
</ul>
```
`.lamps--left` = left-aligned, wrapping (inside panels). Keep labels to one short word.

### 7.5 Panel `.panel`, header, footer, section head
```html
<section class="panel" aria-labelledby="p1">
  <header class="panel-head">
    <div><p class="label">Optional</p><h2 class="panel-title" id="p1">Recent alerts</h2><p class="panel-sub">3 unread</p></div>
    <div class="panel-action"><a class="btn btn--sm btn--quiet" href="#alerts" data-nav="alerts">See all<svg class="icon" aria-hidden="true"><use href="#i-arrow-right"/></svg></a></div>
  </header>
  …content…
  <footer class="panel-foot"><span class="mono muted">Updated 5:00 PM</span><button class="btn btn--sm" type="button">Refresh</button></footer>
</section>
```
Variants: `.panel--flush` (no padding; use when the panel is only a list/table/disclosure row); `.panel--well` (recessed aside, rare).
`.section-head` > `.section-title` + action: a heading between groups of panels (rare).
Panel action slot holds one quiet/sm button, or a `.chips` group (ranges/filters).
Don't: nest panels; give a panel a coloured background; add shadows.

### 7.6 Segmented control `.seg` (views)
Keys in a well; selected key is ink-filled. Full width on phone, content-width from 640px.
```html
<div class="seg" data-tabs="cameras-view" role="tablist" aria-label="Cameras">
  <button class="seg-key is-active" type="button" role="tab" data-tab="live"><svg class="icon" aria-hidden="true"><use href="#i-video"/></svg>Live</button>
  <button class="seg-key" type="button" role="tab" data-tab="recordings"><svg class="icon" aria-hidden="true"><use href="#i-history"/></svg>Recordings</button>
</div>
<div class="stack stack--page" data-tab-panel="cameras-view:live">…</div>
<div class="stack stack--page" data-tab-panel="cameras-view:recordings" hidden>…</div>
```
Variants: `.seg--inline` (always content-width, e.g. a mode switch Heat/Auto/Cool/Off inside a panel); `.seg--fill` (always full width). 2–4 keys. Icons optional, consistent within one control.
Group names must be unique in the whole app: prefix with your route (`roomba-view`, `admin-debug-tab`).

### 7.7 Chips `.chips > .chip` (filters and ranges)
```html
<div class="chips" data-tabs="cameras-filter" role="tablist" aria-label="Camera">       <!-- single choice -->
  <button class="chip is-active" type="button" role="tab" data-tab="all">All cameras</button>
  <button class="chip" type="button" role="tab" data-tab="driveway">Driveway <span class="count">12</span></button>
</div>
<div class="chips" role="group" aria-label="Alert types">                                   <!-- many choices -->
  <button class="chip" type="button" data-toggle aria-pressed="true">Weather</button>
</div>
```
Chips are 34px with an invisible 44px hit area. Under 640px a chip drops its icon so a filter row stays at two lines. Place a chip row in `.panel-action` or as the first child of the panel body — one row of filters above what they filter.

### 7.8 Lists `.list > li > .row`
Divided list; in a panel the rows run edge to edge with dividers. Rows are `<a class="row">` (navigates), `<button class="row">` (opens a dialog) or `<div class="row">` (static).
```html
<ul class="list">
  <li><a class="row" href="#maintenance" data-nav="maintenance">
    <span class="row-lead"><svg class="icon" aria-hidden="true"><use href="#i-wrench"/></svg></span>
    <span class="row-main"><span class="row-title">Replace HVAC air filters</span><span class="row-meta">Scheduled Sun, Nov 15 · HVAC</span></span>
    <span class="row-trail"><span class="row-value">$38.97</span><svg class="icon chev" aria-hidden="true"><use href="#i-chevron-right"/></svg></span>
  </a></li>
</ul>
```
Leads: `.row-lead` (icon in a well), `.row-lead.row-lead--lamp` with a `.lamp` (severity — alerts, attention items), an `.avatar` directly (people). Trails: `.row-value` (number + `.unit`), a `.badge`, a `.count`, `.avatars`, a `.btn--sm`, and/or `.chev`.
Variants: `.row--compact` (48px, for alerts/attention lists); `.row.is-unread` (bold title + ink dot at the end; add `<span class="sr-only">Unread.</span>`); `.row-title--regular` (weight 500 for sentence-like titles).
Containers: `.list` (in panel: edge to edge) · `.list--inset` (framed group inside a panel body or `.ip-body`) · `.list--cols` (two columns from 1024px).
Don't: put a list in its own scroll box; show more than ~8 rows without a "Show more" disclosure or a "See all" link.

### 7.9 Data table `.table` (stacks on phone)
```html
<div class="table-wrap">
  <table class="table">
    <thead><tr><th scope="col">Period</th><th scope="col" class="is-num">Used</th><th scope="col" class="is-num">Electric</th><th scope="col">Due</th><th scope="col"><span class="sr-only">Bill</span></th></tr></thead>
    <tbody>
      <tr>
        <td class="cell-title" data-label="Period">Oct 7 – Nov 5</td>
        <td class="is-num" data-label="Used">716 <span class="unit">kWh</span></td>
        <td class="cell-key is-num is-strong" data-label="Electric">$108.39</td>
        <td data-label="Due">Mon, Nov 30</td>
        <td class="cell-action"><button class="btn btn--sm" type="button" data-open-modal="utility-bill"><svg class="icon" aria-hidden="true"><use href="#i-file"/></svg>View bill</button></td>
      </tr>
    </tbody>
  </table>
</div>
```
Under 640px each row becomes a block: `.cell-title` top-left, `.cell-key` top-right (the one number that matters), every other cell as LABEL / value in two columns (label comes from `data-label`), `.cell-action` full width at the bottom, `.cell-wide` full width. **Every `<td>` needs `data-label`.** Put the table as a direct child of a `.panel` (it bleeds to the panel edges). Use a table for ≥ 3 comparable columns; otherwise a list.

### 7.10 Key-value `.kv`
```html
<dl class="kv">
  <div class="kv-row kv-row--group"><dt><span class="swatch" style="--sw: var(--chart-ink)"></span>Flat charges</dt><dd>$20.37</dd></div>
  <div class="kv-row kv-row--sub"><dt>Customer charge</dt><dd>$19.25</dd></div>
  <div class="kv-row"><dt>Network</dt><dd class="mono">MapleHouse-Guest</dd></div>
  <div class="kv-row kv-row--total"><dt>Gas total</dt><dd>$37.23</dd></div>
</dl>
```
`.kv--cols` = two columns from 1024px. `.swatch` (box), `.swatch--line`, `.swatch--dash` with `--sw` colour to tie a row to chart data. Use for facts, breakdowns, receipts, device details.

### 7.11 Buttons
```html
<button class="btn btn--primary" type="button">Save record</button>          <!-- ink key: the one main action -->
<button class="btn" type="button">Secondary</button>                         <!-- raised white key -->
<button class="btn btn--quiet" type="button">Cancel</button>                 <!-- text key -->
<button class="btn btn--danger" type="button">Delete record</button>         <!-- destructive, confirmed in a dialog -->
<button class="btn btn--danger-quiet" type="button">Remove</button>
<button class="btn btn--sm" type="button">View bill</button>                 <!-- compact 36px, 44px hit area -->
<button class="btn btn--primary btn--lg btn--block" type="button"><svg class="icon" aria-hidden="true"><use href="#i-play"/></svg>Clean</button>
<div class="btn-row">…</div>  <div class="btn-row btn-row--end">…</div>
```
Icon buttons — always with `aria-label`:
```html
<button class="icon-btn" type="button" aria-label="Edit"><svg class="icon" aria-hidden="true"><use href="#i-edit"/></svg></button>
```
Variants `.icon-btn--quiet` (dialog close, toolbars), `--primary`, `--sm`; toggled state with `data-toggle aria-pressed="false"`.
Links that look like buttons are `<a class="btn …" href="#route" data-nav="route">`. Labels are verbs in sentence case ("Start a clean", "Mark all read", "Copy password"). One primary per view; on desktop put dialog actions right (`.dialog-foot`), on pages put the primary in `.ip-body`.

### 7.12 Lamps, badges, tags, counts
```html
<span class="lamp lamp--ok"></span>        <!-- --warn --problem --info, none = off; --s 7px --l 12px; --pulse for live -->
<span class="badge badge--ok">Home</span>  <!-- --warn --problem --info --ink --plain; neutral = .badge -->
<span class="badge badge--plain"><svg class="icon" aria-hidden="true"><use href="#i-clock"/></svg>2 hr ago</span>
<span class="tag">Admin</span>             <!-- role / category chip (silk-screen); .tag--ink for "New" -->
<span class="count">3</span>               <!-- unread counter plate -->
```
Badge words: OK / Heads-up / Problem / Info, or the plain state ("Home", "Away", "Offline", "Scheduled", "Done", "Charging"). Status always as words — a lamp alone needs a visible word next to it or `<span class="sr-only">Heads-up</span>`.
Role tags: `Admin`, `Member`, `Guest` (never ADMIN/USER enums).

### 7.13 Forms
Field = silk-screen label + recessed control + help/error:
```html
<label class="field"><span class="label">Job title</span><input class="input" type="text" placeholder="What was done?"><span class="field-help">A few words</span></label>
<label class="field is-invalid"><span class="label">Cost</span><input class="input" type="text" aria-invalid="true" value="38.9.7">
  <span class="field-error"><svg class="icon" aria-hidden="true"><use href="#i-alert-circle"/></svg>Enter an amount like 38.97</span></label>
<label class="field"><span class="label">Category</span><span class="select"><select><option>HVAC</option></select><svg class="icon" aria-hidden="true"><use href="#i-chevron-down"/></svg></span></label>
<label class="field"><span class="label">Notes</span><textarea class="textarea"></textarea></label>
<div class="field"><span class="label">Search</span><div class="input-wrap"><svg class="icon" aria-hidden="true"><use href="#i-search"/></svg><input class="input" type="search" placeholder="Search jobs" aria-label="Search jobs"></div></div>
<div class="input-group"><input class="input input--mono" value="sunny-otter-482" readonly aria-label="Password"><button class="btn" type="button" data-toast="Password copied"><svg class="icon" aria-hidden="true"><use href="#i-copy"/></svg>Copy</button></div>
<div class="form-grid"> two fields side by side from 640px; .is-wide spans both </div>
```
`.input--mono` for codes/passwords/dates. Inputs are 16px (no iOS zoom).

Switch (two-position toggle, saves instantly) — a full-width row; in a `.list` it gets dividers:
```html
<ul class="list"><li>
  <button class="switch" type="button" role="switch" aria-checked="true" data-toggle>
    <span class="switch-text"><span class="switch-label">Rain overnight</span><span class="switch-help">A heads-up at 8 PM when rain is likely</span></span>
    <span class="switch-track" aria-hidden="true"><span class="switch-knob"></span></span>
  </button>
</li></ul>
```
`.switch--bare` = just the track (needs `aria-label`).
Checkbox / radio:
```html
<label class="check"><input type="checkbox" checked><span>Daily report</span></label>
<label class="check"><input type="checkbox"><span class="check-text"><span>Peak hour</span><span class="check-help">When one hour uses 5 kWh or more</span></span></label>
<fieldset class="fieldset"><legend class="label">Priority</legend><label class="radio"><input type="radio" name="p" checked><span>Normal</span></label>…</fieldset>
```
Stepper (− value +):
```html
<div class="stepper" role="group" aria-label="Heat to">
  <button class="icon-btn icon-btn--quiet" type="button" aria-label="Lower heat-to temperature"><svg class="icon" aria-hidden="true"><use href="#i-minus"/></svg></button>
  <output class="num stepper-value">70<span class="unit">°</span></output>
  <button class="icon-btn icon-btn--quiet" type="button" aria-label="Raise heat-to temperature"><svg class="icon" aria-hidden="true"><use href="#i-plus"/></svg></button>
</div>
```
(+/− behaviour needs a tiny `screens/<route>.js`.)
Colour swatch keys (palette, accent colour) — single choice via data-tabs:
```html
<div class="swatches" data-tabs="profile-accent" role="tablist" aria-label="Accent colour">
  <button class="swatch-key is-active" type="button" role="tab" data-tab="sky" style="--sw: var(--person-bryan)" aria-label="Sky blue"></button>
</div>
```
Files: `<div class="dropzone" role="button" tabindex="0" data-toast="Choose a receipt or photo"><svg class="icon" aria-hidden="true"><use href="#i-paperclip"/></svg><span><strong>Add a receipt or photo</strong></span><span class="small">PDF, JPG or PNG</span></div>`

### 7.14 Dialog (sheet on phone, centred on desktop)
```html
<div class="dialog" data-modal="maint-add" hidden role="dialog" aria-modal="true" aria-labelledby="maint-add-title">
  <div class="dialog-panel">
    <header class="dialog-head">
      <div class="dialog-heading"><p class="label">Maintenance</p><h2 class="dialog-title" id="maint-add-title">Add a record</h2><p class="dialog-sub">Optional one line</p></div>
      <button class="icon-btn icon-btn--quiet" type="button" data-close-modal aria-label="Close"><svg class="icon" aria-hidden="true"><use href="#i-x"/></svg></button>
    </header>
    <div class="dialog-body stack"> …scrolls… </div>
    <footer class="dialog-foot">
      <button class="btn btn--quiet" type="button" data-close-modal>Cancel</button>
      <button class="btn btn--primary" type="button" data-close-modal data-toast="Record saved">Save record</button>
    </footer>
  </div>
</div>
<button class="btn" type="button" data-open-modal="maint-add">Add a record</button>
```
Sizes: default 600px · `.dialog--narrow` 440 (confirmations) · `.dialog--wide` 880 (players, documents) · `.dialog--full` (full-height sheet on phone — use for players, documents, long forms). Extra header buttons go in `<div class="dialog-tools">` before the close button. `.dialog-foot--split` spreads Older / Download / Newer. `.dialog-body--well` gives the body an enamel backdrop (document viewers). Footer is optional (omit for read-only dialogs). Put dialogs at the end of your fragment; ids are globally unique (`<route>-<name>`). The backdrop click, Escape and `data-close-modal` close it; the page behind stops scrolling.

### 7.15 Disclosure
```html
<details class="disclosure">
  <summary><span class="when-closed">Show details</span><span class="when-open">Hide details</span><svg class="icon" aria-hidden="true"><use href="#i-chevron-down"/></svg></summary>
  <div class="disclosure-body">…</div>
</details>
```
Variants: `.disclosure--key` (looks like a secondary key); `.disclosure--row` (full-width row at the bottom of a panel: "Show 23 more days"; as the only child of a `.panel.panel--flush` it is a whole collapsed section: "For the curious"). Wording: "Show details", "For the curious", "Manage devices", "Show 12 more".

### 7.16 Notice
```html
<div class="notice notice--warn"><svg class="icon" aria-hidden="true"><use href="#i-alert-triangle"/></svg>
  <div><p class="notice-title">Can't reach the thermostats.</p><p class="notice-text">Showing data from 4:58 PM.</p></div>
  <div class="notice-action"><button class="btn btn--sm" type="button">Try again</button></div></div>
```
`.notice` (info, icon `info`) · `--warn` (`alert-triangle`) · `--problem` (`alert-circle`) · `--ok` (`check-circle`) · `--plain` (neutral context). Use for a stale-data banner, a one-time explanation ("Gas is only read once a month"), a broken connection. Not for marketing copy.

### 7.17 Empty, error, loading
```html
<div class="empty"><svg class="icon" aria-hidden="true"><use href="#i-receipt"/></svg><p class="empty-title">No water bills yet</p><p class="empty-text">Bills appear here a day after they arrive.</p></div>
<div class="empty empty--error" role="alert"><span class="lamp lamp--problem"></span><p class="empty-title">Couldn't load the forecast</p><p class="empty-text">The home server didn't answer. Your data is safe.</p>
  <button class="btn btn--sm" type="button" data-toast="Trying again"><svg class="icon" aria-hidden="true"><use href="#i-refresh"/></svg>Try again</button></div>
```
`.empty--compact` = shorter. Every list needs an empty sentence that says *what will appear and when*. Show at least one real error state with Try again where it fits your area (e.g. a sub-view, Diagnostics).
Skeletons: `.skel` + `.skel-line` (`--s` `--m`), `.skel-num`, `.skel-block`, `.skel-circle`; composites `.skel-readout` and `.skel-row`:
```html
<div class="skel-readout"><span class="skel skel-line skel-line--s"></span><span class="skel skel-num"></span></div>
<div class="skel-row"><span class="skel"></span><div><span class="skel skel-line skel-line--m"></span><span class="skel skel-line skel-line--s"></span></div></div>
```
A refetch keeps the old content and adds `.is-refreshing` (dims it) — no skeleton flash.

### 7.18 Progress and meter
```html
<div class="meter-row"><span class="small">Filter life</span><span class="mono">62%</span>
  <div class="progress progress--ok" role="progressbar" aria-valuenow="62" aria-valuemin="0" aria-valuemax="100"><span style="--p: 62%"></span></div></div>
<div class="meter-row"><span class="small">Drive C:</span><span class="mono">92% full</span>
  <div class="meter meter--problem" style="--v: .92" role="meter" aria-valuenow="92" aria-valuemin="0" aria-valuemax="100"><span></span></div></div>
```
`.progress` (smooth bar, `--p` percent; `--ok --warn --problem --info --thin`) for "how far along" (cycle, part life). `.meter` (LED segments, `--v` 0–1, `--n` segment count, default 10; tones as progress) for levels (storage, battery, signal). Colour = state, not decoration: ink when there's no judgement.

### 7.19 Avatar
```html
<span class="avatar" style="--who: var(--person-mai)">MA<span class="lamp lamp--ok avatar-lamp"></span></span>
```
Sizes `--xs` 24 · `--sm` 30 · default 36 · `--lg` 56 · `--xl` 88. Initials: two letters (BR, MA, LI, AL, JO, DT, KN). `.is-away` = hollow ring in their colour. Stack: `<span class="avatars"><span class="avatar avatar--sm" …>BR</span>…</span>`. `.person` = avatar + text row (who did something).

### 7.19b Presence board `.board`
One cell per person: face, name, a lamp with a silk-screen state word, and a mono time. The same cell everywhere (People, Who's home, the guest lobby).
```html
<div class="board board--strip">     <!-- .board = 2 x 2 (Who's home); --strip = one row of four once 300px wide; --fill = no 460px cap -->
  <ul class="board-grid" aria-label="Who's around now">
    <li><div class="board-cell">       <!-- or <button class="board-cell" data-open-modal="…"> to open the person -->
      <span class="avatar avatar--lg" style="--who: var(--person-bryan)" aria-hidden="true">BR</span>
      <span class="board-name">Bryan</span>
      <span class="board-state"><span class="lamp lamp--ok"></span><span class="label">Home</span></span>
      <span class="board-when">Sun, 6:12 PM</span>
    </div></li>
  </ul>
</div>
```
`.board-cell.is-away` greys the name and state (pair it with `.avatar.is-away` and an unlit lamp). On a strip narrower than 440px the times drop out.

### 7.20 Timeline (day-grouped)
```html
<div class="timeline">
  <section>
    <h3 class="tl-day"><span class="label">Today</span><span class="mono">Mon, Nov 9</span></h3>
    <ol class="tl-list">
      <li class="tl-item"><span class="tl-time">4:56 PM</span><span class="lamp lamp--info"></span>
        <div class="tl-body"><p class="tl-title">Upstairs set to 70° by Mai</p><p class="tl-meta">Thermostat · from the app</p></div></li>
    </ol>
  </section>
</div>
```
Use `lamp--off` for neutral events (sign-ins). Items can be `<button class="tl-item">` to open a detail dialog. Newest first.

### 7.21 Media frame (camera tile)
```html
<figure class="media">
  <div class="media-frame">
    <svg class="scene" viewBox="0 0 320 180" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <rect class="scene-sky" width="320" height="180"/><rect class="scene-ground" y="112" width="320" height="68"/> …
    </svg>
    <span class="media-vf" aria-hidden="true"></span>                       <!-- viewfinder corner marks -->
    <span class="media-tag"><span class="media-rec"></span>Live</span>      <!-- .media-tag--off = not streaming -->
    <time class="media-time">5:00:12 PM</time>
    <span class="media-name">Driveway</span>
    <span class="media-note">Person · 1 min ago</span>
  </div>
  <figcaption class="media-cap"><span class="cluster"><span class="lamp lamp--warn lamp--s"></span><span class="small">Battery 27%</span></span>
    <button class="icon-btn icon-btn--quiet" type="button" aria-label="Full screen"><svg class="icon" aria-hidden="true"><use href="#i-maximize"/></svg></button></figcaption>
</figure>
```
Overlays: `.media-play` (a round play button, centre), `.media-frame.is-offline` + `<span class="media-offline"><svg class="icon"…zap-off/>Offline since Sun, 4:12 PM</span>`. Scenes are stylised inline SVG with the `scene-*` classes (sky, far, near, ground, line, light, ink) — never photos. Footage is always dark in both themes.

### 7.22 Map container
```html
<div class="map" role="img" aria-label="Floor plan with Rosie in the kitchen">
  <svg viewBox="0 0 400 300" preserveAspectRatio="none" aria-hidden="true">
    <rect class="map-room" x="20" y="20" width="200" height="150"/>  <!-- .is-active = the room being cleaned -->
    <path class="map-path" d="…"/>                                     <!-- robot path, dotted -->
    <path class="map-wall" d="M20 20 H380 V280 H20 Z …"/>
    <path class="map-door" d="M190 140 H212"/>                          <!-- gap in a wall -->
  </svg>
  <span class="map-label" style="--x: 30%; --y: 30%">Living room</span>
  <span class="map-pin" style="--x: 82%; --y: 76%"><svg class="icon" aria-hidden="true"><use href="#i-dock"/></svg></span>
  <span class="map-dot" style="--x: 75%; --y: 27%"></span>             <!-- live robot, pulsing -->
</div>
```
4:3 on phone, 16:10 from 1024px. Positions in percent of the map box.

### 7.23 Toast
Add `data-toast="Rosie is heading to the kitchen"` to any action button (with or without other behaviour). Write what happened, in the past or present tense, ≤ 8 words. The runtime renders `.proto-toast`; the kit styles it (ink plate above the key row).

---

## 8. Charts — `charts.js`

Put a `data-chart` element in the page; it is drawn on load from its `data-*` attributes (JSON values). Charts never
measure the DOM and take their colours from tokens, so theme switches need no redraw. Every line/bar/heat chart gets
a **readout** line above the plot: it shows a default point (the latest real value) and follows the pointer, a finger,
or the arrow keys when the plot has focus — values are never hover-only. Use `<figure class="chart" …>` with a
`<figcaption class="sr-only">` sentence that states the takeaway. Legends are generated for 2+ series.

**Tones** (`tone` / `data-tone`): `ink` (primary series), `graphite` (comparison/forecast — usually `dash`), `soft`
(minor part), `heat`, `cool`, `water`, `gas`, `ok`, `warn`, `problem`, `info`, `day`, `night`, `empty`, `band`.
Use hue only when two series must be told apart; a single series is `ink`. Never put two y-axes on one chart —
stack two charts with the same `data-sync` instead (Utilities "Use and temperature").

**Common attributes**: `data-labels` (full label per point, used in the readout: `"Sun, Nov 8"`), `data-short`
(tick label per point, `""` for none — ticks thin themselves on narrow screens), `data-height` (plot px, default 180),
`data-unit` (`"kWh"`, `"%"`, `"°F"`), `data-prefix` (`"$"`), `data-decimals`, `data-y-min` / `data-y-max`,
`data-y-ticks` (≈ count), `data-zero="true"` (start at 0), `data-tick-unit` (suffix on y ticks, e.g. `"°"`),
`data-readout` (index shown by default), `data-sync="group"` (scrub several charts together), `data-gutter` (y-label px).

**line** — series, optional band and today marker.
```html
<figure class="chart" data-chart="line" data-height="200" data-unit="kWh" data-decimals="1" data-today="30"
  data-labels='["Sat, Oct 10", …]' data-short='["Oct 10","","",…]'
  data-band='{"name":"Likely range","short":"Likely","lower":[…],"upper":[…]}'
  data-series='[{"name":"Actual","tone":"ink","dots":true,"values":[…, null]},{"name":"Forecast","tone":"graphite","dash":true,"values":[…]}]'>
  <figcaption class="sr-only">…takeaway…</figcaption>
</figure>
```
Series keys: `name`, `values` (use `null` for gaps), `tone`, `dash`, `dots`, `area` (10% wash), `thin` (1.5px for dense hourly data), `unit`/`prefix`/`decimals` overrides, `legend:false`. Chart keys: `data-today` (index) + `data-today-label` ("Today", "Tue"…), `data-refs='[{"at":30}]'` (dotted reference lines).

**bars** — one series of columns (≤ 24px wide, value on the cap when ≤ 8 bars).
```html
<figure class="chart" data-chart="bars" data-height="190" data-unit="CCF" data-labels='["Aug ’26 bill",…]' data-short='["Aug",…]'
  data-values="[1,3,4,9]" data-notes='["Jul 24 – Aug 6, 13 days",…]'></figure>
```
Extras: `data-partial="[0,2]"` + `data-partial-label` (outlined bars for incomplete periods), `data-mark="3"` (highlight one bar, others graphite), `data-ref="120.18"` + `data-ref-label="Average"` (dotted line), `data-value-labels="all|none|last|max"`, `data-thin="true"` (10px bars for 24+ columns), `data-notes` (extra readout text per bar), `data-readout-decimals`.

**stack** — stacked parts with 2px gaps.
```html
<figure class="chart" data-chart="stack" data-prefix="$" data-empty="[0]" data-totals="[12.64,27.41,29.05,37.23]"
  data-labels='[…]' data-short='[…]'
  data-parts='[{"name":"Flat charges","tone":"ink","values":[…]},{"name":"Gas used","tone":"gas","values":[…]}]'></figure>
```
`data-empty` = indices with no breakdown (drawn grey, "Not itemized yet"; give their `data-totals`), `data-empty-label`.

**heat** — a strip of cells: intensity (`data-values` + `data-max` + `data-tone`) or an **LED matrix** of states:
```html
<div class="chart" data-chart="heat" data-labels='["Oct 27",…,"Nov 9"]' data-short='["Oct 27","",…,"Today"]'
  data-states='["ok","ok","warn","problem","off"]' data-state-words='{"ok":"All 24 hours","warn":"Partial day","problem":"Missing","off":"Not yet"}'></div>
```
States: `ok` `warn` `problem` `info` `off`. A lamp legend is generated. `data-cell-height` to resize.

**diverge** — rows above/below a centre line (e.g. day-of-week vs normal):
`<div data-chart="diverge" data-labels='["Mon",…]' data-values="[-4,-5,-2,-3,2,12,9]" data-unit="%" data-tone="ink" data-tone-neg="graphite"></div>`

**spark** — `<span data-chart="spark" data-values="[…]" data-height="36" data-tone="ink" data-area="true"></span>` (put it in a sized box).

**ring** — small round gauge for a single fraction: `<div data-chart="ring" data-value="0.87" data-tone="ok"><div class="dial-centre"><span class="num num--s">87%</span></div></div>` (size it with a wrapper width, e.g. 64–96px).

**dial** — THE INSTRUMENT. A square SVG (viewBox 240×240, centre 120,120) with one or more concentric rings and an
HTML centre. The data arcs sweep in once when the page opens (500ms, skipped for reduced motion).
```html
<div class="dial" data-chart="dial" data-start="-135" data-sweep="270"
  data-rings='[{"r":88,"w":10,"min":60,"max":85,"ticks":25,"major":5,"labels":[[60,"60°"],[85,"85°"]],
               "segments":[{"from":60,"to":68,"tone":"heat"},{"from":75,"to":85,"tone":"cool"}],
               "marks":[{"at":68,"tone":"heat"},{"at":75,"tone":"cool"}],"needle":{"at":70.6}}]'>
  <div class="dial-centre"><span class="label">Downstairs</span><span class="num num--xl">71°</span><span class="dial-note">Idle · 68–75°</span></div>
</div>
<div class="dial-legend"><span class="lg-item"><span class="lg-key lg-key--box" style="--c: var(--chart-heat)"></span>Heat to <b>68°</b></span></div>
```
- `data-start` = angle of `min` in degrees, 0 = top, clockwise (−135 + sweep 270 = classic gauge; −150/300 = wide gauge; 180/360 = 24-hour clock with midnight at the bottom; −90/180 = half dial — add class `dial--half`).
- Ring keys: `r` radius (keep ≤ 92 for an outer ring with outside labels), `w` width, `min`, `max`, `track` (false = no track), `trackTone`, `edge` (true = engraved hairline edge), `ticks` (count), `major` (every n), `tickSide:"in"`, `labels` [[value,"text"],…] (placed outside, or inside with `tickSide:"in"`; keep them off the needle's path), `labelR`, `gap` (degrees between segments), `segments` [{from,to,tone,dash,w,static}] (`static:true` = context arcs such as daylight that don't sweep), `marks` [{at,tone,label,inset,out}] (short ticks across the band: a setpoint, "last bill"), `needle` {at, style:"pointer"|"needle"} (pointer = a bold tick across the ring, works with centre text; needle = from the hub, only for dials **without** centre text).
- Centre: `.dial-centre` holds `.label`, a `.num--xl` (or `--m` on a half dial) and `.dial-note`. Keep it to three lines.
- Legend under the dial: `.dial-legend` with `.lg-item` + keys `.lg-key` (line), `--dash`, `--box`, `--seg` (dashed band), `--mark` (tick), `--band`, `--today`; set the colour with `style="--c: var(--chart-ink)"`; values in `<b>`.
- Size: max 240px phone / 300px desktop, centred. Screens may tune with `.screen[data-route=x] .dial { --dial-max: 260px }`.

**JS API** (screens/*.js, after changing attributes): `FP.render(el)` re-draws one chart; `FP.renderAll(rootEl)` re-draws all inside.

---

## 9. Icons

`<svg class="icon" aria-hidden="true"><use href="#i-NAME"/></svg>` — 24px grid, 1.5px stroke, `currentColor`.
Sizes: default 20px, `.icon--s` 16, `.icon--l` 28; `.icon--fill` fills (play). Icon-only controls need `aria-label`; meaningful standalone icons need `aria-label` on the svg instead of `aria-hidden`. **No emoji anywhere.**

home · bolt · zap-off · flame · droplet · thermometer · snowflake · fan · camera · video · robot · dock · wifi · router ·
users · user · wrench · tool · bell · sparkles · shield · id-card · activity · list · bar-chart · gauge · map-pin · map ·
server · cpu · hard-drive · sun · moon · contrast · cloud · cloud-sun · cloud-moon · rain · storm · fog · wind · sunrise ·
sunset · calendar · clock · history · chevron-right · chevron-left · chevron-down · chevron-up · arrow-up · arrow-down ·
arrow-right · arrow-left · plus · minus · check · x · check-circle · alert-triangle · alert-circle · info · play · pause ·
stop · maximize · battery · battery-low · battery-charging · plug · power · search · filter · sliders · edit · trash ·
download · external-link · qr · copy · eye · eye-off · lock · key · door · log-out · log-in · settings · more · grid ·
menu · refresh · leaf · dollar · receipt · file · paperclip · image · phone · tablet · laptop · watch · globe · mail ·
heart · star

Weather: clear day `sun`, night `moon`; partly cloudy `cloud-sun` / `cloud-moon` (night = before 6:52 AM or after 5:31 PM); cloudy `cloud`; fog `fog`; rain/showers `rain`; storms `storm`; snow `snowflake`; wind `wind`.
Nav icons (use the same ones for the same pages): Home `home`, Utilities `bolt` (Gas `flame`, Water `droplet`), Climate `thermometer`, Cameras `camera`, Roomba `robot`, Maintenance `wrench`, Guest Wi-Fi `wifi`, People `users`, Alerts `bell`, Profile `user`, What's new `sparkles`, Who's home `map-pin`, Guests `id-card`, Activity log `history`, App usage `bar-chart`, Server health `server`, Diagnostics `activity`.

---

## 10. Behaviour attributes (shared runtime)

| attribute | use |
|---|---|
| `data-nav="route"` | on `<a href="#route">` or a button: navigate. Active links get `.is-active`. |
| `data-tabs="group"` + children `data-tab="name"`; panels `data-tab-panel="group:name"` | segmented controls, chips, swatches. First `.is-active` wins. **Group names are global — prefix with your route.** Hide non-default panels with `hidden`. |
| `data-open-modal="id"` / `<div class="dialog" data-modal="id" hidden>` / `data-close-modal` | dialogs. Ids are global — prefix with your route. |
| `data-toggle` | flips `aria-pressed` (or `aria-checked` if present) and `.is-on` — switches, toggle chips, icon toggles. |
| `data-toast="text"` | short confirmation after an action. |
| `data-role-only="admin"` / `"member"` | hide for lower roles (member = hidden for guests). Guests never see Cameras or Maintenance; members never see admin tools. |
| `data-action="set-theme" data-value="dark"` / `data-action="toggle-theme"` | theme switches (Profile appearance). The selected `set-theme` key is ink-filled automatically. |
| `data-nav="utility" data-nav-tab="utility-view:water"` | (app.js) navigate, then pick a sub-view — for links that point at Water, a Diagnostics tab, etc. |
| `data-close-modal data-toast="…"` | (app.js) closes the dialog **and** shows the toast — confirm buttons need no screen JS. |

JS (only if needed, `screens/<route>.js`, IIFE): `Proto.go(route)`, `Proto.selectTab(group, name)`, `Proto.toast(msg)`, `Proto.onChange(fn(state, screenEl))`, `Proto.state`, plus `FP.render(el)`.

---

## 11. Content and formatting

- "Now" is **Mon, Nov 9, 2026, 5:00 PM** (Central). Sunrise 6:52 AM, sunset 5:31 PM.
- Dates: `Mon, Nov 9` (weekday when within the week or in lists; add the year only if not 2026). Ranges `Nov 5 – Dec 5` (spaced en dash). Relative: `2 hr ago`, `1 min ago`, `Yesterday, 3:44 PM`, `Sat, 10:10 PM`.
- Times `5:00 PM`, `Noon`, `12 AM`. Money `$114.20`; estimates without cents: `about $114`. Numbers grouped `11,400 gal`. Negative money `−$1.50`. Percent `27%`. Temperatures `71°` (`°F` as a unit in readouts); server temperatures in °F too.
- Units go in `.unit` (mono, graphite): kWh, CCF, gal, °F, %, mph, GB, days.
- Status words: OK, Heads-up, Problem, Info. Roles: Admin, Member, Guest. Sentence case everywhere ("Guest Wi-Fi", "What's new", "Activity log").
- Plain verbs, no jargon on family pages (not "missions", "MAE", "enum", "Backend healthy"). Admin pages may be technical but still use the kit and sentence case.
- People: Bryan (Admin, `--person-bryan`), Mai and Linh (Members), Alex (Guest, active), Jordan (Guest, expired), Danny Tran (pending approval), Kim Nguyen (disabled).
- Canonical household numbers already shown on Home/Utilities — **reuse these exactly** so screens agree:
  - Outside 67°, feels 66°, partly cloudy; tonight low 47°, rain likely 1–9 AM (about 0.6 in); tomorrow high 61°.
  - Inside: Downstairs 71° (70.6), Auto 68–75°, idle, set by schedule 6:00 AM; Upstairs 69° (68.6), Heat to 70°, heating, set by **Mai at 4:56 PM**.
  - Who's home: Bryan home since Sun, 6:12 PM; Mai home since 7:39 AM; Linh away, last seen 3:02 PM; Alex on the guest Wi-Fi since 1:42 PM.
  - Cameras: Driveway battery 27% (heads-up), person 1 min ago; Garage offline since Sun, 4:12 PM; Backyard 87% solar; Living Room wired.
  - Roomba "Rosie": docked, 100%, last clean Sun Nov 8, 1,124 sq ft (Living Room, Kitchen, Hallway, Office).
  - Maintenance: 5 open, next "Replace HVAC air filters" Sun, Nov 15 ($38.97).
  - Electric: yesterday 35.5 kWh vs 32.6 forecast; predicted bill about $114 for Nov 5 – Dec 5 (26 days left); last electric charge $108.39.
  - Gas last bill $37.23 (Oct 7 – Nov 5); Water $110.67 due Tue, Nov 24, 11,400 gal.
  - Alerts, 3 unread: "Usage spike: 35.5 kWh on Sunday" (Heads-up, 8:05 AM, unread), "Rain likely overnight — skip the sprinklers" (Info, 7:00 AM, unread), "Daily report: 35.5 kWh on Sunday" (Info, 7:32 AM), "Rosie finished cleaning 1,124 sq ft" (OK, yesterday 3:44 PM, unread), "Home server storage is 92% full" (Problem, admin only, Sat 10:10 PM), "New water bill: $110.67 due Nov 24" (Info, Fri, Oct 30). (The fixture's "41.2 kWh on Friday" and "$96.42 due Nov 17" conflict with the Utilities data; use the wording above.)
  - Server: drive C: 92% full, 19 GB free of 237 GB. Guest Wi-Fi: network `MapleHouse-Guest`, password `sunny-otter-482`. App version 1.10.1 (build `1a6d07a`).

---

## 12. Accessibility and quality floor

- Touch targets ≥ 44px (kit controls already are; your custom controls must be too).
- Every `<section>` panel has `aria-labelledby` pointing at its title; dialogs `role="dialog" aria-modal="true" aria-labelledby`.
- Icons decorative → `aria-hidden="true"`; lamps that carry meaning → a visible word or `.sr-only` text.
- Charts → `<figcaption class="sr-only">` with the takeaway.
- Focus is visible by default (ink outline) — don't remove it.
- Nothing overflows at 390px: long words wrap, wide tables stack, rows truncate with `.trunc` when needed.

---

## 13. Screen CSS rule

`screens/<route>.css` is **only** for the page's unique element (the instrument and its immediate parts: a thermostat
dial's centre controls, the floor map's rooms, the QR plate, camera scenes, the visitor badge, a presence board) and
its small layout. Every selector starts with `.screen[data-route="<route>"]`. Tokens only — no hex, no rgba. Do not
restyle kit components (no new card, button, badge, list or spacing styles); compose them instead. Look at
`screens/home.css` (hour strip, hour list) and `screens/utility.css` (bill paper) for the expected size and tone.

---

## 14. The instrument for each page (from the concept brief) and the kit pieces to build it

| page | instrument | build it with |
|---|---|---|
| Climate | thermostat dial 60–85°, heat/cool setpoint marks, current temp centre, − / + keys | `data-chart="dial"` (start −135, sweep 270, `segments` + `marks` + `needle` pointer) + `.stepper` under it; mode `.seg--inline`; "who changed it" as a `.person` row |
| Cameras | the live tiles are the instrument | `.media` tiles in `.grid-2` inside `.ip-instrument` (or the `.ip` can hold the tiles full width), REC lamp, mono time |
| Roomba | floor map with live dot + battery ring + one large Clean key | `.map` + `data-chart="ring"` + `.btn--primary.btn--lg.btn--block` in `.ip-body` |
| Maintenance | "next due" odometer counter + overdue lamp; year-spend bar | screen CSS odometer (digits in wells) + `.lamp` + `data-chart="bars"` |
| Guest Wi-Fi | QR on a white label plate, network name stamped under | screen CSS plate with `--plate*` tokens; `.kv` for name/password + `.input-group` Copy |
| People / Who's home / Guest welcome | presence board: one lamp per person | kit `.board` (§7.19b): `.board` 2 × 2 for Who's home, `.board--strip` one row of four for People and the guest lobby |
| Alerts | lamp column; unread counter | `.list` of `.row--compact` with `.row-lead--lamp`, `.row.is-unread`, `.timeline` or day groups; `.count` |
| Profile | appearance switchgear; swatch keys | `.seg` with `data-action="set-theme"` keys (Light/Dark) + Auto; `.swatches` |
| What's new | version counter plate | `.num--xl` in a `.readout` plate + `.badge` New/Improved/Fixed — change kinds are not statuses, so no lamp colour: New = `badge--ink badge--plain` + `sparkles`, Improved = `badge--plain` + `arrow-up`, Fixed = `badge--plain` + `check` |
| Guests | door list with days-remaining gauges | `.list` rows + `.progress` or `data-chart="ring"` per guest |
| Activity log | day ruler timeline | `.timeline` |
| App usage | ranked bar meter | `.meter-row` + `.progress` per tab, or `data-chart="bars"` |
| Server health | six-gauge cluster | six small `data-chart="dial"`/`ring` in `.grid-3` inside the `.ip-instrument` or readouts |
| Diagnostics | 14-day LED matrix + pipeline lamps | `data-chart="heat"` with `data-states` + `.lamps` (CoServ → Sync → Forecast) |
| Sign in / Guest welcome | a single large key / a visitor badge plate | `data-chrome="none"` page; `.btn--primary.btn--lg.btn--block`; plate with `--plate*` tokens |

---

## 15. Before you hand in

- [ ] Build passes with no contract violations; shoot.js reports no overflow and no console errors.
- [ ] You looked at every route, every tab (`--tab`) and every dialog (`--modal`) at phone and desktop, light and dark.
- [ ] The page starts with `.ip` (verdict with lamp + 2–4 readouts); nothing above it but a subject switch.
- [ ] No emoji, no lorem, no literal colours, no `<style>`/`<script>`, no inner scroll areas, no hover-only facts.
- [ ] All `data-tabs` groups and `data-modal` ids are prefixed with your route.
- [ ] Every list has an empty sentence; your area shows at least one error state with Try again where it makes sense.
- [ ] Numbers, names and times agree with §11.
