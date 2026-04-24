# Compute Engine — read-only review

**Date:** 2026-04-24
**Reviewer:** Claude (parallel session)
**Scope reviewed:** uncommitted working tree at time of review:
- `lib/computeEngine/{index,recipeCosting,marginAnalysis,accountingVariance,sandboxCosting}.ts`
- `app/api/compute/status/route.js`
- `lib/db.ts` additions (`margin_snapshots`, `accounting_variance` tables)
- `app/api/receiving/route.js` (new async trigger)
- `app/costing/page.jsx` (new KPI tile)
- `app/menu-engineering/page.tsx` (new "last ran" display)
- `scripts/ingest_catch_weights.py` (new HTTP POST to trigger engine)

**Posture:** this doc is a handoff from a parallel session that was working
on a different set of tasks on `main` (tests + docs, commits `c54b543`
through `d462601`). None of my commits touched the compute-engine files.
The critical/important items below are worth closing before landing.

---

## Architecture summary

`triggerComputeEngine(locationId)` in `lib/computeEngine/index.ts`
orchestrates three on-demand recomputes:

1. **`recomputeRecipeCosts(db, loc)`** — SQL recompute of
   `recipe_costs.batch_cost` from `bom_lines × latest vendor_prices`.
   UPDATE, in-place.
2. **`recomputeMarginAnalysis(db, loc)`** — calls the existing
   `computeMenuEngineering(loc)`, persists one INSERT per dish to new
   `margin_snapshots` table.
3. **`computeAccountingVariance(db, loc)`** — theoretical (sales ×
   recipe cost) vs actual (spend_monthly) COGS; one INSERT to new
   `accounting_variance` table.

Plus a 4th module `sandboxCosting.ts` — ad-hoc ingredient-list costing,
not wired into `triggerComputeEngine`; presumably for the Kitchen
Assistant or a future "what-if" UI.

Integration points:
- `POST /api/compute/status` fires the orchestrator (fire-and-forget).
- `app/api/receiving/route.js` POST fires the orchestrator after a
  delivery lands.
- `scripts/ingest_catch_weights.py` HTTP-POSTs to the orchestrator after
  a seed run.
- `/costing` renders latest `accounting_variance` as a KPI tile.
- `/menu-engineering` renders the latest `margin_snapshots.snapshot_at`.

---

## Critical issues (must fix before merge)

### C1 · `recipeCosting.ts:10–16` — non-deterministic "latest row per group"

```sql
WITH latest_vendor_prices AS (
  SELECT ingredient, pack_price, pack_size, pack_unit, yield_pct
  FROM vendor_prices
  WHERE location_id = ?
  GROUP BY ingredient
  HAVING imported_at = MAX(imported_at)
)
```

In SQLite, when a SELECT list has non-aggregated, non-grouped columns
(`pack_price`, `pack_size`, `pack_unit`, `yield_pct`) alongside a
`GROUP BY`, the engine picks an **arbitrary** row from each group for
those columns. The `HAVING imported_at = MAX(imported_at)` clause
filters groups but does NOT guarantee that the returned `pack_price`
came from the row with the max `imported_at` — SQLite might surface the
max-imported_at row's values in some cases, but this isn't contractual.

For ingredients with multiple vendor rows — the exact T7 scenario of
Sysco + Shamrock both carrying the same ingredient — this silently
returns a wrong price.

**Fix:** correlated subquery with explicit tie-break.

```sql
WITH latest_vendor_prices AS (
  SELECT vp.*
    FROM vendor_prices vp
    JOIN (
      SELECT ingredient, MAX(imported_at) AS mx
        FROM vendor_prices
       WHERE location_id = ?
       GROUP BY ingredient
    ) t ON vp.ingredient = t.ingredient AND vp.imported_at = t.mx
   WHERE vp.location_id = ?
)
```

Or use `ROW_NUMBER() OVER (PARTITION BY ingredient ORDER BY imported_at DESC, id DESC)` + `WHERE rn = 1` (SQLite ≥ 3.25). The tie-break on `id DESC` handles sub-second duplicates.

---

### C2 · `accountingVariance.ts:7–14` — theoretical COGS uses wrong column

```sql
SELECT SUM(s.quantity_sold * COALESCE(rc.batch_cost, 0))
  FROM sales_lines s
  LEFT JOIN recipe_costs rc ON (s.item_name = rc.recipe_name)
```

