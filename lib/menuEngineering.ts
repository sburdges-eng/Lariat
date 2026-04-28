import { getDb } from './db';
import {
  buildDishComponentMap,
  cleanedSalesRows,
  computeDishCost,
  type DishComponentResolved,
} from './dishCostBridge';

/**
 * Menu engineering joins POS sales with dish-level cost via the
 * dish→recipe bridge in `lib/dishCostBridge.ts`.
 *
 * Cost source priority:
 *   1. dish_components rows + recipe_costs (true per-serving cost)
 *   2. nothing — surfaced as null. The prior fuzzy substring matcher
 *      against recipe_costs.recipe_name was structurally doomed because
 *      almost every recipe in this repo is a sub-recipe (sauces, batters,
 *      brines), not a dish.
 *
 * 'TOTAL' / 'TOTALS' rows from the Toast CSV footer are filtered before
 * any join math runs (cleanedSalesRows in lib/dishCostBridge).
 */

export type Quadrant = 'star' | 'puzzle' | 'plowhorse' | 'dog' | 'unknown';

export interface MenuEngineeringRow {
  item_name: string;
  qty: number;
  net_sales: number;
  avg_price: number;
  cost_per_unit: number | null;
  margin_pct: number | null;
  popularity: number;
  quadrant?: Quadrant;
  /** How the dish was linked. 'fully_linked' = clean costing; others surface gaps. */
  link_state: 'fully_linked' | 'partial' | 'declared_only' | 'unlinked';
  /** Components considered for this dish (empty when unlinked). */
  components: DishComponentResolved[];
}

export interface MenuEngineeringResult {
  rows: MenuEngineeringRow[];
  medianMargin: number;
  medianPop: number;
  /** Bridge-state counters useful for UI banner. */
  coverage: {
    fully_linked: number;
    partial: number;
    declared_only: number;
    unlinked: number;
    total: number;
  };
}

export function computeMenuEngineering(locationId: string = 'default'): MenuEngineeringResult {
  const db = getDb();
  const salesRaw = db
    .prepare(
      `SELECT item_name, SUM(quantity_sold) AS qty, SUM(net_sales) AS rev
         FROM sales_lines
        WHERE location_id = ?
        GROUP BY item_name`,
    )
    .all(locationId) as { item_name: string; qty: number; rev: number }[];
  const sales = cleanedSalesRows(salesRaw);

  // Build the bridge map ONCE; reuse for every dish.
  const map = buildDishComponentMap(locationId);

  const rows: MenuEngineeringRow[] = [];
  const counts = { fully_linked: 0, partial: 0, declared_only: 0, unlinked: 0, total: 0 };
  for (const s of sales) {
    counts.total++;
    const qty = Number(s.qty) || 0;
    const rev = Number(s.rev) || 0;
    const avg = qty > 0 ? rev / qty : 0;
    const dishCost = computeDishCost(s.item_name, locationId, map);
    const cpu = dishCost.total_cost;
    const marginPct = cpu != null && avg > 0 ? ((avg - cpu) / avg) * 100 : null;
    counts[dishCost.link_state]++;
    rows.push({
      item_name: s.item_name,
      qty,
      net_sales: rev,
      avg_price: avg,
      cost_per_unit: cpu,
      margin_pct: marginPct,
      popularity: qty,
      link_state: dishCost.link_state,
      components: dishCost.components,
    });
  }

  const maxQty = Math.max(0, ...rows.map((r) => r.qty));
  for (const r of rows) {
    r.popularity = maxQty > 0 ? r.qty / maxQty : 0;
  }

  const margins = rows
    .filter((r) => r.margin_pct != null && !Number.isNaN(r.margin_pct))
    .map((r) => r.margin_pct as number);
  const medianMargin = margins.length
    ? margins.sort((a, b) => a - b)[Math.floor(margins.length / 2)]!
    : 0;
  const pops = rows.map((r) => r.popularity).sort((a, b) => a - b);
  const medianPop = pops.length ? pops[Math.floor(pops.length / 2)]! : 0.5;

  for (const r of rows) {
    const hiM = r.margin_pct != null && r.margin_pct >= medianMargin;
    const hiP = r.popularity >= medianPop;
    if (r.margin_pct == null) r.quadrant = 'unknown';
    else if (hiM && hiP) r.quadrant = 'star';
    else if (hiM && !hiP) r.quadrant = 'puzzle';
    else if (!hiM && hiP) r.quadrant = 'plowhorse';
    else r.quadrant = 'dog';
  }

  return { rows, medianMargin, medianPop, coverage: counts };
}
