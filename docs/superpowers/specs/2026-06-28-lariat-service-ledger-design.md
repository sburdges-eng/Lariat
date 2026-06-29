# Spec — Lariat "Service Ledger" design language (dark-primary)

Date: 2026-06-28
Status: draft (awaiting review)
Skill lineage: frontend-design → spec-plan-tdd

## Goal

Re-identity the Lariat platform from its current generic warm-paper/serif/terracotta look (which
sits on the AI-default cluster) into a distinctive, unmistakably-Lariat **"Service Ledger"** — an
after-dark, lamp-lit kitchen/venue ledger. Modern operational bones (fast, legible, touch,
accessible) carrying an 1885 letterpress-ledger identity. The change is delivered primarily at
the **token layer** (`styles/tokens.css`), which is shared by v1 and the v2/LaRiOS shell, so a
single rebase re-skins ~90 surfaces; per-surface CSS namespaces are then swept against it.

## Non-goals (this round)

- Re-architecting information architecture / navigation (the v2/LaRiOS lane work owns that).
- Rewriting page logic or data flows. This is presentation only.
- Redesigning all ~90 surfaces now. Phase 1 ships the language + core primitives + ONE flagship
  reference surface; remaining surfaces are Phase 2+ (looped against the locked system).
- New fonts beyond one display-face swap. Body (Inter Tight) and data (JetBrains Mono) stay.

## The direction (frontend-design "design plan")

**Concept.** The primary surface is a warm, lamp-lit char-black — the line/venue after the lights
drop for service. Information is kept like a ledger: ruled rows, stamped section headers, tabular
figures. **Bone-paper is demoted to a "document" surface** used only where something is read or
signed like a printed sheet (BEO client sheet, reports, HACCP plan). One warm working light
(gaslight amber); oxblood is fire/alert; brass is the rare metal; sage is calm/done.

**The justified risk** (per frontend-design, one real risk): make the whole app dark-primary for a
domain that conventionally uses bright dashboards. Justified because Lariat is also an
entertainment venue (shows/tonight/booking), the KDS/expo context is already dark, and a lamp-lit
ledger is far more distinctive — and more "venue at night" — than another bright SaaS grid.
Legibility risk is mitigated by high-contrast bone-on-char text and a dedicated bright `.paper`
surface for document-reading tasks.

### Palette (named hex — the token rebase)

