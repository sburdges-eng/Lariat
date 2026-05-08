import type { Database } from 'better-sqlite3';
import { computeMenuEngineering } from '../menuEngineering';

export function recomputeMarginAnalysis(db: Database, locationId: string) {
  // Compute the current Menu Engineering quadrants based on active sales and costing.
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
      if (row.quadrant && row.margin_pct != null) {
        insertStmt.run({
          item_name: row.item_name,
          net_sales: row.net_sales,
          cost_per_unit: row.cost_per_unit,
          margin_pct: row.margin_pct,
          popularity: row.popularity,
          quadrant: row.quadrant,
          location_id: locationId
        });
      }
    }
  })();
}
