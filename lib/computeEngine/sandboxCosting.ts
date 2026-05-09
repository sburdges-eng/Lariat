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

interface VendorRow {
  ingredient: string;
  pack_price: number;
  pack_size: number;
  pack_unit: string;
  yield_pct: number;
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
 *
 * Audit §4 (perf): the previous implementation ran a
 * `WHERE ingredient LIKE '%X%'` SELECT against `vendor_prices` ONCE
 * PER INGREDIENT in the LLM's payload. With thousands of vendor rows
 * and the Kitchen Assistant firing on every specials submission this
 * was an O(N) SQLite roundtrip per ingredient. We now pull the
 * location-scoped vendor list once (newest-first ordering preserved)
 * and look up via an exact-lowercase Map for O(1) hits with an
 * in-memory linear fallback for substring matches. Behavior is
 * unchanged: the original `LIMIT 1` after `ORDER BY imported_at
 * DESC, id DESC` is mirrored by "first row in the pre-sorted array
 * wins per ingredient name" plus "first substring hit wins on
 * fallback." This is sandbox-local on purpose — the matching
 * semantics here (substring against vendor.ingredient) differ from
 * `lib/costingBenchmarks.mjs::computeCostVariance` (exact normalized-
 * ingredient-key match), so the existing helper's `vpByKey` Map
 * doesn't fit. See task brief.
 */
export function computeSandboxCost(
  locationId: string,
  ingredients: SandboxIngredient[],
): SandboxCostResult {
  const db = getDb();
  const densityStmt = db.prepare(
    `SELECT g_per_ml FROM ingredient_densities WHERE ingredient_key = ?`,
  );

  // Pull all vendor_prices for the location ONCE, newest-first. Same
  // ORDER BY the pre-fix per-call SELECT used, so "newest row wins"
  // semantics carry over: when we walk the array on substring fallback
  // (and when we populate the exact-match Map below) the first row we
  // see per ingredient name IS the most recent.
  const vendorRows = db
    .prepare(
      `SELECT ingredient, pack_price, pack_size, pack_unit,
              COALESCE(yield_pct, 1.0) AS yield_pct
         FROM vendor_prices
        WHERE location_id = ?
        ORDER BY imported_at DESC, id DESC`,
    )
    .all(locationId) as VendorRow[];

  // Exact-lowercase Map: O(1) lookup for the common case where the
  // LLM-provided ingredient matches a vendor row verbatim. First-seen
  // wins, which means the newest row wins because of the ORDER BY
  // above.
  const vendorByLowerName = new Map<string, VendorRow>();
  for (const v of vendorRows) {
    const key = (v.ingredient ?? '').toLowerCase();
    if (key && !vendorByLowerName.has(key)) vendorByLowerName.set(key, v);
  }

  function lookupVendor(item: string): VendorRow | undefined {
    const lower = (item ?? '').toLowerCase();
    if (!lower) return undefined;
    // 1. Exact lowercase hit — O(1).
    const exact = vendorByLowerName.get(lower);
    if (exact) return exact;
    // 2. Substring fallback — O(N) but in-memory, no SQLite roundtrip.
    //    Mirrors the pre-fix `WHERE ingredient LIKE '%X%'` semantics:
    //    the LLM-provided `item` is the SUBSTRING and the vendor row's
    //    `ingredient` is the HAYSTACK. First row wins; vendorRows is
    //    ordered newest-first so that's the latest match.
    return vendorRows.find((v) =>
      (v.ingredient ?? '').toLowerCase().includes(lower),
    );
  }

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

    const row = lookupVendor(ing.item);

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

    // Density lookup: use the LLM-provided `ing.item` (a clean
    // ingredient name like "flour" / "olive oil") rather than the
    // vendor row's `ingredient` string. The densities seed CSV uses
    // clean names (data/seeds/ingredient_densities.csv → "olive oil",
    // "buttermilk") which get stored under `normalizeIngredientKey`
    // output; vendor rows carry brand/pack noise ("OLIVE OIL 5GAL",
    // "EVOO VIRGIN") which doesn't normalize to the same key. Fall
    // back to the vendor string when the clean name produces no hit —
    // some vendor rows happen to be clean enough to match.
    let gPerMl: number | null = null;
    if (isCrossDim) {
      for (const candidate of [ing.item, row.ingredient]) {
        const key = normalizeIngredientKey(candidate ?? '');
        if (!key) continue;
        const d = densityStmt.get(key) as { g_per_ml: number } | undefined;
        if (d && Number.isFinite(d.g_per_ml) && d.g_per_ml > 0) {
          gPerMl = d.g_per_ml;
          break;
        }
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