`recipe_costs.batch_cost` is the cost per **whole batch** (which yields
`rc.yield` units). One serving costs `batch_cost / yield`, which is
precisely `rc.cost_per_yield_unit` — already populated by the upstream
costing ingest post-pass.

As written, theoretical COGS is over-counted by a factor of `yield`
(typically 10–40×). The `accounting_variance` tile will show enormous
red numbers even on a well-costed menu.

**Fix:** `SUM(s.quantity_sold * COALESCE(rc.cost_per_yield_unit, 0))`.

---

### C3 · `accountingVariance.ts` — no time-window alignment

Theoretical COGS `SUM`s every row in `sales_lines` ever. Actual COGS
`SUM`s every row in `spend_monthly` ever. If sales has 2 years of
history and spend_monthly has 6 months, the variance is nonsense.

The `accounting_variance` table already has `period_start` /
`period_end` columns — the INSERT doesn't populate them.

**Fix:** either (a) accept `{period_start, period_end}` on the
function signature and WHERE-filter both SELECTs to that window, or
(b) default to "current month" / "last 30 days" and record that in
the new row. Populate the period columns in the INSERT either way.

---

### C4 · `recipeCosting.ts` bypasses the T7 / D6 resolver in `lib/costingBenchmarks.mjs`

The existing mapping engine has `resolveMergedCost` (T7 master_id-aware,
PR #25 landed) and D6 unmatched-lines exclusion. The new compute engine
re-implements ingredient→price matching via a raw SQL join on
`b.vendor_ingredient = v.ingredient OR b.ingredient = v.ingredient`.

Two resolvers = two different batch_cost values for the same recipe.
The `/costing` dashboard's **B1 variance tile** (powered by
`computeCostVariance`) will contradict the new **Accounting Variance
tile** (powered by `recomputeRecipeCosts → accountingVariance`).
Operators will see two numbers that don't agree and lose trust in both.

**Fix:** either call into `computeCostVariance(db, loc)` from
`lib/costingBenchmarks.mjs` and reuse its per-recipe actuals, OR
factor the resolver into a shared `resolveLatestIngredientPrice(db,
location_id, bom_row)` helper and have both callers use it. See
`lib/costingBenchmarks.mjs:resolveMergedCost` for the T7 posture.

---

## Important (close before scaling out)

### I1 · `app/api/receiving/route.js:198–204` — fire-and-forget swallows import errors

```js
import('../../../lib/computeEngine').then(({ triggerComputeEngine }) => {
  triggerComputeEngine(location_id).catch(err => {
    console.error('Compute Engine Trigger Error from receiving_log:', err);
  });
});
```

The outer `.then()` has no `.catch()`. A dynamic-import failure (typo
path, bad transpile) vanishes silently — the receiving POST returns
200 and the caller never learns the trigger didn't fire.

**Fix:** top-level static import; call `triggerComputeEngine(...)`
directly as a fire-and-forget with a single catch:

```js
import { triggerComputeEngine } from '../../../lib/computeEngine';
// later, after performWrite():
Promise.resolve().then(() => triggerComputeEngine(location_id))
  .catch(err => console.error('Compute Engine Trigger Error:', err));
```

---

### I2 · `margin_snapshots` + `accounting_variance` grow unbounded

Every trigger INSERTs fresh rows. 100 receiving POSTs × 50 dishes =
5,000 rows/week in `margin_snapshots`. Over 6 months that's ~130k rows
with no compaction or retention policy. SQLite will handle it, but:

- Query-side: `ORDER BY id DESC LIMIT 1` in the read path works fine,
  but any aggregate / history query gets progressively slower without
  an index on `(location_id, snapshot_at DESC)`.
- Ops: nothing reclaims disk space.

**Fix options (pick one):**
- Compute-on-read and drop the tables entirely — arguably the right
  call for margin snapshots since the source data (`sales_lines` +
  `recipe_costs`) is cheap to re-scan and the "snapshot" is really
  just caching a view.
- Retention policy: `DELETE FROM margin_snapshots WHERE snapshot_at < datetime('now','-90 days')` at end of each trigger transaction.
- Upsert on `(item_name, location_id)` so there's only one row per
  dish — trades history for bounded size.

---

### I3 · `scripts/ingest_catch_weights.py` HTTP-POSTs hardcoded `http://localhost:3000`

```python
req = urllib.request.Request("http://localhost:3000/api/compute/status", method="POST")
```

