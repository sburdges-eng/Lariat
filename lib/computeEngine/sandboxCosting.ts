import { getDb } from '../db';
import { normalizeUnit, convertQty, unitDimension } from '../unitConvert.mjs';
import { normalizeIngredientKey } from '../ingredientKey';

export interface SandboxIngredient {
  item: string;
  qty: number;
  unit: string;
}

export interface SandboxCostLine {
  item: string;
  req_qty?: number;
  req_unit?: string;
  match?: string | null;
  pack_price?: number | null;
  pack_size?: number | null;
  pack_unit?: string | null;
  cost: number | null;
  note?: string;
}

export interface SandboxCostResult {
  totalCost: number;
  breakdown: SandboxCostLine[];
  /**
   * True when at least one ingredient was refused (null cost). The
   * caller SHOULD surface this — a partial total without flagging
   * missing rows misleads operators. See docs/COMPUTE_ENGINE_REVIEW R2-C5.
   */
  partial: boolean;
}

/**
 * Ad-hoc recipe costing for the Kitchen Assistant's Specials sandbox.
 *
 * Given a list of `{item, qty, unit}` from the LLM's
 * `cost_special` action, return per-ingredient costs plus a total.
 *
 * R2-C5 / I5: cross-dimensional conversions (e.g. `1 cup` of flour
 * when the vendor sells by `lb`) require a real density. The old
 * implementation passed `gPerMl = 1.0` unconditionally, which silently
 * produced wrong answers for any non-water ingredient (flour ≈ 0.53
 * g/ml, oil ≈ 0.92, onion ≈ 0.56). We now look up
 * `ingredient_densities.g_per_ml` by the same normalized key the
 * costing ingest uses, and refuse cross-dim conversions when no
 * density row exists — the breakdown row returns `cost: null` with a
 * note, and `partial = true` flags the aggregate.
 */
export function computeSandboxCost(
  locationId: string,
  ingredients: SandboxIngredient[],
): SandboxCostResult {
  const db = getDb();
  const densityStmt = db.prepare(
    `SELECT g_per_ml FROM ingredient_densities WHERE ingredient_key = ?`,
  );
  const vendorStmt = db.prepare(
    `SELECT ingredient, pack_price, pack_size, pack_unit,
            COALESCE(yield_pct, 1.0) AS yield_pct
       FROM vendor_prices
      WHERE location_id = ? AND ingredient LIKE ?
      ORDER BY imported_at DESC, id DESC
      LIMIT 1`,
  );

  let totalCost = 0;
  const breakdown: SandboxCostLine[] = [];
  let partial = false;

  for (const ing of ingredients) {
    const rawUnit = normalizeUnit(ing.unit) || 'ea';
    const qty = Number(ing.qty);
    if (!Number.isFinite(qty) || qty <= 0) {
      breakdown.push({ item: ing.item, cost: null, note: 'Invalid quantity' });
      partial = true;
      continue;
    }

    const row = vendorStmt.get(locationId, `%${ing.item}%`) as
      | {
          ingredient: string;
          pack_price: number;
          pack_size: number;
          pack_unit: string;
          yield_pct: number;
        }
      | undefined;

    if (!row) {
      breakdown.push({
        item: ing.item,
        req_qty: qty,
        req_unit: rawUnit,
        cost: null,
        note: 'No vendor match',
      });
      partial = true;
      continue;
    }

    const packUnit = normalizeUnit(row.pack_unit);
    const isCrossDim =
      unitDimension(rawUnit) !== unitDimension(packUnit) &&
      rawUnit !== packUnit;

    // Density lookup: use the vendor ingredient's normalized key so the
    // sandbox pulls the same gram/ml rate as the rest of the costing
    // pipeline. Missing → null → convertQty refuses cross-dim.
    let gPerMl: number | null = null;
    if (isCrossDim) {
      const key = normalizeIngredientKey(row.ingredient);
      const d = key ? (densityStmt.get(key) as { g_per_ml: number } | undefined) : undefined;
      if (d && Number.isFinite(d.g_per_ml) && d.g_per_ml > 0) {
        gPerMl = d.g_per_ml;
      }
    }

    const convertedQty = convertQty(qty, rawUnit, packUnit, gPerMl ?? undefined);

    if (convertedQty === null) {
      // Distinguish the "cross-dim, no density" case from a plain unit
      // mismatch so operators know whether to add a density row or
      // whether the units genuinely don't align.
      const note = isCrossDim
        ? `No density for "${row.ingredient}" — cross-dim conversion refused (${rawUnit} ↔ ${packUnit})`
        : `Unit mismatch: ${rawUnit} vs vendor ${packUnit}`;
      breakdown.push({
        item: ing.item,
        req_qty: qty,
        req_unit: rawUnit,
        match: row.ingredient,
        cost: null,
        note,
      });
      partial = true;
      continue;
    }

    const cost = ((convertedQty / row.pack_size) * row.pack_price) / row.yield_pct;
    totalCost += cost;

    breakdown.push({
      item: ing.item,
      req_qty: qty,
      req_unit: rawUnit,
      match: row.ingredient,
      pack_price: row.pack_price,
      pack_size: row.pack_size,
      pack_unit: packUnit,
      cost,
    });
  }

  return { totalCost, breakdown, partial };
}
