# Catering Estimate — Increment 2: Implementation Plan

**Spec:** [docs/superpowers/specs/2026-06-29-catering-estimate-increment2-design.md](../specs/2026-06-29-catering-estimate-increment2-design.md)
**Branch:** `feat/catering-estimate-increment2`
**Date:** 2026-06-30
**Method:** TDD, one commit per task (`T#:` prefix). Halt for approval before T1.

## Outcome

Two **operator-only** surfaces on the existing catering estimate (increment 1), both hidden from
clients + print via the established `data-print="false"` / `.estimate-doc.client` gating:
1. **Food-cost overlay** — per-line `food NN%` / `— not linked` chips + a blended totals line.
2. **F&B-minimum meter** — Subtotal vs a new per-event `min_spend`, "met / over / under by $Y".

## Resolved open questions (from spec §Open questions)

- **OQ1 `min_spend` validation** → reject negative (soft-reject 400), empty input → `null`.
- **OQ2 Blended basis** → `Σ(cost·qty) / Σ(sell·qty)` over **costed lines only** (`total_cost != null`), labeled "≥".
- **OQ3 Perf** → build `buildDishComponentMap(locationId)` **once**, reuse across lines via `computeDishCost(..., map, ...)`. ✅ confirmed supported.
- **OQ4 Idempotent ALTER** → repo uses inline `PRAGMA table_info` guard + try/catch `ALTER` in `migrateLegacyColumns()` (no helper). Copy the `recipe_photos.is_hero` example verbatim. ✅ confirmed.

## Key facts established by exploration (anchors for implementers)

- `computeDishCost(dishName, locationId, precomputedMap?, recipesOverride?, db?)` → `DishCostResult { total_cost: number|null, fully_costed, link_state: 'unlinked'|'declared_only'|'partial'|'fully_linked' }` — **`link_state` is already computed**, `lib/dishCostBridge.ts:327-369`. `buildDishComponentMap(locationId, ...)` → reusable Map, same file.
- `SCHEMA_VERSION = 2` at `lib/db.ts:978`. `beo_events` CREATE at `lib/db.ts:1618-1634` (no `min_spend`). `BeoEvent` interface at `lib/db.ts:290-303`. Migration pattern at `lib/db.ts:3295-3302`. Bump guard: `scripts/check-schema-version-bump.mjs`.
- `EstimateDocument({ event, sections, totals, courses, signatures, register, signSlot })` `app/beo/_components/EstimateDocument.jsx:42-50`. Row render at `:162-182` (chip attaches in `.ed-row`); totals at `:185-212` (blended line + meter after `.ed-divider`, `:210`). Gating CSS `styles/estimate.css:343-345`; print rule `:431-442`.
- Operator route `app/beo/[id]/estimate/page.jsx:14-34` — event SELECT **omits `location_id` and `min_spend`** (T5 must add them).
- `lib/beoEstimate.ts` — `computeEstimateTotals(event, lineItems) → {subtotal, serviceFee, tax, total}`; `EstimateLineItem` has `id, item_name, unit_cost, quantity, category, course_id, sort_order`.
- Editor `app/beo/BeoBoard.tsx` — `BeoEvent` iface `:21-33`; `EventHeader` `:486-572` (numeric input + `onBlur` commit pattern); `updateEvent` `:253-268` (POST body).
- API `app/api/beo/route.js` — create `:114-149`, update (COALESCE) `:151-217`. Soft-reject idiom: `app/api/specials/saved/[id]/promote/route.js:77-86`.
- Test idioms: `node:test` API tests `tests/js/test-beo-update-event-partial-patch.mjs`; RTL component tests `app/__tests__/EstimateDocument.test.jsx` (exercises both register variants); schema test `tests/js/test-schema-migrations.mjs`.

---

## Tasks

### T1 — Schema: `min_spend` column + version bump
Add `min_spend REAL` (nullable, no default) to `beo_events`: in the CREATE TABLE (fresh DBs) **and** as an idempotent additive migration in `migrateLegacyColumns()` (existing DBs, `PRAGMA table_info` guard + try/catch). Bump `SCHEMA_VERSION` 2 → 3. Add `min_spend?: number | null` to the `BeoEvent` interface.
- **MAY modify:** `lib/db.ts`, `tests/js/test-schema-migrations.mjs`
- **MUST NOT modify:** any `app/`, `styles/`, other `lib/` files
- **Depends on:** none
- **Test first:** extend `test-schema-migrations.mjs` — assert `beo_events` has a nullable `min_spend` column after `initSchema()`, that a pre-existing DB without the column gets it added, and re-running `initSchema()` does not throw. Run red → implement → green.
- **Acceptance:** `node --experimental-strip-types --test tests/js/test-schema-migrations.mjs` + `npm run typecheck`

### T2 — `lib/beoFoodCost.ts` costing helper (pure, read-only)
New `computeLineFoodCosts(lineItems, locationId, db)` → `{ perLine: LineFoodCost[]; blended: BlendedFoodCost }` per the spec signatures. Build the component map once; per line call `computeDishCost(item_name, locationId, map, undefined, db)`; map `cost = total_cost`, `link_state` through; `food_cost_pct = cost/unit_cost` when `unit_cost>0 && link_state ∈ {partial, fully_linked}` else `null`. Blended = `Σ(cost·qty)/Σ(sell·qty)` over costed lines; `costedCount`, `unlinkedCount`.
- **MAY modify:** `lib/beoFoodCost.ts` (new), `tests/js/test-beo-food-cost.mjs` (new)
- **MUST NOT modify:** `lib/dishCostBridge.ts`, `lib/beoEstimate.ts`, any `app/` files
- **Depends on:** none (uses existing `dishCostBridge`)
- **Test first:** seed an in-memory/temp DB with a fully-linked dish, a partial, a declared-only, and an unlinked freeform line; assert per-line `cost`/`link_state`/`food_cost_pct` and the blended floor + counts. Run red → implement → green.
- **Acceptance:** `node --experimental-strip-types --test tests/js/test-beo-food-cost.mjs` + `npm run typecheck`

