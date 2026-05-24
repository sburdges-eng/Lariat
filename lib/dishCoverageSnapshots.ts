/**
 * Dish coverage snapshot read/write helpers.
 *
 * The management rollup page reads the latest snapshot instead of
 * computing dish coverage inline (which scans dish_components +
 * sales_lines on every page load). The compute engine writes a new
 * snapshot after each run.
 */

import { getDb } from './db.ts';
import type { DishCoverageSnapshot } from './db.ts';
import type { DishCoverageReport } from './dishCostBridge.ts';

// ── Writer ────────────────────────────────────────────────────────────

export interface SaveSnapshotOpts {
  locationId?: string;
  createdBy?: string;
}

/**
 * Persist a point-in-time dish coverage snapshot derived from a
 * {@link DishCoverageReport}. Returns the new row id.
 */
export function saveDishCoverageSnapshot(
  report: DishCoverageReport,
  opts: SaveSnapshotOpts = {},
): number {
  const locationId = opts.locationId ?? 'default';
  const createdBy = opts.createdBy ?? 'compute_engine';

  const totalDishes = report.total_sales_dishes;
  const coveredDishes = report.fully_linked + report.partial;
  const coveragePct =
    totalDishes > 0 ? Math.round((coveredDishes / totalDishes) * 10000) / 100 : 0;

  // Store uncovered dish names as a JSON array (unlinked + declared_only).
  const uncoveredNames = [
    ...report.unlinked_dishes.map((d) => d.item_name),
    ...report.declared_only_dishes.map((d) => d.item_name),
  ];

  const db = getDb();
  const info = db
    .prepare(
      `INSERT INTO dish_coverage_snapshots
         (location_id, total_dishes, covered_dishes, coverage_pct,
          uncovered_dishes, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      locationId,
      totalDishes,
      coveredDishes,
      coveragePct,
      JSON.stringify(uncoveredNames),
      createdBy,
    );

  return Number(info.lastInsertRowid);
}

// ── Reader ────────────────────────────────────────────────────────────

/**
 * Hydrated snapshot with parsed uncovered_dishes array and computed
 * fields that mirror DishCoverageReport for easy consumption by the
 * management tile.
 */
export interface HydratedCoverageSnapshot {
  id: number;
  location_id: string;
  snapshot_at: string;
  total_sales_dishes: number;
  fully_linked: number;
  coverage_pct: number;
  /** Count of dishes with no components. */
  unlinked: number;
  /** Count of dishes with declaration but no components. */
  declared_only: number;
  uncovered_dish_names: string[];
  created_by: string;
}

/**
 * Read the most recent dish coverage snapshot for a location.
 * Returns null when no snapshot exists yet (first deploy / fresh DB).
 */
export function readLatestDishCoverageSnapshot(
  locationId: string = 'default',
): HydratedCoverageSnapshot | null {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT * FROM dish_coverage_snapshots
        WHERE location_id = ?
        ORDER BY id DESC
        LIMIT 1`,
    )
    .get(locationId) as DishCoverageSnapshot | undefined;

  if (!row) return null;

  let uncoveredNames: string[] = [];
  try {
    uncoveredNames = JSON.parse(row.uncovered_dishes);
  } catch {
    uncoveredNames = [];
  }

  return {
    id: row.id,
    location_id: row.location_id,
    snapshot_at: row.snapshot_at,
    total_sales_dishes: row.total_dishes,
    fully_linked: row.covered_dishes,
    coverage_pct: row.coverage_pct,
    // We don't have the declared_only vs unlinked split in the snapshot
    // table — surface the total uncovered count and zero out declared_only
    // for tile display purposes.
    unlinked: uncoveredNames.length,
    declared_only: 0,
    uncovered_dish_names: uncoveredNames,
    created_by: row.created_by,
  };
}
