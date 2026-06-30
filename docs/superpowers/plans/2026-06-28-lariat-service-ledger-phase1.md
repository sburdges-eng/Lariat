# Lariat "Service Ledger" — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development (per-task implementer + reviewer). Steps use `- [ ]`. Design tasks are screenshot-verified; testable invariants are test-first.

**Goal:** Re-skin Lariat to the dark-primary "Service Ledger" identity at the token layer, update core primitives + app chrome to read on dark, swap the display face, add the brand-stamp signature, and rebuild the `/` (Today) rush board fully in the new language — proving the system before Phase 2 propagation.

**Architecture:** Introduce a **semantic role-token layer** (`--bg/--panel/--text/--accent/--fire/--ok/--info/--metal/--hair`) as the contract; the dark default and a `.paper` document surface each define the roles. Legacy names (`--ember/--red/--green/--yellow/--bone/--cream/…` across both `tokens.css` and `globals.css`) are aliased onto roles so the sweep is incremental and back-compatible.

**Tech Stack:** Plain global CSS (no framework), CSS custom properties, Next.js app-router server/client components, jest + node:test for the testable invariants, `/run` skill for screenshots.

## Global Constraints (binding; from the spec)

- Dark-primary default (`:root` = Service Ledger dark); `.paper` = bright document surface; `.k-night` retained, re-based.
- **Contrast floor (TESTABLE):** `--text` on `--bg` ≥ 7:1; any accent-as-text ≥ 4.5:1 on its surface; accent-as-UI ≥ 3:1.
- Keyboard focus always visible (amber ring); `prefers-reduced-motion` respected.
- No NEW hard-coded hex in swept files — reference role tokens. Raw-hex lint guards regressions.
- Tabular figures for all numeric data.
- Existing jest/node component tests stay green (presentation-only change).
- Display face (Zilla Slab) used with restraint: wordmark + section stamps + hero figures only. Body = Inter Tight, data = JetBrains Mono.
- One source of truth for tokens after T1 (no competing `:root` blocks).

---

### Task 1: Unify + rebase the token system to Service Ledger dark

**Files:**
- Modify: `styles/tokens.css` (becomes the single token source; `:root` = dark default; add `.paper`; re-base `.k-night`)
- Modify: `styles/globals.css` (remove its competing `:root` token block; alias any names it owned onto the role tokens)
- Create: `tests/js/test-design-tokens-contrast.mjs`

**Interfaces (the role tokens later tasks consume):**
```
--bg --panel --panel-2 --hair --text --text-muted
--accent (gaslight amber)  --fire (oxblood)  --ok (sage)  --info (indigo)  --metal (brass)
--display --sans --mono --radius-sm --radius --easing
```
Legacy aliases (so existing markup keeps working): `--ember→--accent`, `--rust/--red→--fire`, `--sage/--green→--ok`, `--brass/--yellow→--metal`, `--indigo/--blue→--info`, `--ink→--text`, `--bone/--cream/--paper→` dark surfaces, `--accent` (globals) `→--accent`.

- [ ] **Step 1 — Write the failing contrast test.**
```js
// computes WCAG 2.1 contrast from the resolved token hexes and asserts the floors
import { test } from 'node:test'; import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const css = readFileSync(new URL('../../styles/tokens.css', import.meta.url), 'utf8');
const tok = (n) => (css.match(new RegExp(`--${n}\\s*:\\s*(#[0-9a-fA-F]{6})`))||[])[1];
function L(hex){const c=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255)
  .map(v=>v<=.03928?v/12.92:((v+.055)/1.055)**2.4);return .2126*c[0]+.7152*c[1]+.0722*c[2];}
const ratio=(a,b)=>{const l1=L(a),l2=L(b);return (Math.max(l1,l2)+.05)/(Math.min(l1,l2)+.05);};
test('text on bg ≥ 7:1', () => assert.ok(ratio(tok('text'),tok('bg'))>=7, `got ${ratio(tok('text'),tok('bg')).toFixed(2)}`));
for (const a of ['accent','fire','ok','info','metal'])
  test(`${a} on panel ≥ 4.5:1`, () => assert.ok(ratio(tok(a),tok('panel'))>=4.5, `${a}=${ratio(tok(a),tok('panel')).toFixed(2)}`));
