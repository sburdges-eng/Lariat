// Per-line + blended food-cost for catering estimate line items, derived from
// the existing dish-cost bridge (dish_components -> recipe_costs / vendor_prices).
//
// Operator-only, read-only. Wraps computeDishCost once per line, reusing a single
// buildDishComponentMap pass. Food-cost % is a directional operator estimate: it
// divides a dish-serving cost by a platter/per-person sell price, so it is labeled
// ">=" upstream and carries the link_state. Lines that aren't linked yet surface
// honestly (cost null, counted in blended.unlinkedCount) rather than silently 0.
import type { Database } from 'better-sqlite3';
import { buildDishComponentMap, computeDishCost } from './dishCostBridge.ts';
import { getDb } from './db.ts';

export interface LineFoodCost {
  id: number; // beo_line_items.id
  cost: number | null; // computeDishCost total_cost (per serving); null if unlinked
  link_state: 'unlinked' | 'declared_only' | 'partial' | 'fully_linked';
  // cost / unit_cost, only when unit_cost > 0 and the line is at least partially
  // linked; null otherwise (unlinked / declared-only / no sell price).
  food_cost_pct: number | null;
}

export interface BlendedFoodCost {
  // Sigma(cost·qty) / Sigma(sell·qty) over costed lines only; null if none costed.
  pct: number | null;
  costedCount: number;
  unlinkedCount: number;
}

interface FoodCostLineInput {
  id: number;
  item_name: string;
  unit_cost?: number | null;
  quantity?: number | null;
}

export function computeLineFoodCosts(
  lineItems: FoodCostLineInput[],
  locationId: string,
  db: Database = getDb(),
): { perLine: LineFoodCost[]; blended: BlendedFoodCost } {
  // One pass: build the component map once, reuse across every line.
  const map = buildDishComponentMap(locationId, undefined, db);

  const perLine: LineFoodCost[] = [];
  let costedNum = 0;
  let costedDen = 0;
  let costedCount = 0;
  let unlinkedCount = 0;

  for (const li of lineItems) {
    const r = computeDishCost(li.item_name, locationId, map, undefined, db);
    const cost = r.total_cost;
    const unitCost = Number(li.unit_cost ?? 0);
    const qty = Number(li.quantity ?? 0);
    const linked = r.link_state === 'partial' || r.link_state === 'fully_linked';
    const food_cost_pct =
      cost != null && unitCost > 0 && linked ? cost / unitCost : null;

    perLine.push({ id: li.id, cost, link_state: r.link_state, food_cost_pct });

    if (cost != null) {
      costedCount += 1;
      costedNum += cost * qty;
      costedDen += unitCost * qty;
    } else {
      unlinkedCount += 1;
    }
  }

  const pct = costedDen > 0 ? costedNum / costedDen : null;
  return { perLine, blended: { pct, costedCount, unlinkedCount } };
}