Fails silently (just a stderr print) when:
- The dev server isn't running (common during CI / seed-from-fresh).
- The launcher uses a non-default `LARIAT_PORT`.
- Deployment on a different host.

This is also an odd coupling — a pure-Python seed script reaches into
a running Node server to trigger a compute. The seed script doesn't
care; it just wants to finish its UPSERT cleanly.

**Fix:** drop the HTTP call. Have the operator trigger compute
explicitly (or wire a `launchd` post-seed hook). If the trigger must
stay, read `LARIAT_PORT` from env and fall back to 3000.

---

### I4 · `/api/compute/status` POST has no PIN gate

Triggers an expensive SQL recompute. `middleware.js` already gates
`/api/costing`, `/api/analytics`, `/api/beo`, `/api/audit` — add
`/api/compute` to `SENSITIVE_PREFIXES`.

On a LAN-only deployment this is low-risk, but the compute engine can
be triggered in a loop by anyone on the network — a cheap DoS. PIN
gate is a one-line defense.

---

### I5 · `sandboxCosting.ts:41` uses `density = 1.0` for cross-dim conversion

```js
let convertedQty = convertQty(qty, rawUnit, packUnit, 1.0);
```

The existing `unitConvert.mjs` + `ingredient_densities` table (T4)
already has real densities. Passing 1.0 systematically produces wrong
answers for volume↔weight on anything that isn't water (oil is 0.92;
flour is 0.53; onion is 0.56).

The module comment acknowledges this as a known gap. For an AI-suggested
recipe cost, a directional estimate may be acceptable — but it must
be labeled as such in the output so the Kitchen Assistant doesn't
present it as authoritative.

**Fix options:**
- Wire the real density lookup from `ingredient_densities` via the
  ingredient_key path (same approach as T4).
- Or: refuse cross-dim conversions when density is missing; emit a
  `{ cost: null, note: 'no density — cross-dim refused' }` entry.

---

### I6 · No tests

5 new modules + 2 new tables + 4 integration points, zero tests. For a
real-time compute engine with several SQL correctness questions, that's
the thing to land next.

Suggested shape (pattern-match `tests/js/test-t9-benchmarks.mjs`):

- `tests/js/test-compute-engine.mjs` — in-memory better-sqlite3, seed
  vendor_prices + bom_lines + recipe_costs, run `triggerComputeEngine`,
  assert:
  - `recomputeRecipeCosts` picks the latest vendor price (C1 fix
    regression pin)
  - `computeAccountingVariance` uses `cost_per_yield_unit` (C2 fix
    regression pin)
  - Period-window parameter round-trips (C3 fix regression pin)
  - `sandboxCosting` refuses cross-dim without density (I5)
  - `/api/compute/status` GET returns latest envelope shape
  - `/api/compute/status` POST is PIN-gated (I4)

This session can write those tests as a follow-up once the C1–C4 fixes
land. Ping the other session (or check the review-handoff doc) when
ready.

---

## Minor

- **M1** `app/menu-engineering/page.tsx:67` uses `require('../../lib/db')`
  in a server component — breaks on Next 15 ESM. Use `import` at
  top-of-file.
- **M2** `sandboxCosting.ts` uses `LIKE '%...%'` — can't hit the
  ingredient index; first-match-by-imported_at may not be the caller's
  intent. Acceptable for a sandbox heuristic; document the fuzziness.
- **M3** `recipeCosting.ts` has `OR` in the JOIN ON — prevents index
  use on large BOMs. Consider `UNION ALL` of two joins or a
  deterministic priority (vendor_ingredient first, ingredient fallback).
- **M4** `marginAnalysis.ts` gate inconsistency — `if (row.quadrant
  && row.margin_pct != null)` lets rows with `null` margin_pct skip
  while `null` quadrant also skips. Pick one invariant.
- **M5** `recipeCosting.ts` comment mentions "receiving/EDI" as a
  driver; EDI isn't wired anywhere. Aspirational comment without code.

---

## Proposed hand-off

When C1–C4 are fixed, this session is ready to:
1. Write `tests/js/test-compute-engine.mjs` covering the fixed contracts.
2. Extend `docs/ARCHITECTURE.md` (new "Real-time compute engine" section)
   and `docs/PATTERNS.md` (fire-and-forget-trigger pattern).
3. Add `npm run test:compute-engine` script.

Ping via commit message or delete this file when the handoff is
complete. This doc is not load-bearing — it's a one-time review trace.
