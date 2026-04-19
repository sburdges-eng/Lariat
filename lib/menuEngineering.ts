import { getDb } from './db';
import type { RecipeCost } from './db';

function norm(s: string | null | undefined): string {
  if (!s) return '';
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function findRecipeCost(byNorm: Map<string, RecipeCost>, itemNorm: string): RecipeCost | null {
  if (byNorm.has(itemNorm)) return byNorm.get(itemNorm)!;
  for (const [k, v] of byNorm) {
    if (itemNorm.includes(k) || k.includes(itemNorm)) return v;
  }
  return null;
}

export type Quadrant = 'star' | 'puzzle' | 'plowhorse' | 'dog' | 'unknown';

export interface MenuEngineeringRow {
  item_name: string;
  qty: number;
  net_sales: number;
  avg_price: number;
  recipe_id: string | null;
  cost_per_unit: number | null;
  margin_pct: number | null;
  popularity: number;
  quadrant?: Quadrant;
}

export interface MenuEngineeringResult {
  rows: MenuEngineeringRow[];
  medianMargin: number;
  medianPop: number;
}

export function computeMenuEngineering(locationId: string = 'default'): MenuEngineeringResult {
  const db = getDb();
  const sales = db
    .prepare(
      `SELECT item_name, SUM(quantity_sold) as qty, SUM(net_sales) as rev FROM sales_lines WHERE location_id = ? GROUP BY item_name`
    )
    .all(locationId) as { item_name: string; qty: number; rev: number }[];
  const costs = db
    .prepare(
      `SELECT recipe_id, recipe_name, cost_per_yield_unit, yield_unit FROM recipe_costs WHERE location_id = ?`
    )
    .all(locationId) as RecipeCost[];

  const byNorm = new Map<string, RecipeCost>();
  for (const c of costs) {
    const n = norm(c.recipe_name);
    if (n) byNorm.set(n, c);
  }

  const rows: MenuEngineeringRow[] = [];
  for (const s of sales) {
    const qty = Number(s.qty) || 0;
    const rev = Number(s.rev) || 0;
    const avg = qty > 0 ? rev / qty : 0;
    const itemNorm = norm(s.item_name);
    const rc = findRecipeCost(byNorm, itemNorm);
    const cpu = rc ? Number(rc.cost_per_yield_unit) || 0 : null;
    let marginPct: number | null = null;
    if (cpu != null && avg > 0) {
      marginPct = ((avg - cpu) / avg) * 100;
    }
    rows.push({
      item_name: s.item_name,
      qty,
      net_sales: rev,
      avg_price: avg,
      recipe_id: rc?.recipe_id ?? null,
      cost_per_unit: cpu,
      margin_pct: marginPct,
      popularity: qty,
    });
  }

  const maxQty = Math.max(0, ...rows.map((r) => r.qty));
  for (const r of rows) {
    r.popularity = maxQty > 0 ? r.qty / maxQty : 0;
  }

  const margins = rows
    .filter((r) => r.margin_pct != null && !Number.isNaN(r.margin_pct))
    .map((r) => r.margin_pct!);
  const medianMargin = margins.length ? margins.sort((a, b) => a - b)[Math.floor(margins.length / 2)] : 0;
  const pops = rows.map((r) => r.popularity).sort((a, b) => a - b);
  const medianPop = pops.length ? pops[Math.floor(pops.length / 2)] : 0.5;

  for (const r of rows) {
    const hiM = r.margin_pct != null && r.margin_pct >= medianMargin;
    const hiP = r.popularity >= medianPop;
    if (r.margin_pct == null) r.quadrant = 'unknown';
    else if (hiM && hiP) r.quadrant = 'star';
    else if (hiM && !hiP) r.quadrant = 'puzzle';
    else if (!hiM && hiP) r.quadrant = 'plowhorse';
    else r.quadrant = 'dog';
  }

  return { rows, medianMargin, medianPop };
}