Dark "service" stack (new `:root` default):
- `--char  #14130f` — primary background (warm char-black; warmer than today's cold `#0e0d0b`)
- `--panel #1d1b15` — raised panel / card
- `--panel-2 #26231b` — secondary raised / hover
- `--hair  #3a342a` — hairline rules on dark
- `--bone  #ece3d0` — primary text (warm bone — inverted ledger ink)
- `--bone-2 #b3a890` — muted text

Accents (tuned to read on `--char`):
- `--amber  #e0922b` — gaslight: the primary working accent (active/focus/links/"live")
- `--fire   #d2492f` — oxblood-leaning fire/alert (86, over-temp, errors)
- `--brass  #c2912f` — rare metal: awards, premium, rare highlight
- `--sage   #7aa07f` — ok / done / calm
- `--indigo #5b82a8` — structure / secondary / info

Document sub-surface (`.paper` class — demoted print surface):
- `--paper-bg #f1ead9`, `--paper-ink #17140f`, `--paper-hair #cabd9f`

> Critique vs AI defaults: this is neither cluster #1 (cream + serif + terracotta) nor cluster #2
> (near-black + single acid pop) — it is a warm, multi-hue *ledger* palette on warm char, with the
> accent being a soft gaslight amber, not an acid green/vermilion. The fire/brass/sage/indigo set
> is a working signal system, not decoration.

### Typography (3 roles; one swap)

- **Display `--display`** — **retire Instrument Serif** (the AI-default display serif) for a period
  **Egyptian slab** (Clarendon lineage = the authentic 1885 display/wood-type register). Proposed:
  **Zilla Slab** (700/Bold), used with restraint — wordmark, section stamps, and hero figures ONLY.
- **Body `--sans`** — keep **Inter Tight** (the modern operational workhorse; legible on dark).
- **Data `--mono`** — keep **JetBrains Mono** with `tnum` (ledger figures; alignment is functional
  AND on-theme). Numbers stay tabular everywhere.

### Structure & signature (frontend-design "structure is information")

- **Ledger rows + branding-iron section stamps.** Section headers = a small brand glyph + a Zilla
  Slab small-caps label + a ruled underline. Data tables get ruled-row treatment; figures align.
- **Lamp-lit panels.** Panels are warm char with a faint top-edge amber bloom (lamplight on paper);
  live/fire states get an amber/oxblood glow (generalize the existing `--lari-glow`).
- **Signature element (the one memorable thing): the Lariat brand-stamp** — a single
  cattle-brand/lariat-loop monogram that is the wordmark AND the section-header stamp, and
  "presses"/cinches once on a confirm action. Everything else stays quiet.
- Radius stays small (period print): keep `--radius-sm 3px / --radius 6px`.

### Motion

Restrained: brand-stamp press on confirm; amber glow fade on live/fire; reuse `--easing`. Full
`prefers-reduced-motion` support (no non-essential motion when set).

### Theme architecture (the structural change)

- `:root` becomes the **Service Ledger dark** default (inverts today's light-default + `.k-dark`).
- `.paper` (new) = the bright document surface (bone bg + ink) for BEO sheets / reports / print /
  signable pages.
- `.k-night` (plum) retained for stage/signage, re-based on the new tokens.
- Net: today's `.k-dark` rules largely become the default; today's `:root` light becomes `.paper`.

## Invariants (binding; some are testable = the "TDD" surface)

1. **Contrast floor (testable).** `--bone` on `--char` ≥ 7:1 (AAA body). Every accent used as text
   ≥ 4.5:1 on its background; as a non-text UI indicator ≥ 3:1. A unit test computes WCAG ratios
   from the token values and fails the build if any pairing regresses.
2. **Keyboard focus always visible** — an amber focus ring on every interactive element.
3. **`prefers-reduced-motion` respected** — signature motion gated behind the media query.
4. **No hard-coded colors in components** — surfaces/components reference tokens, never raw hex, so
   the rebase actually propagates. A lint/grep check flags raw-hex regressions in swept files.
5. **Tabular figures for all numeric/ledger data** (`font-variant-numeric: tabular-nums`).
6. **Existing component tests stay green** — the redesign is presentation; no test asserting
   behavior may break (visual class changes only).
7. **`.paper` round-trips** — document surfaces remain legible and print-correct.

## Verification approach (hybrid — design isn't pure red-green TDD)

- **Testable, test-first:** the contrast-ratio checker (invariant 1), a focus-visible assertion in
  the reference page's component test, a raw-hex lint over swept files.
- **Visual:** screenshots of the flagship surface in the new language via the `/run` skill;
  self-critique pass per frontend-design (remove one accessory).
- **Regression:** the existing jest/node suites stay green.

## Flagship reference surface (Phase 1) — OPEN QUESTION

Build ONE surface fully in the new language to prove it before propagating. Candidates:
- **`/` Today / rush board** (RECOMMENDED) — highest-traffic cook surface; proves the dark-default
  works for *dense operational data* (the hardest, most important case).
- **`/shows/tonight` Tonight · Live** — best *showcases* the after-dark venue feel, lower density.

Proposed: Today (hardest case first). Confirm or override at review.

## Phase plan (full task list in the PLAN doc)

- **Phase 1 (keystone):** rebase `styles/tokens.css` to Service Ledger dark-default + `.paper`;
  update core primitives in `tokens.css`/`globals.css` (`.app` chrome: strip/sidebar/command;
  `.btn`/`.pill`/`.card`/`.surface`/`.kpi`/`.nav`; tables) to read on dark; swap display font; add
  the brand-stamp signature; build the flagship surface; wire the contrast checker + a11y tests.
- **Phase 2+:** loop the per-surface namespaces (`.beo-*`, `.rush-*`, `.fs-*`, `.cooling-*`,
  `.recipe-*`, cookbook, v2 shell) against the locked system, one namespace per task, each
  screenshot-verified. This is where `/loop` applies — against a frozen Phase-1 token system.

## Open questions (proposed defaults)

1. Flagship surface = Today (vs Tonight). **Proposed: Today.**
2. Display face = Zilla Slab. **Proposed: yes** (refine visually during build; alt: a condensed
   "playbill" face if Zilla reads too soft on dark).
3. Keep `.k-night` plum as a third mode, or fold stage/signage into the default dark? **Proposed:
   keep it, re-based.**
