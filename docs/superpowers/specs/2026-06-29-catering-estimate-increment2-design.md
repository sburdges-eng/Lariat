# Catering Estimate — Increment 2: Operator Food-Cost Overlay + F&B-Minimum Meter

**Date:** 2026-06-29
**Branch:** `feat/catering-estimate-increment2` (off `main` with increment 1 merged)
**Status:** Spec — awaiting review

## Goal

Add two **operator-only** surfaces to the catering estimate built in increment 1, both hidden from
clients and print via the existing `data-print="false"` / `.estimate-doc.client` gating: (1) a
**food-cost overlay** that shows, per line and blended, a derived food-cost % using the app's existing
`computeDishCost` join (`dish_components` → `recipe_costs`/`vendor_prices`), honestly surfacing lines
that aren't linked yet; and (2) an **F&B-minimum meter** showing Subtotal vs a new per-event
`min_spend`, set by operators in the BEO editor.

## Non-goals

- **Client-facing display** of food cost or min-spend — operator register only this round.
- **Seeding `dish_components`** — it's ~5% populated, so most lines will show "not linked"; that's
  surfaced honestly. Seeding stays the existing offline script's job (`lib/dishMenuItemMatch.ts` /
  `scripts/seed-menu-item-declarations.mjs`).
- **An auto BEO-line→recipe mapping table/UI** — out of scope; the overlay uses `computeDishCost`'s
  freeform-name normalization as-is.
- **A precise per-line food-cost %** — see Invariants: it's a basis-approximate operator estimate.

## User-facing surface

### `lib/beoFoodCost.ts` (new)

```ts
import type Database from 'better-sqlite3';
export interface LineFoodCost {
  id: number;                 // beo_line_items.id
  cost: number | null;        // computeDishCost total_cost (per serving), null if unlinked
  link_state: 'unlinked' | 'declared_only' | 'partial' | 'fully_linked';
  food_cost_pct: number | null; // cost / unit_cost when unit_cost>0 && link_state in {partial,fully_linked}; else null
}
export interface BlendedFoodCost {
  pct: number | null;         // Σ(cost·qty) / Σ(sell·qty) over costed lines only; null if none costed
  costedCount: number;
  unlinkedCount: number;
}
export function computeLineFoodCosts(
  lineItems: Array<{ id: number; item_name: string; unit_cost?: number|null; quantity?: number|null }>,
  locationId: string,
  db: Database.Database,
): { perLine: LineFoodCost[]; blended: BlendedFoodCost };
```
Wraps `computeDishCost(item_name, locationId, /*precomputedMap*/ undefined, /*recipes*/ undefined, db)`
once per line (or builds the map once via `buildDishComponentMap` and reuses it). Pure read; no writes.

### `EstimateDocument` (extend, operator register only)

New optional prop `foodCosts?: { perLine: LineFoodCost[]; blended: BlendedFoodCost }` and
`minSpend?: number | null`. When `register === 'operator'` and `foodCosts` present:
- per item row, an operator-only chip: `food NN%` (linked) or `— not linked` (unlinked), `data-print="false"`.
- a totals line "Food cost (est.) · ≥NN% · margin ≤MM% · K linked / U not linked", `data-print="false"`.
When `register === 'operator'` and `minSpend != null`: an operator-only **meter** under the totals —
`F&B minimum $X · minimum met — over by $Y` (green) or `under by $Y` (ember) where `Y = subtotal − minSpend`,
`data-print="false"`. All of these are absent for `register === 'client'`.

### Operator route `app/beo/[id]/estimate/page.jsx` (extend)

After loading event + lineItems, call `computeLineFoodCosts(lineItems, event.location_id ?? 'default', db)`
and pass `foodCosts` + `minSpend={event.min_spend ?? null}` to `EstimateDocument`. No change to the client
share route.

### `BeoBoard` event editor (extend)

Add a numeric **Minimum spend ($)** input bound to the open event; on save, include `min_spend` in the
PATCH body. Existing edit/save flow otherwise unchanged.

### API `app/api/beo/route.js` (extend)

POST (create) and PATCH (update) event accept an optional `min_spend` (number | null); persisted to
`beo_events.min_spend`. Validation: coerce to number or null; reject negative with the existing
soft-reject pattern.

## Data model deltas

New nullable column on `beo_events`:
```sql
ALTER TABLE beo_events ADD COLUMN min_spend REAL;   -- nullable; no default
```
- Bump `SCHEMA_VERSION` in `lib/db.ts` (currently 2 → 3) so `check-schema-version-bump` passes.
- Add `min_spend?: number | null` to the `BeoEvent` interface.
- The `ALTER` runs idempotently in `initSchema()` (guard: only add if the column is absent — follow the
  existing additive-migration pattern; `ALTER TABLE ADD COLUMN` on an existing column throws, so gate on
  a `PRAGMA table_info` check or the repo's existing migration helper).

## Invariants

1. **Operator-only:** no food-cost or min-spend node renders for `register === 'client'` or in print
   (asserted in component tests). The client share route is untouched and its output byte-identical
   aside from being unaffected.
2. **No silent drops:** unlinked lines render "not linked" and are counted in `blended.unlinkedCount`;
   the blended % is explicitly "over linked lines only".
3. **Totals unchanged:** `computeEstimateTotals` and the displayed subtotal/service/tax/total are not
   altered by this increment.
4. **Read-only costing:** `computeLineFoodCosts` performs no DB writes.
5. **Migration is additive + idempotent:** `min_spend` is nullable; existing events read `null`;
   re-running `initSchema()` does not error.
6. **Food-cost % is a labeled estimate:** the per-line % divides a dish-serving cost by a
   platter/per-person sell price, so it is directional, carries the `link_state`, and is never presented
   as exact.

## Open questions

1. **`min_spend` validation** — reject negative (soft-reject) and treat empty input as `null` (clear)?
   (Proposed: yes.)
2. **Blended food-cost basis** — confirm the blend is Σ(dish cost × qty) / Σ(sell × qty) over linked
   lines only (a floor), labeled "≥". (Proposed: yes.)
3. **`computeDishCost` performance** — N `computeDishCost` calls per render vs one `buildDishComponentMap`
   reused across lines. (Proposed: build the map once, reuse — single pass.)
4. **Idempotent ALTER** — does `lib/db.ts` already have a helper/pattern for "add column if missing"?
   Confirm during T1 and follow it rather than introducing a new approach.
