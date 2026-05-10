import { getDb } from '../db.ts';
import { recomputeRecipeCosts } from './recipeCosting.ts';
import { recomputeMarginAnalysis } from './marginAnalysis.ts';
import {
  computeAccountingVariance,
  type AccountingVarianceOptions,
} from './accountingVariance.ts';

/**
 * Lariat Real-Time Compute Engine
 *
 * Orchestrator that recomputes recipe costs, menu-engineering margin
 * snapshots, and theoretical/actual COGS variance on demand (vs. the
 * nightly ingest), in response to live triggers such as a new
 * receiving log entry or a catch-weight seed run.
 *
 * See docs/ARCHITECTURE.md → "Real-time compute engine" for the full
 * pipeline and docs/PATTERNS.md → "fire-and-forget trigger" for how
 * callers should wire it.
 */
export interface TriggerComputeEngineOptions extends AccountingVarianceOptions {
  /**
   * Keep at most this many rows in `margin_snapshots` and
   * `accounting_variance` per location; older rows are deleted at the
   * end of this run. Set to 0 to disable pruning (unbounded growth;
   * only appropriate for ad-hoc analysis, not production).
   * Default: 365 (roughly a year of daily snapshots).
   */
  retainPerLocation?: number;
}

export function triggerComputeEngine(
  locationId: string = 'default',
  opts: TriggerComputeEngineOptions = {},
) {
  const db = getDb();

  // 1. Re-evaluate batch costs and cost-per-serving for every recipe.
  recomputeRecipeCosts(db, locationId);

  // 2. Refresh Menu Engineering quadrants (Star / Puzzle / Plowhorse
  //    / Dog) and persist as a margin snapshot.
  recomputeMarginAnalysis(db, locationId);

  // 3. Reconcile theoretical vs actual COGS for the given window
  //    (defaults to current calendar month in accountingVariance).
  computeAccountingVariance(db, locationId, opts);

  // 4. Retention: both snapshot tables grow linearly with the trigger
  //    rate (docs/COMPUTE_ENGINE_REVIEW I2). Prune to the N most recent
  //    rows per location. Bounded at ~365 by default — enough to
  //    reconstruct a year of daily snapshots for audit while keeping
  //    the table scannable.
  const retain = opts.retainPerLocation ?? 365;
  if (retain > 0) {
    pruneSnapshotTable(db, 'margin_snapshots', locationId, retain);
    pruneSnapshotTable(db, 'accounting_variance', locationId, retain);
  }
}

function pruneSnapshotTable(
  db: ReturnType<typeof getDb>,
  table: 'margin_snapshots' | 'accounting_variance',
  locationId: string,
  retain: number,
): void {
  // Idempotent — harmless no-op if fewer than `retain` rows exist.
  db.prepare(
    `DELETE FROM ${table}
      WHERE location_id = ?
        AND id NOT IN (
          SELECT id FROM ${table}
           WHERE location_id = ?
           ORDER BY id DESC
           LIMIT ?
        )`,
  ).run(locationId, locationId, retain);
}

/**
 * Read the most recent `accounting_variance` row for a location, or
 * `null` when no computation has run yet. Used by the costing page
 * dashboard tile.
 */
export function readLatestAccountingVariance(
  db: ReturnType<typeof getDb>,
  locationId: string,
): {
  theoretical_cogs: number;
  actual_cogs: number;
  variance_amount: number;
  variance_pct: number;
  snapshot_at: string;
} | null {
  return (
    (db
      .prepare(
        `SELECT theoretical_cogs, actual_cogs, variance_amount, variance_pct, snapshot_at
           FROM accounting_variance
          WHERE location_id = ?
          ORDER BY id DESC LIMIT 1`,
      )
      .get(locationId) as {
      theoretical_cogs: number;
      actual_cogs: number;
      variance_amount: number;
      variance_pct: number;
      snapshot_at: string;
    } | undefined) ?? null
  );
}

export {
  recomputeRecipeCosts,
  recomputeMarginAnalysis,
  computeAccountingVariance,
};
