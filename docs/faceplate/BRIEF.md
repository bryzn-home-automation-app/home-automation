# Concept B — "Faceplate"  (vid: v2)

**Thesis:** the house as a well-made appliance. Think of the front of a good thermostat, a hi-fi receiver, a Braun wall clock: matte
enamel, black lettering, one dial that answers the question, a few small lamps that are only lit when they mean something. Every tab
opens with ONE instrument and a handful of readouts. There is **no accent colour at all** — selection is ink-on-enamel inversion, and
colour appears only as status lamps and chart data. That restraint is the sophistication, and it makes status impossible to misread.

**meta.json:** name "Faceplate", tagline "The house as a well-made instrument", defaultTheme "light",
fontsHref `https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,100..900&family=DM+Mono:wght@400;500&display=swap`

## Tokens

- Light (default): enamel (page) `#E9ECEA`; panel `#F7F8F7`; well (recessed readout) `#DFE3E0`; ink `#15181A`; graphite (secondary text)
  `#4E555A`; hairline `rgba(21,24,26,.14)`; key-selected = ink fill with panel-coloured text.
  Lamps (fills): ok `#22A35A`, heads-up `#E0A100`, problem `#E0483B`, info `#3B82F6`; lamp text (≥4.5:1 on panel): `#127A42`, `#8A5A00`, `#B3261E`, `#1F5FBF`.
- Dark: enamel `#121416`; panel `#1B1E21`; well `#0D0F10`; ink `#EEF1EF`; graphite `#A7AEB3`; hairline `rgba(238,241,239,.14)`;
  lamps `#3DDC84`, `#FFB627`, `#FF6B5E`, `#6FA8FF` (these also pass as text on the dark panel).
- Chart data: primary series = ink; comparison/predicted = graphite, dashed; heat `#D9480F` (dark `#FF8A4C`); cool `#1C7ED6` (dark `#6FB6FF`);
  water `#1098AD`; gas `#B8860B`. Use hue only when two series must be told apart.
- Radius: panel 12, control/key 10, well 8; dials and lamps are circles. **No drop shadows.** Panels are flat with a 1px hairline;
  wells are recessed with a 1px inner shadow; a pressed/selected key is ink-filled.
- Type: **Archivo** variable for everything, using its width axis as the system:
  silk-screen label — 11.5px, uppercase, `font-stretch: 112%`, weight 600, letter-spacing .08em (this is the ONLY place uppercase is used);
  page title — 22/600, stretch 100% (28 desktop); section title 16/600; body 15/400; readout numerals — weight 500, stretch 88%, tabular,
  sizes 44 (instrument centre) / 28 (readout) / 18 (inline).
  **DM Mono** for units beside numerals, timestamps, IDs and the clock.

## Shell

- **Desktop:** a 48px top strip across the whole width: wordmark "HOMEOS" (silk-screen style) left; date and time in DM Mono centre;
  right: a lamp cluster — "House ● OK", "Alerts ● 3" (links to Alerts) — and the avatar. Left **key column** (96px): square keys with a
  stroke icon over a short label for the Everyday pages; a hairline; House keys; You keys; Admin keys (admin only) under a small
  silk-screen "ADMIN" label. The selected key is ink-filled. Content max-width 1240px.
- **Phone:** top strip with the page title (silk-screen caps), Alerts lamp + count, avatar. Bottom **key row**: Home, Utilities, Climate,
  Cameras, Roomba, More — the selected key ink-filled. "More" opens a bottom sheet keypad (`data-modal`): a 3-column grid of keys for
  House / You / Admin, then theme (Light · Dark) as a two-position switch and Sign out.

## Page skeleton as drawn in this concept: the instrument panel

The first panel of every page is split: **the instrument** (left ~40% on desktop; on phone it sits on top, max 240px tall) and beside
it the **verdict line** (one plain sentence with a lamp) and 3–4 **readout wells** (silk-screen label, numeral, unit in mono, one-line
context). Then the mode switch (segmented control drawn as a row of keys), then flat panels. Technical detail sits behind a
"Show details" disclosure key.

The instrument is the page's unique element — one per tab, all drawn in the same line style (1.5px strokes, tick marks, a needle or a
filled arc, mono numerals at the centre):

| page | instrument |
|---|---|
| Home | 24-hour ring: daylight arc from sunrise to sunset, a needle at now (5:00 PM), outdoor temperature at the centre; lamps for each system |
| Utilities · Electric | billing-cycle ring: progress through Nov 5–Dec 5 with the predicted bill ($114) at the centre and last bill as a tick |
| Utilities · Gas | a two-part bar-dial: fixed charges vs usage share of the last bill |
| Utilities · Water | bill dial with the due date; five-segment ring of the charge breakdown |
| Climate | the thermostat dial: 60–85° arc, heat and cool setpoint markers, current temperature at the centre, − / + keys |
| Cameras | the live tiles ARE the instrument: viewfinder corner marks, a REC lamp, mono timestamp overlay |
| Roomba | the floor map as the instrument, with a battery ring beside it and one large CLEAN key |
| Maintenance | a "next due" odometer-style counter + overdue lamp; year-spend bar |
| Guest Wi-Fi | the QR code on a white plate, mounted like a label plate with the network name stamped under it |
| People | a presence board: one lamp per person (home / away / online) |
| Alerts | a lamp column: each alert row starts with its severity lamp; unread count as a counter |
| Profile | appearance switchgear: Light/Dark/Auto as a three-position switch; palette as swatch keys |
| What's new | version counter plate (v1.10.1) |
| Who's home | presence board (large) |
| Guests | door list with days-remaining gauges |
| Activity log | day ruler timeline |
| App usage | ranked bar meter |
| Server health | six-gauge cluster (processor, memory, drive, temperature, network, uptime) |
| Diagnostics | 14-day data-coverage strip as an LED matrix (oldest left, today right) + pipeline lamps: CoServ → Sync → Forecast |
| Sign in | a single large key "Sign in with Home" on a bare faceplate |
| Guest welcome | a visitor badge plate (name, colour) |

## Signature

The dial + the lamps + the silk-screen labels, and the discipline of zero accent colour. Motion: the needle/arc sweeps to its value
when a page opens (one orchestrated moment, 500ms, none under reduced motion). Keys depress 1px on press.

## Tone

Calm, exact, quietly premium. Fewer words than the other concepts; labels do the work. Do not let it become a "dark hacker dashboard" —
the default is the light enamel faceplate, and dark is the same object in a dim room.