```
- [ ] **Step 2 — Run, confirm FAIL** (role tokens don't exist yet). `node --test tests/js/test-design-tokens-contrast.mjs`
- [ ] **Step 3 — Implement the rebase.** In `tokens.css` `:root`: define the role tokens to the spec's Service Ledger dark values (`--bg #14130f`, `--panel #1d1b15`, `--panel-2 #26231b`, `--hair #3a342a`, `--text #ece3d0`, `--text-muted #b3a890`, `--accent #e0922b`, `--fire #d2492f`, `--ok #7aa07f`, `--info #5b82a8`, `--metal #c2912f`); add every legacy alias above. Add `.paper{ --bg:#f1ead9; --panel:#f8f3e7; --text:#17140f; --hair:#cabd9f; … }`. Re-base `.k-night` on the role tokens. **Tune any accent that fails the test** until all pass (e.g. lighten `--ok`/`--info` until ≥4.5:1). Remove the `:root` token block from `globals.css` (lines ~18-50) and replace any globals-only names with aliases in `tokens.css`.
- [ ] **Step 4 — Run, confirm PASS** + `npm run build` (CSS still compiles) + existing jest suite still green.
- [ ] **Step 5 — Stage** `T1: unify token vocab + rebase to Service Ledger dark default`.

---

### Task 2: Display face swap (Instrument Serif → Zilla Slab)

**Files:** Modify `styles/tokens.css` (the `@import`, `--display`, `.serif`/`.title-*`/`.kpi-v`/`.av`).

- [ ] **Step 1 — Failing test:** extend the token test to assert `tokens.css` imports `Zilla+Slab` and `--display` references it, and does NOT reference `Instrument Serif`.
- [ ] **Step 2 — Run, confirm FAIL.**
- [ ] **Step 3 — Implement.** Update the Google-fonts `@import` to load `Zilla+Slab:wght@500;700` (drop Instrument Serif); rename `--serif`→`--display` (keep `--serif` as an alias) = `'Zilla Slab', Rockwell, Georgia, serif`; the `.title-*`, `.kpi-v`, `.serif`, `.av` rules pick it up via the var. Keep weights restrained (display only on wordmark/stamps/hero figures).
- [ ] **Step 4 — Run, confirm PASS** + screenshot the cookbook hero (`/recipes`) for a quick visual sanity (record path).
- [ ] **Step 5 — Stage** `T2: swap display face to Zilla Slab (Clarendon-lineage slab)`.

---

### Task 3: Core primitives + raw-hex audit on dark

**Files:** Modify `styles/tokens.css` + `styles/globals.css` (primitive rules only); Create `tests/js/test-no-rawhex-primitives.mjs`.

- [ ] **Step 1 — Failing lint test:** assert that, outside the `:root`/`.paper`/`.k-night` token-definition blocks, the primitive rules (`.btn .pill .kpi .surface .tabs .bar .input .card .nav .modal-*`) contain no raw `#rrggbb` (must use role tokens). Whitelist on-accent text like `#1a1308` only if intentional (prefer a `--on-accent` token).
- [ ] **Step 2 — Run, confirm FAIL** (e.g. `.btn.primary color:#1a1308`, `.pill.lari background:#1d1a15`, allergen `#fca5a5`, `.frame .screen background:var(--cream)`).
- [ ] **Step 3 — Implement.** Replace hard-coded hex in those primitives with role tokens; add `--on-accent #1a1308` token for text on amber; ensure `.btn/.pill/.kpi/.surface/.tabs/.input/.card` read correctly on `--bg`; delete now-redundant `.k-dark .x{…}` overrides that the dark default makes unnecessary (the default IS dark now).
- [ ] **Step 4 — Run, confirm PASS** + existing tests green + screenshot a primitives-heavy page (`/`) before T6 to see the baseline reskin.
- [ ] **Step 5 — Stage** `T3: primitives read on dark; remove raw hex; --on-accent token`.

---

### Task 4: App chrome on dark + brand-stamp signature