### T3 — beo API: accept + validate `min_spend`
`app/api/beo/route.js` create (`event`) and update (`update_event`) accept optional `min_spend`: coerce to number or `null`; **soft-reject** negative with `400` (mirror promote-route idiom). UPDATE uses the existing COALESCE pattern.
- **MAY modify:** `app/api/beo/route.js`, `tests/js/test-beo-update-event-partial-patch.mjs` (or new `tests/js/test-beo-min-spend.mjs`)
- **MUST NOT modify:** `lib/db.ts` (done in T1), `app/beo/BeoBoard.tsx`, render files
- **Depends on:** T1 (column must exist)
- **Test first:** patch only `min_spend` → persists, other columns preserved; negative → 400; empty/null → stored null. Run red → implement → green.
- **Acceptance:** `node --experimental-strip-types --test tests/js/test-beo-update-event-partial-patch.mjs` (+ new test) + `npm run typecheck`

### T4 — `EstimateDocument` operator overlay + CSS
Add optional props `foodCosts` and `minSpend`. When `register === 'operator'`: per-row `food NN%`/`— not linked` chip inside `.ed-row`; a blended totals line ("Food cost (est.) · ≥NN% · margin ≤MM% · K linked / U not linked"); and a meter under totals ("F&B minimum $X · met — over by $Y" / "under by $Y"). All `data-print="false"`. New `.ed-*` classes in `estimate.css` consistent with existing convention. Absent for `register === 'client'`.
- **MAY modify:** `app/beo/_components/EstimateDocument.jsx`, `styles/estimate.css`, `app/__tests__/EstimateDocument.test.jsx`
- **MUST NOT modify:** `app/beo/[id]/estimate/page.jsx`, `app/beo/share/[token]/page.jsx`, `lib/*`
- **Depends on:** T2 (prop data shape)
- **Test first:** extend `EstimateDocument.test.jsx` — operator render shows chips + blended line + meter; **client render shows none of them** (invariant 1); meter "over/under" wording flips on subtotal vs minSpend; "not linked" appears for unlinked lines. Run red → implement → green.
- **Acceptance:** `npx jest app/__tests__/EstimateDocument.test.jsx --runInBand` + `npm run typecheck`

### T5 — Operator route wiring
`app/beo/[id]/estimate/page.jsx`: extend the event SELECT to include `location_id` and `min_spend`; call `computeLineFoodCosts(lineItems, event.location_id ?? 'default', db)`; pass `foodCosts` + `minSpend={event.min_spend ?? null}` to `EstimateDocument`. **No change to the client share route.**
- **MAY modify:** `app/beo/[id]/estimate/page.jsx`
- **MUST NOT modify:** `app/beo/share/[token]/page.jsx`, `EstimateDocument.jsx`, `lib/*`
- **Depends on:** T1, T2, T4
- **Test first (light):** source-guard test (mirrors existing `BeoSharePageChrome.test.jsx` idiom) asserting the operator route imports `computeLineFoodCosts`, selects `location_id`/`min_spend`, and passes `foodCosts`/`minSpend`. *(Server component + DB → full render test is disproportionate; the render contract is covered by T4. Flagged for your call at the halt.)*
- **Acceptance:** `npm run typecheck` + `npm run build` (route compiles) + the light guard test

### T6 — BeoBoard editor: `min_spend` input
`app/beo/BeoBoard.tsx`: add `min_spend: number | null` to its local `BeoEvent` iface; add a numeric **Minimum spend ($)** input in `EventHeader` (bound to state, `onBlur` → `commit({ min_spend })`); include `min_spend: ev.min_spend` in the `updateEvent` POST body.
- **MAY modify:** `app/beo/BeoBoard.tsx`
- **MUST NOT modify:** `app/api/beo/route.js` (done in T3), `lib/*`, render files
- **Depends on:** T1, T3
- **Test first (light):** the persistence contract is covered by T3's API test; this task is form wiring. Gate on `npm run typecheck` + `npm run lint`. *(An RTL test of the full BeoBoard is disproportionate — flagged for your call; I can add a focused input-presence test if you want.)*
- **Acceptance:** `npm run typecheck` + `npx eslint app/beo/BeoBoard.tsx`

---

## Dependency DAG

```
T1 ─┬─> T3 ──> T6
    └─> T5
T2 ─┬─> T4 ──> T5
    └─> T5
```
T1 and T2 have no deps (can start together). Suggested order: **T1, T2, T3, T4, T5, T6.**

## Invariants to hold (asserted in tests)

1. No food-cost/min-spend node for `register === 'client'` or in print (T4).
2. Unlinked lines render "not linked" and count in `unlinkedCount`; blended is "linked lines only", labeled "≥" (T2, T4).
3. `computeEstimateTotals` and displayed subtotal/service/tax/total unchanged (T4 — assert existing totals tests still pass).
4. `computeLineFoodCosts` performs no DB writes (T2).
5. Migration additive + idempotent; existing events read `null` (T1).
6. Food-cost % is a labeled, directional estimate — never "exact" (T2 returns null where not derivable; T4 labels "≥").

## Final verification (Step 5)

Full gate set, all green before PR update: `npm run typecheck`, `npx eslint .`, `npx jest`, the new `node:test` files, `npm run build`. Push to `feat/catering-estimate-increment2` (PR #372). Show green output; list deferred follow-ups (e.g. the Georgia-vs-Zilla font decision, `.ed-notes*` styling, T5/T6 deeper tests).
