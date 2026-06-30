# Service Ledger — Phase 2: Surface Migration (full semantic re-tokenize)

- **Date:** 2026-06-30
- **Branch:** `feat/service-ledger-phase2` (worktree off `origin/main` @ `a79faa0`)
- **Predecessor:** [`2026-06-28-lariat-service-ledger-design.md`](./2026-06-28-lariat-service-ledger-design.md) (Phase 1, merged via #372)
- **Status:** Design — awaiting user review before plan

## Problem

Phase 1 unified Lariat's design tokens into a single role-token layer in
`styles/tokens.css`: role tokens (`--bg`, `--text`, `--text-muted`, `--accent`,
`--panel`, `--panel-2`, `--hair`, `--fire`, `--ok`, `--info`, `--metal`, …) carry
literal hex and **flip** inside `.paper` (light document surface), `.k-night`, and
`.k-dark`. Legacy spec-palette aliases (`--char`, `--ink`, `--bone`, `--muted`,
`--ember`, `--ember-deep`, `--paper`, `--cream`, …) are declared **only in `:root`**
and alias onto role tokens so un-swept surfaces keep working.

The catch, documented in `tokens.css`: **legacy aliases do not re-resolve inside
flipped contexts** (CSS custom-property inheritance — an alias defined only in
`:root` keeps its `:root` value inside `.paper`). So any consumer that references a
legacy alias renders with the *dark* value even on a *light* `.paper` surface. Phase 1
chose to re-tokenize consumers onto role tokens rather than redeclare aliases in
`.paper`. Phase 2 finishes that migration.

A second, related defect class: **role misuse** — a consumer that uses a
*background-role* alias (e.g. `--char` = `--bg`) as a *text* color, producing
dark-on-dark even in the default theme. The Phase-2 kickoff commit (`eabdf25`) already
fixed one such case: `.cookbook-lede` was `color: var(--char)` (a charcoal that
collapsed into the dark background, leaving the deck line nearly invisible) → now
`var(--text-muted)`.

## Goal

Re-tokenize **every** legacy color-alias consumer onto the **semantically correct
role token for that element's purpose**, so every surface renders correctly in dark
default, `.paper`, and `.k-night`. This is a *full semantic* pass (not a mechanical
alias→definition swap): each usage is judged by intent —

| Element intent | Target role token |
|---|---|
| primary text | `--text` |
| secondary / muted text | `--text-muted` |
| card / surface fill | `--panel` |
| raised surface fill | `--panel-2` |
| app background | `--bg` |
| border / hairline | `--hair` |
| accent / interactive | `--accent` (+ `--on-accent` for text on accent) |
| signal colors | `--fire` / `--ok` / `--info` / `--metal` / `--allergen` |

Mechanical swaps (alias → its exact definition) are the safe default where intent
already matches the definition; misuse is corrected to the right role.

### Explicitly out of scope (deferred to a later phase)

- **Capstone / alias retirement.** We do **not** delete the legacy alias definitions
  from `tokens.css`, and we do **not** add a guard test forbidding alias references.
  The alias layer stays as a safety net; retirement + the forcing-function guard are a
  separate later phase.
- The deferred Phase-2 backlog items in `.superpowers/sdd/progress.md` (non-rush
  `--red/--green/--yellow`, `*-form button` `#111`→`--on-accent`, `.alert-red`, PWA
  manifest `theme_color` `#c85a2a`, widening the raw-hex lint) are tracked separately
  and not part of this migration unless they fall naturally inside a swept namespace.
- Increment-2 follow-ups (negative-margin "underwater" display, `@media print`
  source-test) — handled in their own cycle after this spec is approved.

## Scope

207 legacy color-alias **consumer** usages across three stylesheets:

| File | Consumer usages | Notes |
|---|---:|---|
| `styles/globals.css` | 157 | the bulk; ~30+ namespaces; **active concurrent edits** |
| `styles/cookbook.css` | 39 | isolated; `.cookbook-*`; lede already fixed |
| `styles/estimate.css` | 11 | isolated; `.ed-*` / `.estimate-*` |

`styles/tokens.css` (40 alias references) holds the alias **definitions** — not in
scope (retired in the deferred capstone phase). `styles/ux-polish.css` has no color
aliases.

### Namespace inventory (globals.css, by selector volume)

`.beo` · `.rush` · `.gs` (gold-stars) · `.tl` (temp-log) · `.cooling` · `.fs`
(food-safety hub) · `.cmdk` (command palette, global) · `.sani` · `.sick` · `.lari`
(assistant, global) · `.pr`/`.preshift` · `.nav`/`.sidebar` (global chrome) ·
`.datemark` · `.cert` · `.station` · `.breaks` · `.recipe` · `.install` ·
`.editorial` · `.command` · plus shared primitives (`.btn`, `.card`, `.chip`,
`.alert`, `.status`, `.section`, `.mark`). The plan enumerates the exact per-namespace
usage list.

## Approach

**File-by-file, namespace-batched, route-verified.** Chosen over parallel
per-namespace subagents because full semantic judgment + visual review need
consistency and a single reviewing eye; subagents may be reserved for the mechanical
tail of `globals.css` if it runs long.

### Order

1. **`cookbook.css`** (39, isolated, partly started)
2. **`estimate.css`** (11, isolated)
3. **`globals.css`** (157) — **last**, because it is both the largest file and the one
   a concurrent session is actively editing (an a11y `aria-label` + `-webkit-` prefix
   sweep, uncommitted in the main checkout). Doing it last lets that sweep land first,
   minimizing rebase conflict — they touch `user-select`/`backdrop-filter`/markup
   lines; we touch `color:`/`background:`/`border-color:` lines, so overlap is small.

### Per-namespace workflow

For each namespace within a file:
1. List its alias usages.
2. Re-tokenize each onto the semantically-correct role token (table above);
   correct any role misuse.
3. Run the contrast gate (`tests/js/test-design-tokens-contrast.mjs`).
4. Screenshot the route(s) that render the namespace (map below), before/after,
   and visually confirm: no regression in dark default; correct flip in `.paper`/
   `.k-night` where applicable.
5. Commit the namespace (or a small namespace batch) with a conventional message.

### Route → namespace verification map (skeleton; plan finalizes)

| Route(s) | Namespaces exercised |
|---|---|
| `/` | `.rush`, `.station`, `.tl`, global `.nav`/`.sidebar`/`.cmdk`/`.lari` |
| `/recipes` | `.cookbook-*`, `.recipe` |
| `/beo`, `/beo/[id]/estimate`, `/beo/share/[token]` | `.beo`, `.ed-*`/`.estimate-*`, `.paper` surface |
| `/food-safety` + subpages (`/cooling`, `/sanitizer`, `/sick-worker`, `/date-marks`, `/calibrations`, …) | `.fs`, `.cooling`, `.sani`, `.sick`, `.datemark`, `.cert` |
| `/gold-stars` | `.gs` |
| `/command` | `.command` |
| `/install` | `.install` |
| `/eighty-six` | `.alert`, `.status`, signal colors |

~12–15 routes cover essentially every namespace. The run-lariat driver (`--seed`)
provides a populated `/` and a real `.paper` BEO share sheet without touching the real
DB.

## Correctness & regression safety

- **Provable dark-theme baseline.** Because each alias is *defined as* a role token,
  a straight swap renders byte-identical in the default `:root` theme. Only
  flip-context surfaces and corrected misuse change appearance — and those are fixes.
- **Contrast gate** stays green for token definitions (text/bg ≥ 7:1, accents on
  `--panel` ≥ 4.5:1, `.paper` accents ≥ 4.5:1).
- **Route screenshots** are the per-namespace visual proof.
- No new raw hex is introduced in consumers (every replacement is a `var(--role)`).

## Risks & mitigations

| Risk | Mitigation |
|---|---|
| `globals.css` merge conflict with concurrent sweep | Do it last; MACP-claim; rebase on latest `main` before integrating; conflicts are line-disjoint (prefix/markup vs color) |
| Semantic misjudgment changes a color subtly | Route before/after screenshots per namespace; dark baseline is provably unchanged for straight swaps |
| Scope creep into the deferred backlog | Backlog items explicitly out of scope unless inside a swept namespace |
| Large size / partial completion | Decomposed per-file then per-namespace; each namespace is an independently shippable commit |

## Decomposition (for writing-plans)

This spec is one coherent migration but a multi-task program. The plan should produce
ordered tasks roughly:

1. `cookbook.css` namespaces (`.cookbook-*`) — finish the file.
2. `estimate.css` namespaces (`.ed-*`/`.estimate-*`).
3. `globals.css` — grouped namespace batches (`.beo`, `.rush`, `.gs`, `.fs`-family,
   `.cooling`/`.sani`/`.sick`/`.datemark`/`.cert`, global chrome `.nav`/`.cmdk`/
   `.lari`, primitives), each verified against its route(s), `globals.css` started only
   after a rebase on the latest `main`.

Each task: re-tokenize → contrast gate → route screenshot → commit. No alias deletion,
no guard test (deferred).
