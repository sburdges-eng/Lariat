#!/usr/bin/env node
/**
 * Apply T3+T4.1 costing deltas to an existing DB without re-ingesting the
 * workbook. The standard `npm run ingest:costing` path DELETEs + re-INSERTs
 * vendor_prices / bom_lines / recipe_costs from Excel. When the workbook on
 * disk has stale pack data (e.g. vendor_prices lists items as "1 cs"
 * placeholders), running the full ingest downgrades good hand-curated data
 * already in the DB.
 *
 * This script instead:
 *   1. Populates bom_lines.{yield_pct, loss_factor} via JOIN on
 *      ingredient_yields (the same JOIN ingestCosting performs on INSERT).
 *   2. Populates vendor_prices.yield_pct via the same JOIN (mirrors ingest).
 *   3. Runs runCostingPostPass() which reads those yields alongside
 *      ingredient_densities and ingredient_unit_weights to recompute
 *      recipe_costs.batch_cost with the yield/loss/unit-conversion delta.
 *
 * Usage:
 *   LARIAT_DB=/path/to/lariat.db node --experimental-strip-types \
 *     scripts/apply-costing-deltas.mjs [--location=default] [--dry-run]
 *
 * Dry-run reports what would change without UPDATEing batch_cost.
 */
import path from 'path';
import Database from 'better-sqlite3';
import { initSchema } from '../lib/db.ts';
import { normalizeIngredientKey } from '../lib/ingredientKey.ts';
import { runCostingPostPass } from './ingest-costing.mjs';

const args = process.argv.slice(2);
const arg = (prefix) => {
  const hit = args.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : null;
};
const LOCATION = arg('--location=') ?? 'default';
const DRY_RUN = args.includes('--dry-run');
const DB_PATH = process.env.LARIAT_DB || path.join(process.cwd(), 'data', 'lariat.db');

console.log(`[apply-costing-deltas] db=${DB_PATH} location=${LOCATION} dry-run=${DRY_RUN}`);

const db = new Database(DB_PATH);
initSchema(db); // idempotent; adds ingredient_unit_weights if the DB predates it

// ── Step 1 + 2: populate yield_pct / loss_factor via ingredient_yields JOIN ──
// Mirrors the yieldLookup + ibom/ivp paths inside ingestCosting (lines 100-210).
// The JS mirror of normalize_one lives in normalizeIngredientKey; we precompute
// the normalized key per BOM/vendor_prices ingredient and UPDATE in a single
// transaction. NULL stays NULL where no matching yield row exists — the
// post-pass reads NULL as 1.0 yield / 0.0 loss (no adjustment).
const yieldByKey = new Map();
for (const row of db.prepare(
  'SELECT ingredient_key, yield_pct, loss_factor FROM ingredient_yields',
).all()) {
  yieldByKey.set(row.ingredient_key, { yield_pct: row.yield_pct, loss_factor: row.loss_factor });
}
console.log(`[apply-costing-deltas] ingredient_yields rows: ${yieldByKey.size}`);

const bomRows = db.prepare(
  'SELECT id, ingredient FROM bom_lines WHERE location_id = ?',
).all(LOCATION);
const vpRows = db.prepare(
  'SELECT id, ingredient FROM vendor_prices WHERE location_id = ?',
).all(LOCATION);

let bomUpdated = 0;
let vpUpdated = 0;
const updateBom = db.prepare(
  'UPDATE bom_lines SET yield_pct = ?, loss_factor = ? WHERE id = ?',
);
const updateVp = db.prepare(
  'UPDATE vendor_prices SET yield_pct = ? WHERE id = ?',
);

db.transaction(() => {
  for (const r of bomRows) {
    const key = normalizeIngredientKey(r.ingredient ?? '');
    const hit = key ? yieldByKey.get(key) : null;
    const y = hit?.yield_pct ?? null;
    const l = hit?.loss_factor ?? null;
    updateBom.run(y, l, r.id);
    if (y !== null) bomUpdated++;
  }
  for (const r of vpRows) {
    const key = normalizeIngredientKey(r.ingredient ?? '');
    const hit = key ? yieldByKey.get(key) : null;
    const y = hit?.yield_pct ?? null;
    updateVp.run(y, r.id);
    if (y !== null) vpUpdated++;
  }
})();

console.log(
  `[apply-costing-deltas] bom_lines yield coverage: ${bomUpdated}/${bomRows.length} (` +
    `${bomRows.length ? ((100 * bomUpdated) / bomRows.length).toFixed(1) : 0}%)`,
);
console.log(
  `[apply-costing-deltas] vendor_prices yield coverage: ${vpUpdated}/${vpRows.length}`,
);

// ── Step 3: post-pass ────────────────────────────────────────────────
// Capture batch_cost snapshot before post-pass so --dry-run can report what
// WOULD change without committing. We always let the post-pass run (it's
// needed to compute deltas), then if --dry-run is set, restore batch_cost +
// cost_per_yield_unit + any NEEDS_DENSITY flag changes from the snapshot.
const rcSnapshot = new Map();
for (const row of db.prepare(
  'SELECT recipe_id, batch_cost, cost_per_yield_unit FROM recipe_costs WHERE location_id = ?',
).all(LOCATION)) {
  rcSnapshot.set(row.recipe_id, {
    batch_cost: row.batch_cost,
    cost_per_yield_unit: row.cost_per_yield_unit,
  });
}
const bomStatusSnapshot = new Map();
for (const row of db.prepare(
  'SELECT id, map_status FROM bom_lines WHERE location_id = ?',
).all(LOCATION)) {
  bomStatusSnapshot.set(row.id, row.map_status);
}

const summary = runCostingPostPass(db, LOCATION);
console.log(
  `[apply-costing-deltas] ✓ post-pass: recipes_adjusted=${summary.recipes_yield_adjusted} ` +
    `Δ_total=$${summary.total_yield_delta_usd} max=$${summary.max_recipe_yield_delta_usd} ` +
    `flagged=${summary.bom_lines_needs_density}`,
);

if (DRY_RUN) {
  console.log('[apply-costing-deltas] --dry-run: rolling back UPDATEs');
  const restoreRc = db.prepare(
    'UPDATE recipe_costs SET batch_cost = ?, cost_per_yield_unit = ? WHERE recipe_id = ? AND location_id = ?',
  );
  const restoreBom = db.prepare(
    'UPDATE bom_lines SET map_status = ? WHERE id = ?',
  );
  const restoreBomYield = db.prepare(
    'UPDATE bom_lines SET yield_pct = NULL, loss_factor = NULL WHERE id = ?',
  );
  const restoreVpYield = db.prepare(
    'UPDATE vendor_prices SET yield_pct = NULL WHERE id = ?',
  );
  db.transaction(() => {
    for (const [rid, v] of rcSnapshot) {
      restoreRc.run(v.batch_cost, v.cost_per_yield_unit, rid, LOCATION);
    }
    for (const [id, s] of bomStatusSnapshot) restoreBom.run(s, id);
    for (const r of bomRows) restoreBomYield.run(r.id);
    for (const r of vpRows) restoreVpYield.run(r.id);
  })();
}

db.close();
