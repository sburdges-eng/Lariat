# BOH ops packet on a phone — `/boh`

Date: 2026-07-26
Status: implemented. See "What changed during implementation" at the end.

## Problem

The BOH ops packet exists twice: as markdown in `docs/boh/*.md` and as a letter-size print
edition in `docs/boh/print/lariat-ops-packet.html` (plus its PDF). Both are paper. A cook
standing on the line with a phone has no way to pull up their station SOP, and a manager
counting the walk-in has to carry a clipboard.

This adds `/boh` — the same 12 sheets, shaped for a phone, inside the app.

## Non-goals

- Not replacing the paper packet. Print stays; this is the phone copy of the same thing.
- Not a HACCP record. Temps, cooling, and date marks stay in `/food-safety`.
- Not regenerating the print HTML from the new data module. That is a clean follow-up
  (see "Known drift" below) but would churn committed PDFs for no gain this pass.

## The 12 sheets

| # | Slug | Sheet | Tier |
|---|------|-------|------|
| 1 | `dinner-day-plan` | Dinner day plan — Wed–Sat | cook |
| 2 | `sunday-day-plan` | Sunday day plan — brunch | cook |
| 3 | `deep-clean` | Deep-clean & maintenance rotation | cook |
| 4 | `prep-par` | Prep / par sheet — daily | cook |
| 5 | `sysco-count` | Sysco order guide — count sheet | **manager** |
| 6 | `purveyor-planner` | Purveyor planner — orders, deliveries, calls | **manager** |
| 7 | `manager-week` | Manager weekly routine | **manager** |
| 8 | `eod-log` | EOD manager log | **manager** |
| 9 | `sop-grille` | Station SOP — Grille / Sauté | cook |
| 10 | `sop-fry-garde` | Station SOP — Fry & Garde | cook |
| 11 | `sop-expo-dish` | Station SOP — Expo & Dish pit | cook |
| 12 | `recipe-index` | Recipe book index | cook |

The combined cross-vendor order guide (`docs/boh/order-guide-combined.md`) is **not** one of
the packet's 12 and is out of scope here.

## Architecture

```
scripts/build-boh-sheets.mjs     generator: packet HTML -> typed sheet data
lib/boh/types.ts                 hand-written block/sheet types
lib/boh/sheets.generated.ts      generated, committed
lib/boh/index.ts                 lookup helpers, tier split
app/boh/page.jsx                 server hub — 12 tiles
app/boh/[sheet]/page.jsx         server — resolve slug, 404 on miss
app/boh/[sheet]/SheetBoard.jsx   'use client' — checks, entries, copy, reset
```

### Why generate instead of hand-write

The sheets carry roughly 400 rows of real operating numbers — Sysco pack sizes, weekly usage
rates, par levels, brine and thaw lead times. Retyping those into TypeScript has a non-trivial
error rate, and an error here is not a rendering bug: it is a wrong order quantity or a wrong
brine time in a cook's hand. AGENTS.md rule 4 (do not silently corrupt regulated ops data) and
rule 6 (test with real data) both point the same way.

So `scripts/build-boh-sheets.mjs` parses the packet HTML with `jsdom` and emits typed data, and
`tests/js/test-boh-sheets.mjs` asserts the generated data still matches the packet — every row's
text present, per-sheet row counts equal. Transcription becomes a verified step instead of a
trusted one.

`jsdom` moves from a transitive dependency (via `jest-environment-jsdom`) to an explicit
devDependency, because a build script is now importing it directly.

### Block model

Presentation HTML is parsed down to six semantic blocks. Everything in the packet maps to one:

| Block | Source shape | Interactive |
|-------|--------------|-------------|
| `heading` | `<h2>` / `<h3>` section break | no |
| `note` | `<p>` body copy | no |
| `callout` | `p.rules` emphasized box | no |
| `tasks` | table with a `✓` column | tap to check |
| `count` | table with `Have` / `Order` / `On hand` / `Make` columns | number entry |
| `grid` | any other table (rotation, score, contacts) | no |

Each interactive row carries a stable id derived from sheet slug + section + row index, so saved
state survives a re-render but is intentionally invalidated if the packet's rows change.

## State

Checks and entries persist to `localStorage` under `lariat.boh.<slug>.<serviceDate>`. Service
date comes from `todayISO()`, so a sheet opened the next morning starts clean without the cook
doing anything.

Two actions on every sheet:

- **Start new sheet** — clears saved entries for that sheet and date, with a confirm step.
- **Copy sheet** — serializes the filled sheet to plain text for pasting into the handoff board.

This is a working sheet, not a record. It is device-local, has no audit trail, and is not
readable by anyone else. Every sheet header says so in one line and links to `/food-safety` for
anything that has to be logged. No HACCP data path touches `localStorage`.

## PIN gate

Four of the twelve carry cost, vendor, or sign-off data and go behind the manager PIN. The other
eight are the cook's own line paper and stay open, matching how `/prep` and `/stations` are open
while `/morning` is gated.

Middleware matches on path prefixes, so each manager sheet is listed explicitly in
`SENSITIVE_PREFIXES` and `config.matcher`, and mirrored into `MANAGER_PIN_PREFIXES` in
`navRegistry.js`.

The failure mode that matters is adding a 13th manager sheet later and forgetting the middleware
entry. `tests/js/test-boh-pin-coverage.mjs` closes it: for every sheet whose tier is `manager`,
assert its path is covered by a middleware prefix, and assert no `cook` sheet is. The tier in the
data module becomes the single source of truth and the gate is derived from it, in the same
spirit as the existing `test-pin-gate-coverage.mjs`.

## i18n

Chrome — buttons, headings, status words, the "not a record" line — goes through `t()` / `useT()`
with matching `en` and `es` keys, per the existing cook-surface pattern.

Sheet body content renders verbatim from the data module and is **not** translated. This is the
same line the app already draws for database content (`Boards.i18n.test.jsx`: "DB data renders
verbatim — never translated"). Machine-translating pack sizes, brine times, and technique into
Spanish would put wrong numbers and wrong method in a cook's hand; a real translation of the
packet is a content project for a bilingual chef, not a code change.

## Copy rules

All chrome follows `docs/UI_COPY_RULES.md`: kitchen verbs, short labels, no SaaS words. "Start
new sheet" not "Reset form". "Copy sheet" not "Export". The i18n catalog test enforces the banned
word list on every key added here.

## Testing

| Gate | Covers |
|------|--------|
| `tests/js/test-boh-sheets.mjs` | generated data matches the packet HTML; 12 sheets; unique slugs; stable ids; no underscores in labels |
| `tests/js/test-boh-pin-coverage.mjs` | every manager sheet gated, no cook sheet gated |
| `app/boh/__tests__/SheetBoard.test.jsx` | check toggles, entries persist, reset clears, copy output shape |
| `npm run verify` | typecheck, unit, rules, i18n, build |

## Known drift

`docs/boh/*.md`, the print HTML, and the app now describe the same sheets from two sources: the
markdown is hand-authored, and both the print HTML and the app data derive from the packet. The
packet HTML is the effective source of truth for the app. Making the print edition render from
`lib/boh/` too would collapse this to one source and is the recommended follow-up.

## What changed during implementation

Four things came out differently than the design above, all deliberate:

**Four manager sheets, not five.** The combined cross-vendor order guide named during scoping is
in `docs/boh/order-guide-combined.md` but was never one of the packet's 12 pages, so the manager
tier is Sysco count, purveyor planner, manager week, and EOD log.

**No database access at all.** The sheet route first read `todayISO()` from `lib/db`, which drags
the whole native SQLite module into a route that needs no data. Worse, `todayISO()` is a UTC date
slice, and UTC rolls over at 6pm Mountain — a cook's dinner day plan would have blanked itself
mid-service. Replaced with `serviceDateISO()` in `lib/boh`, which uses the venue's local day. The
line book now has zero database coupling, so it still opens when SQLite is unhealthy — which is
the right property for reference paper.

**Grid cells keep printed hints.** The round-trip test caught the weekly score grid's `/3`
denominators being discarded when those cells became input boxes. `GridCell` gained an optional
`hint` so the box takes the number and `/3` stays beside it.

**Text field height follows the app, not this surface.** `styles/ux-polish.css` sets a 40px
minimum on `.main input` with specificity no scoped rule here can beat. The tick rows — the
targets that need size — are 48px. Raising the app-wide field floor to 44px is a separate call
and was left alone.

### Known limitations

- Tick boxes printed *inside prose* (for example "Order placed: ☐ Sun ☐ Wed" on the count sheet)
  render as static text. Only boxes in table cells and SOP steps are tappable. The per-sheet
  notes box covers the gap.
- The deep-clean rotation is a five-column grid that scrolls sideways on a phone. Faithful to the
  paper, but pivoting it to one card per day would read better on a phone.