**Files:** Modify `styles/globals.css` (`.app`/`.strip`/`.sidebar`/`.command`/`.nav`), `app/_components/Sidebar.jsx` (wordmark = brand-stamp), Create `app/_components/BrandStamp.jsx` (the signature SVG monogram) + a small test.

- [ ] **Step 1 — Failing test:** RTL test asserts `BrandStamp` renders an accessible mark (`role="img"`, `aria-label="Lariat"`).
- [ ] **Step 2 — Run, confirm FAIL.**
- [ ] **Step 3 — Implement.** Re-base the cockpit chrome gradients/borders on role tokens (warm-char strip/sidebar, lamp-lit panel edges via a faint `--accent` top bloom); build `BrandStamp.jsx` (a cattle-brand/lariat-loop monogram, currentColor, scales by font-size) and place it as the sidebar wordmark + as the section-stamp glyph; add a `.stamp` section-header utility (display small-caps + ruled underline + brand glyph). Focus ring = `outline:2px solid var(--accent)`.
- [ ] **Step 4 — Run, confirm PASS** + screenshot the chrome.
- [ ] **Step 5 — Stage** `T4: dark cockpit chrome + Lariat brand-stamp signature`.

---

### Task 5: `.paper` document surface for printable/signable pages

**Files:** Modify `app/beo/share/[token]/page.jsx` (wrap in `.paper`), any report/HACCP print views; Create a small test asserting the share page root carries `paper`.

- [ ] **Step 1 — Failing test:** assert the BEO share document root element includes the `paper` class.
- [ ] **Step 2 — Run, confirm FAIL.**
- [ ] **Step 3 — Implement.** Wrap the client-facing BEO share sheet (and obvious print/report surfaces) in `.paper` so they render as a bright signed document on the dark app; verify text/figures legible and print CSS unaffected.
- [ ] **Step 4 — Run, confirm PASS** + screenshot the share page (should read as paper).
- [ ] **Step 5 — Stage** `T5: .paper document surface for BEO sheet + reports`.

---

### Task 6: Rebuild the Today / rush board in the new language (flagship)

**Files:** Modify `app/page.jsx`, `app/_components/PreshiftNotes.jsx`, the `.rush-*` rules in `styles/globals.css`; extend `app/__tests__/` with a focus-visible + token-usage assertion if a Today test exists, else add one.

- [ ] **Step 1 — Failing test:** a small RTL/markup test asserting the rush board uses role tokens for status (no `var(--red/--green/--yellow)` literals left — they should be `--fire/--ok/--metal`) and that the primary action has a visible focus style.
- [ ] **Step 2 — Run, confirm FAIL.**
- [ ] **Step 3 — Implement.** Bring `/` fully into the language: ledger-ruled station rows, branding-iron section stamps (`.stamp`), lamp-lit panels, amber "live/service" + oxblood "flagged/86" states, Zilla-Slab hero figures with tabular sub-stats; migrate `rushColor()` from `--red/--green/--yellow` to `--fire/--ok/--accent`. Keep the editorial kicker. No layout/behavior change — visual only.
- [ ] **Step 4 — Run, confirm PASS** + **screenshot `/` via `/run`** (dark, lamp-lit, ledger). Self-critique pass (remove one accessory). Existing tests green.
- [ ] **Step 5 — Stage** `T6: Today rush board in Service Ledger language (flagship)`.

---

## Final (Phase 1)
- Full gate: `npm run typecheck` · `npm run lint` · jest · node tests · `npm run build` · the two new design tests.
- Screenshots of `/` (dark), `/recipes` (display face), and `/beo/share/<token>` (paper) attached for review.
- Whole-Phase-1 review, then HALT — Phase 2 (loop the remaining surface namespaces against this frozen system) is a separate plan + approval.

## Self-review
- Spec coverage: dark rebase→T1; display→T2; primitives/contrast/raw-hex→T1/T3; chrome+signature→T4; `.paper`→T5; flagship Today→T6; verification (contrast test, raw-hex lint, focus, screenshots, regression) distributed across tasks.
- Risk called out: the dual-token-vocabulary unification is T1 and is the keystone; everything else depends on it.
- Type/name consistency: role tokens defined in T1 are the names every later task references; legacy aliases keep un-swept surfaces working until Phase 2.
