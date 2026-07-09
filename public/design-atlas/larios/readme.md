# The Lariat · LaRiOS — "Service Ledger" Design System

A design system for **LaRiOS**, the operational cockpit for **The Lariat** — a
historic 1885 music venue and restaurant in Buena Vista, Colorado. LaRiOS is a
hardened, high-density pro tool for kitchen and front-of-house staff running
live service: line checks, 86 boards, inventory par, food-safety logs, labor,
purchasing, and the show/event side of the house.

The visual language synthesizes the **physical heritage of the venue** (exposed
brick, aged wood, wrought iron, burnished copper, amber gaslight) with the
**uncompromising utility of a professional software terminal** — think
"AutoCAD meets a historic Colorado saloon." It is a warm **dark mode** by
default: no pure black (that blooms and strains the eye under low kitchen
light), depth built from 1px hairlines and contrast rather than drop shadows,
tabular figures on every number, and a single warm accent — gaslight amber —
used sparingly for what's live.

> This is a design tool, not the product. It packages the real product's tokens,
> components, and screens so designers and agents can build on-brand LaRiOS
> interfaces (mocks, prototypes, or production references).

## Sources

Everything here is ported from the real product, not reconstructed from memory:

- **GitHub — `sburdges-eng/Lariat`** (https://github.com/sburdges-eng/Lariat)
  The full Lariat repo: a Next.js web cockpit (`app/`, `styles/`), a native
  SwiftUI shell (`LariatNative/`, mirrored in the attached `UI/` codebase), a
  design-atlas (`public/design-atlas/`), and product docs (`docs/`).
  The token system is lifted verbatim from **`styles/tokens.css`** ("LaRiOS —
  Service Ledger token system. SINGLE SOURCE OF TRUTH"); chrome and board
  styles from `styles/globals.css`; component structure from
  `app/_components/*.jsx`; copy rules from `docs/UI_COPY_RULES.md`.
  *Explore this repo further to build higher-fidelity LaRiOS interfaces.*
- **Attached codebase — `UI/`** — the SwiftUI front-end layer (`Boards/`,
  `ViewModels/`, `Components/DesignTokens.swift`). Confirms the same warm
  palette (terracotta/amber, espresso ink, sage/brick status) and the board
  inventory (Temp Log, Cooling, 86, Receiving, Tip Pool, Shows, and dozens more).

### Font note
The three families (**Archivo**, **Inter Tight**, **JetBrains Mono**) are all
Google-hosted and loaded via `@import` in `tokens/fonts.css` (no self-hosted
binaries in the repo). Archivo replaced the original Zilla Slab display face to
read as a utilitarian control panel rather than editorial/marketing type; if you
want self-hosted `.woff2` files instead, drop them in `assets/` and swap the
`@import` for `@font-face`.

---

## CONTENT FUNDAMENTALS — how LaRiOS talks

The governing rule (from `docs/UI_COPY_RULES.md`): **write for a line cook who is
busy, stressed, and not at a desk.** Every screen must be understandable in
under two seconds. Sound like a kitchen manager talking clearly — never a
software company.

- **Kitchen-native, not SaaS.** Use `prep, line, par, 86, fire, hold, open,
  close, count, low, out, ready, done, need, rush, clean, check`. Never use
  `dashboard, submit, configure, inventory management, synchronization,
  initiate, module, validation failed`.
- **Preferred swaps:** dashboard → *home/today*; submit → *save*; inventory →
  *stock*; low inventory → *running low*; complete → *done*; quantity → *count*;
  confirm → *yes/done*; cancel → *go back*; overdue → *late*; assign → *give to*.
- **Reading level ~5th–8th grade.** Short sentences, common words, no multi-clause
  instructions. One main action per screen.
- **Verbs on buttons, always with text labels** (never icon-only for a primary
  action): *Start, Done, Need, Out, Clean, Count, 86 it, Sign off*.
- **Status in plain words:** *Ready, Waiting, Low, Out, Done, Flagged, Late.*
- **Voice / register:** direct, brief, practical. Not corporate, not cheerful,
  not technical — and no editorial flourish. Headings state what the screen is
  ("Today", "Temp log", "Stock on hand"); no motivational kickers or slogans.
  Body and controls stay plain.
- **Casing:** Sentence case for body and buttons; Archivo small-caps for
  section stamps; mono ALL-CAPS wide-tracked for eyebrows and table headers.
- **Person:** second person, implied ("You're clocked in as…", "Pull more before
  rush"). No "the user."
- **Numbers:** always tabular/mono. `86` is a verb and a noun. `°F`, `ppm`,
  `$` and timers all read in JetBrains Mono.
- **Emoji:** none. The brand mark (a lariat loop) and status dots do the
  signaling; unicode arrows (`▲ ▼ →`) are acceptable in trend/meta lines only.

---

## VISUAL FOUNDATIONS

**Overall vibe.** Warm dark, matte, dense, rigid. A control surface hung under a
single amber lamp. Edge-to-edge interlocking panels separated by crisp 1px
lines. Maximum data, minimal chrome, zero flash.

**Color.** A warm-char canvas (`--bg #1a1711` — never pure black) with two panel
surfaces (`--panel`, `--panel-2`) and a machined-steel hairline (`--hair
#3a342a`). Text is parchment/bone (`--text #d4cbb5`) and muted ash
(`--text-muted`). The one warm accent is **gaslight amber** (`--accent #e0922b`)
— used sparingly for active states, selection, focus rings, live progress, and
primary fills. Warm status trio (not the pure system RGBs): **oxblood
`--fire`** (danger / 86 / flagged), **sage `--ok`** (ready / in range), **brass
`--metal`** (warn), plus indigo `--info`. **Burnished copper** (`--copper
#d97736`, deep `#a8501a`, wash `#e9c4b8`) is the accent of "the books" — the
recipe book, BEO worksheets, and order guides — the copper implement against
paper. Three alternate surface scopes flip
the same role tokens: `.paper` (light worksheets; its accent IS copper),
`.k-dark` (expo/wall
mounts), `.k-night` (deep plum stage/event mode). An alternative dark theme,
**Iron** (`.iron` + `.iron-expo`, `tokens/theme-iron.css`), swaps the warm
char/bone Ledger palette for a neutral wrought-iron charcoal (`#151617` /
`#222325` / `#323436` hairlines, parchment `#eae6df` text) with **copper
`#d97736` promoted to the primary accent** — no brown cast, and it ties the
shell to the copper books. Status shifts to muted sage `#5c7a52` / faded
crimson `#b24031`.

**Type.** Three voices. **Archivo** (display) — an engineered grotesque used for
headings, board titles, and small-caps section "stamps", with an amber-color
accent for emphasis (never italic — it reads as a control panel, not a menu).
**Inter Tight**
(sans) — neutral UI: labels, body, controls, nav. **JetBrains Mono** — every
figure, always tabular lining: counts, prices, temps, timers, table headers,
eyebrows. Headings lean on wide tracking and small-caps rather than huge sizes.

**Backgrounds.** No literal wood/brick textures. Instead a very subtle ambient
treatment on the app canvas only: two faint amber/warm radial glows in opposite
corners plus a 1px repeating horizontal scanline at ~10% black — "lamplight and
paper grain," not a gradient wash. Chrome panels get a 4–56px amber bloom
skimming their top lip (lamplight catching an edge), never a glow around the
whole element.

**Borders & depth.** Structure is **1px solid hairlines**, full stop. Depth is
contrast and the border, not shadows. Shadows (`--shadow-1/2/3`) are reserved
strictly for *floating* context — dropdowns, context menus, modals, the LaRi
HUD. No 3D bevels, no inset/outset, no glassmorphism, no `backdrop-filter`.

**Corners.** Sharp. `--radius-sm 3px` (controls, chips, inputs), `--radius 6px`
(cards, panels), `--radius-lg 12px` (large tiles, worksheets). Nothing rounder;
no pills except true status capsules.

**Cards.** A matte `--panel` fill, 1px hairline, `--radius`. Optional Archivo
small-caps header on a hairline baseline. Hover lights the border to amber. No
shadow, no colored left-border-only accents (a status *bar* on the left edge of
a tile is used on compliance boards, but the tile is a full bordered panel, not
a floating card with only a colored edge).

**Buttons / controls.** Compact, uppercase, wide-tracked. Matte fill + 1px
border at rest; hover lights to a crisp amber border (ghost/default) or
brightens the fill (primary); press depresses (`scale(.97)`). Inputs have an
**inset** look — the darker app-bg fill recessed below the panel, hairline that
lights amber on focus, oxblood on invalid.

**Motion.** Quick and functional on `--easing cubic-bezier(.2,.7,.2,1)` (~120–160ms);
`--easing-snap` for the wax-stamp press feedback. The service-strip "now" dot and
the RUSH heat marker pulse slowly; progress rings animate their sweep. No bouncy
UI, no infinite decorative loops on content. All entrance/press motion is gated
behind `prefers-reduced-motion`.

**Hover / press.** Hover = amber border or an 8% amber tint wash (nav);
occasionally a 1px lift. Press = `scale(.95–.98)` or a 1px translate. Focus =
a 2px amber outline, 2px offset (a visible "gaslight ring").

**Imagery.** Minimal. The brand is typographic and iconographic, not
photographic. Where photography appears it should read warm and low-light. No
stock imagery in the tool.

**Layout rules.** Fixed cockpit shell: a 64px top **service strip** (brand +
service-phase timeline + live clock), a 260px left rail (**"The Line"**: brand,
primary nav with mono shortcut keys, live station rings, compliance sections,
cook picker), a scrolling canvas, and a 52px bottom **command bar** (keyboard
hints). High density: reduce padding, right-align all numerics, sticky table
headers with a solid bottom hairline, barely-perceptible zebra striping.

---

## ICONOGRAPHY

LaRiOS deliberately uses **almost no icon set.** There is no Lucide/Heroicons/
Phosphor dependency in the product (verified across the repo). Signaling is
carried by:

- **The brand mark** — `BrandStamp`, a lariat-loop / branding-iron monogram
  drawn in `currentColor` (see `components/brand/`). It appears as the wordmark
  companion, the sidebar/section "wax seal", and the app favicon context.
- **Status dots & rings** — `StatusDot` and the circular `StationRing` (a
  progress sweep with a numeric glyph) do the work most apps hand to icons.
- **Mono glyphs & numbers** — station numbers `1–6`, keyboard `kbd` chips,
  `86`, temperatures, and unicode arrows (`▲ ▼ →`) in trend lines.
- **Two raster brand assets** live in `assets/`: `logo-wordmark.jpg` (the
  "THE LARIAT 1885" wordmark) and `app-icon.png` (a knife crossing a lariat
  loop). Use these as-is; **do not** redraw or approximate the wordmark.
  `public/icon.png` (app root, favicon source) ships `logo-wordmark.jpg`
  as-is; `public/icon-192.png` / `icon-512.png` / `icon-maskable-512.png`
  ship `app-icon.png`.

**If you need line icons** for a new surface, add a geometric, monoline set
(1.5px stroke, squared terminals — Lucide/Radix/Phosphor-outline are the closest
match to the aesthetic) and document the addition here. Never use bubbly or
filled icons, and never emoji.

---

## Index — what's in this system

**Foundations & entry**
- `styles.css` — the one file consumers link (import list only).
- `tokens/` — `colors.css`, `typography.css`, `shape.css`, `spacing.css`,
  `fonts.css`. CSS custom properties + `@import` of the three Google fonts.
- `foundations/*.html` — specimen cards on the Design System tab (Colors, Type,
  Spacing, Brand).
- `assets/` — `logo-wordmark.jpg`, `app-icon.png`, `app-icon-192.png`, `manifest.json`.

**Components** (`components/<group>/`, one card per group on the DS tab)
- `brand/` — **BrandStamp**, **StationRing**
- `core/` — **Button**, **Pill**, **Tag**, **StatusDot**, **Kpi**, **Bar**, **Avatar**
- `forms/` — **Input**, **Select**, **Textarea**, **Field**
- `data/` — **DataTable**, **Tabs**, **Card**

**UI kit** (`ui_kits/`)
- `cockpit/` — an interactive recreation of the Kitchen Cockpit: the shell
  chrome plus Today (rush home), 86 Board, Station line-check, Temp Log, Stock,
  the copper-on-paper Recipe Book, and a BEO worksheet. Entry: `ui_kits/cockpit/index.html`.
- `cockpit-v2/` — a PROPOSAL (not a recreation): a divisions-and-tabs window
  architecture. A slim workspace rail (Line · Floor · Books · Safety · Office ·
  Shows), a per-division board sidebar (⧉ marks boards that open as their own
  windows — KDS/expo, host iPad, box office, printable BEO/order/settlement
  sheets), a tab strip for open boards, and an Iron ↔ Ledger theme toggle.
  All divisions are populated: Prep, Specials, KDS/Expo, Host Stand, Floor Map,
  Reservations, Bar, Order Guide (paper), Cooling, Cleaning, Sanitizer,
  Receiving, Costing, Tip Pool, Breaks & Leave, Sick Leave, Wage Notices,
  Reviews, Staff Certs, Gold Stars, Audit Log,
  Tonight (k-night), Box Office, and Settlement (paper), plus the stage
  manager's Stage Setup (room config + run of show) and Sound (scenes + a live
  SPL meter against the night's limit). Stock lives under
  Office · Stock & buying; People (tip pool, breaks, certs) is its own Office
  cluster — stock and HR intentionally do NOT share a group.
  Entry: `ui_kits/cockpit-v2/index.html`.

**Proposals**
- `ui_kits/cockpit-v2/` — divisions-and-tabs window architecture (see above).
- `ui_kits/altitude/` — **Altitude**, the Rail × Cockpit synthesis and the
  recommended direction. Four altitudes, one gesture: **A0 The Line** (the
  role-aware rail — spine + queue), **A1 Sheet** (quick context), **A2 Board**
  (the full cockpit-v2 board *docked* over the queue with a division › section
  breadcrumb, a "← back to the line · N need you" strip, and 3 recency chips
  instead of tab debt; sheets carry a "Full board ↗" promote), **A3 The Atlas**
  (the map: every division › section › board with a one-line doc, searchable,
  launchable — plus Procedures that launch the actual opening/closing runs and
  PIN-gated house rules). Esc always descends one altitude; ⌘K reaches
  everything. Reuses the cockpit-v2 board screens as-is.
- `ui_kits/concept-rail/` — **Service Rail**, a ground-up UX rethink, now
  role-aware: clock in as **Cook** (procedure runs picked by the clock —
  "Open the line" at 7a, the heat queue at 6p, "Close the line" at 11p, each a
  numbered step run with sheets for line checks / cooling / date marks / side
  work), **Manager** (whole-house heat queue + PIN-gated approvals),
  **Office** (a week spine and a deadline workbench — no rush UI),
  **Booking** (Lauren: a season spine of shows/holds/on-sales and a pipeline
  workbench — offers, announces, playbook), or **Stage** (Steve: a show-day
  tech spine from AVX power-up to curfew strike, with SPL/decibel log,
  soundcheck, scene recall, and AVX sheets). Boards stay
  transient right-side sheets; ⌘K is the only navigation.

**Intentional additions.** None — the component inventory is drawn from the real
product's primitives (`styles/tokens.css` + `app/_components`). No speculative
primitives were invented.

**Also here**
- `SKILL.md` — Agent-Skills-compatible entry point for using this system.
