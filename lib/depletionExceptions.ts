/**
 * Depletion exception queue (Phase 1 — operator triage).
 *
 * `applyDepletionsForPeriod()` (lib/salesDepletion.ts) auto-runs from
 * the analytics ingest and successfully drains every Toast sales line
 * whose dish_name resolves through `dish_components`. Lines that DON'T
 * resolve get returned in the per-run `unresolved_sample` and the count
 * is recorded on `sales_depletion_runs.unresolved_dish_count`, but the
 * actual dish names aren't persisted. That's fine for the run summary,
 * but it leaves operators without a way to ask "what's currently broken
 * in my menu→inventory bridge?"
 *
 * This module is the read-side answer. Given (location, optional
 * period_label), it scans `sales_lines`, replays the pure resolver
 * against current `dish_components` for each unique dish, and returns
 * the dishes that still come back `unresolved` — aggregated by impact
 * (sales count, quantity, net_sales). The triage UI at
 * /costing/depletion-exceptions consumes the result; resolution
 * happens via the existing `/api/dish-components` editor (no new
 * mutation surface here).
 *
 * Contract:
 *   - Pure read (no DB writes) — safe to call from server components.
 *   - Probes the resolver with quantity_sold=1 to detect mapping shape;
 *     rows with NO unresolved entries are filtered out entirely.
 *   - Aggregation is by `dish_name` (case-insensitive deduped), preserving
 *     the original casing from the highest-volume sales row.
 */

import type { Database } from 'better-sqlite3';
import {
  resolveDepletionsForSale,
  type UnresolvedDish,
} from './salesDepletion.ts';

export interface DepletionException {
  /** Original dish_name as recorded on sales_lines. */
  dish_name: string;
  /** Most-significant unresolved reason (first emitted by the resolver). */
  reason: UnresolvedDish['reason'];
  /** Resolver-supplied detail string for that reason (sub-recipe slug, unit, etc.). */
  detail: string | null;
  /** How many sales_lines rows aggregated under this dish. */
  affected_sales_count: number;
  /** Sum of quantity_sold across those rows. */
  total_quantity_sold: number;
  /** Sum of net_sales across those rows (NULL if every row was NULL). */
  total_net_sales: number | null;
  /** Newest imported_at in the aggregate (ISO string from sales_lines). */
  latest_imported_at: string | null;
  /** Up to 5 distinct period_label values, newest-first by sample. */
  sample_period_labels: string[];
}

export interface ListExceptionsOptions {
  location_id: string;
  /** When set, restrict the scan to one period_label (e.g. '2025-W42'). */
  period_label?: string | null;
  /** Cap on returned rows (default 200). */
  limit?: number;
}

interface SalesAggRow {
  item_name: string;
  affected_sales_count: number;
  total_quantity_sold: number;
  total_net_sales: number | null;
  latest_imported_at: string | null;
  sample_period_labels: string | null;
}

export function listDepletionExceptions(
  db: Database,
  opts: ListExceptionsOptions,
): DepletionException[] {
  const limit = Math.max(1, Math.min(1000, opts.limit ?? 200));

  const params: Array<string | number> = [opts.location_id];
  let where = `location_id = ?
      AND quantity_sold > 0
      AND item_name IS NOT NULL
      AND TRIM(item_name) != ''`;
  if (opts.period_label) {
    where += ` AND period_label = ?`;
    params.push(opts.period_label);
  }

  const aggSql = `
    WITH sales AS (
      SELECT LOWER(TRIM(item_name)) AS item_key,
             TRIM(item_name)        AS item_name,
             quantity_sold,
             net_sales,
             imported_at,
             period_label
        FROM sales_lines
       WHERE ${where}
    ),
    display_names AS (
      SELECT item_key,
             item_name
        FROM (
          SELECT item_key,
                 item_name,
                 ROW_NUMBER() OVER (
                   PARTITION BY item_key
                   ORDER BY quantity_sold DESC,
                            COALESCE(net_sales, 0) DESC,
                            item_name ASC
                 ) AS display_rank
            FROM sales
        )
       WHERE display_rank = 1
    ),
    aggregates AS (
      SELECT item_key,
             COUNT(*)                AS affected_sales_count,
             SUM(quantity_sold)      AS total_quantity_sold,
             SUM(net_sales)          AS total_net_sales,
             MAX(imported_at)        AS latest_imported_at,
             GROUP_CONCAT(DISTINCT period_label) AS sample_period_labels
        FROM sales
       GROUP BY item_key
    )
    SELECT display_names.item_name,
           aggregates.affected_sales_count,
           aggregates.total_quantity_sold,
           aggregates.total_net_sales,
           aggregates.latest_imported_at,
           aggregates.sample_period_labels
      FROM aggregates
      JOIN display_names ON display_names.item_key = aggregates.item_key
     ORDER BY COALESCE(aggregates.total_net_sales, 0) DESC,
              aggregates.total_quantity_sold DESC
  `;

  const rows = db.prepare(aggSql).all(...params) as SalesAggRow[];

  const exceptions: DepletionException[] = [];
  for (const r of rows) {
    const result = resolveDepletionsForSale(db, {
      dish_name: r.item_name,
      quantity_sold: 1,
      location_id: opts.location_id,
    });
    const first = result.unresolved[0];
    if (!first) continue;

    exceptions.push({
      dish_name: r.item_name,
      reason: first.reason,
      detail: first.detail,
      affected_sales_count: r.affected_sales_count,
      total_quantity_sold: Number(r.total_quantity_sold ?? 0),
      total_net_sales:
        r.total_net_sales == null ? null : Number(r.total_net_sales),
      latest_imported_at: r.latest_imported_at,
      sample_period_labels: r.sample_period_labels
        ? r.sample_period_labels.split(',').slice(0, 5)
        : [],
    });
    if (exceptions.length >= limit) break;
  }
  return exceptions;
}

/** Human-readable hint for each unresolved reason, surfaced in the UI. */
export const REASON_LABELS: Record<UnresolvedDish['reason'], string> = {
  no_dish_components: 'No dish_components mapping — add ingredients for this dish',
  recipe_missing_yield:
    'Sub-recipe missing yield — set yield_qty / yield_unit on the recipe',
  cross_dim_unit_mismatch:
    'Volume↔weight conversion needs a density — fill in ingredient_densities',
  unknown_unit: 'Unknown unit — fix the unit on dish_components or bom_lines',
  invalid_qty: 'Invalid quantity — qty_per_serving must be > 0',
};
