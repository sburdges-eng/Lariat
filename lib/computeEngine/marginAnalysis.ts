import type { Database } from 'better-sqlite3';
import { computeMenuEngineering } from '../menuEngineering';

/**
 * Persist a margin snapshot for every sales-line item.
 *
 * Every `MenuEngineeringRow` returned by `computeMenuEngineering` is
 * written to `margin_snapshots`, including dishes with no costing data:
 * those land with `quadrant = 'unknown'` and `margin_pct = NULL`. That
 * combination is the canonical "no costing data" signal — UI surfaces
 * are responsible for filtering it at query time when they only want
 * the well-priced portion of the menu.
 *
 * Why this matters: the previous if-guard dropped unknown-quadrant
 * rows silently, so operators auditing margin history saw a shrinking
 * snapshot as costing coverage dropped, with no signal that rows were
 * omitted. See docs/audit/2026-05-08-codebase-audit.md §4 Compute
 * (MEDIUM — marginAnalysis silently drops unknown).
 */
export function recomputeMarginAnalysis(db: Database, locationId: string) {
  // Thread `db` through so we don't open a second connection — sibling steps
  // (recomputeRecipeCosts, computeAccountingVariance) already do this; the
  // margin step regressed silently. See audit §4 Compute HIGH (db threading).
  const results = computeMenuEngineering(locationId, db);

  // Save the snapshot to the database
  db.transaction(() => {
    const insertStmt = db.prepare(`
      INSERT INTO margin_snapshots (
        item_name, net_sales, cost_per_unit, margin_pct, popularity, quadrant, location_id
      ) VALUES (
        @item_name, @net_sales, @cost_per_unit, @margin_pct, @popularity, @quadrant, @location_id
      )
    `);

    for (const row of results.rows) {
      // Persist every row, including quadrant='unknown' / margin_pct=null.
      // Filtering belongs at the consumer query, not here.
      insertStmt.run({
        item_name: row.item_name,
        net_sales: row.net_sales,
        cost_per_unit: row.cost_per_unit,
        margin_pct: row.margin_pct,
        popularity: row.popularity,
        quadrant: row.quadrant ?? 'unknown',
        location_id: locationId,
      });
    }
  })();
}
