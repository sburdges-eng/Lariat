/**
 * Sales-driven inventory depletion (Phase 3).
 *
 * When Toast tells us "we sold 3 Baja Tacos," the system needs to debit
 * the BOM-equivalent ingredients from inventory automatically. Today
 * inventory only moves on a manual waste-log entry; this module wires
 * the missing automatic path.
 *
 * The resolver is split into TWO layers:
 *
 *   1. Pure resolver (`resolveDepletionsForSale`)
 *      sales line + dish_components + bom_lines + entities_recipes
 *        → list of (ingredient, qty, unit, breakdown) depletion rows.
 *      No DB writes; pure read + math. Easy to unit-test.
 *
 *   2. Applier (`applyDepletionsForPeriod`)
 *      Wraps the resolver in a single transaction per (location, period),
 *      writes inventory_updates + audit_events, records a row in
 *      sales_depletion_runs.
 *
 * Resolution chain for one sales line:
 *
 *   sales_lines.item_name (e.g. "Baja Taco")
 *     ↓ case/whitespace-insensitive match
 *   dish_components rows for this dish + location
 *     ↓ for each row:
 *       component_type='vendor_item'  → emit one depletion of
 *           qty_per_serving × quantity_sold of vendor_ingredient
 *       component_type='recipe'       → look up the recipe yield in
 *           entities_recipes, expand bom_lines, scale by
 *           (qty_per_serving / yield_qty) × quantity_sold
 *
 * Unit conversion: when a recipe's yield_unit and the dish_components
 * unit differ but share a dimension (both volume / both weight), we
 * convert via lib/unitConvert.mjs::convertQty(). Cross-dimension
 * conversions (volume ↔ weight) need a density and are reported as
 * `skipped: cross_dim_unit_mismatch` for now — operators can fill in
 * a density via ingredient_densities to unblock those.
 *
 * Shrinkage: bom_lines.loss_factor is honoured exactly as the existing
 * inventoryShrinkage module does — raw_qty = cooked_qty / (1 - loss).
 * The depletion always records the RAW qty (what actually leaves the
 * walk-in), so a 25%-shrink dish with 8oz cooked beef debits 10.667oz.
 */

import type { Database } from 'better-sqlite3';
import { convertQty, normalizeUnit, unitDimension } from './unitConvert.mjs';
import { applyShrinkage, formatDepletionDelta } from './inventoryShrinkage';
import { postAuditEvent } from './auditEvents';

// ── Types ──────────────────────────────────────────────────────────

export type DepletionSourceKind = 'vendor_item' | 'recipe_ingredient';

export interface ResolvedDepletion {
  /** Vendor ingredient name (raw text from dish_components or bom_lines). */
  ingredient: string;
  /** Quantity to debit (already × quantity_sold; already shrinkage-adjusted). */
  qty: number;
  /** Unit string for the qty above. */
  unit: string | null;
  /** Where this row came from in the dish_components / bom_lines chain. */
  source: DepletionSourceKind;
  /** Human-readable breakdown for the inventory_updates.note field. */
  breakdown: string;
  /** True iff inventoryShrinkage.applyShrinkage actually fired. */
  shrinkage_applied: boolean;
}

export interface UnresolvedDish {
  dish_name: string;
  reason:
    | 'no_dish_components'
    | 'recipe_missing_yield'
    | 'cross_dim_unit_mismatch'
    | 'unknown_unit'
    | 'invalid_qty';
  detail: string | null;
}

export interface ResolveResult {
  depletions: ResolvedDepletion[];
  unresolved: UnresolvedDish[];
}

// ── Pure resolver ──────────────────────────────────────────────────

interface DishComponentRow {
  component_type: 'recipe' | 'vendor_item';
  recipe_slug: string | null;
  vendor_ingredient: string | null;
  qty_per_serving: number;
  unit: string;
}

interface BomLineRow {
  ingredient: string;
  qty: number | null;
  unit: string | null;
  loss_factor: number | null;
}

interface RecipeYield {
  yield_qty: number | null;
  yield_unit: string | null;
}

function fetchDishComponents(
  db: Database,
  dish_name: string,
  location_id: string,
): DishComponentRow[] {
  return db
    .prepare(
      `SELECT component_type, recipe_slug, vendor_ingredient,
              qty_per_serving, unit
         FROM dish_components
        WHERE LOWER(TRIM(dish_name)) = LOWER(TRIM(?))
          AND location_id = ?`,
    )
    .all(dish_name, location_id) as DishComponentRow[];
}

function fetchRecipeYield(
  db: Database,
  slug: string,
  location_id: string,
): RecipeYield | null {
  // Prefer entities_recipes (Phase-2 canonical source). Fall back to
  // recipes via slug match in case the entity layer hasn't been
  // backfilled for this location yet.
  const row = db
    .prepare(
      `SELECT yield_qty, yield_unit FROM entities_recipes
        WHERE slug = ? AND location_id = ? LIMIT 1`,
    )
    .get(slug, location_id) as RecipeYield | undefined;
  return row ?? null;
}

function fetchBomLines(
  db: Database,
  recipe_slug: string,
  location_id: string,
): BomLineRow[] {
  // bom_lines.recipe_id stores the slug in this codebase (per CLAUDE.md
  // architecture notes). loss_factor was added in T1 and is nullable.
  return db
    .prepare(
      `SELECT ingredient, qty, unit, loss_factor
         FROM bom_lines
        WHERE recipe_id = ? AND location_id = ?
          AND ingredient IS NOT NULL AND TRIM(ingredient) != ''`,
    )
    .all(recipe_slug, location_id) as BomLineRow[];
}

/**
 * Resolve one sales line into a list of ingredient depletions.
 *
 * Returns both `depletions` (write-ready rows) and `unresolved` (dishes
 * we know about but couldn't fully expand — usually missing
 * dish_components or a unit-conversion edge case). The CLI surfaces the
 * unresolved list so operators know which dish_components rows to fill
 * in to close the gap.
 *
 * `quantity_sold` is the multiplier from the POS line — typically a
 * non-negative integer count of dish servings sold.
 */
export function resolveDepletionsForSale(
  db: Database,
  input: {
    dish_name: string;
    quantity_sold: number;
    location_id: string;
  },
): ResolveResult {
  const { dish_name, quantity_sold, location_id } = input;
  const result: ResolveResult = { depletions: [], unresolved: [] };

  if (!Number.isFinite(quantity_sold) || quantity_sold <= 0) {
    result.unresolved.push({
      dish_name,
      reason: 'invalid_qty',
      detail: `quantity_sold=${quantity_sold}`,
    });
    return result;
  }

  const components = fetchDishComponents(db, dish_name, location_id);
  if (components.length === 0) {
    result.unresolved.push({
      dish_name,
      reason: 'no_dish_components',
      detail: null,
    });
    return result;
  }

  for (const c of components) {
    if (c.component_type === 'vendor_item') {
      if (!c.vendor_ingredient) continue;
      const totalQty = c.qty_per_serving * quantity_sold;
      result.depletions.push({
        ingredient: c.vendor_ingredient,
        qty: totalQty,
        unit: c.unit,
        source: 'vendor_item',
        breakdown:
          `${quantity_sold} × ${dish_name} × ${c.qty_per_serving}${c.unit} ` +
          `${c.vendor_ingredient} = ${totalQty}${c.unit}`,
        shrinkage_applied: false,
      });
      continue;
    }

    // component_type === 'recipe'
    if (!c.recipe_slug) continue;
    const yieldRow = fetchRecipeYield(db, c.recipe_slug, location_id);
    if (
      !yieldRow ||
      yieldRow.yield_qty == null ||
      !yieldRow.yield_unit ||
      yieldRow.yield_qty <= 0
    ) {
      result.unresolved.push({
        dish_name,
        reason: 'recipe_missing_yield',
        detail: c.recipe_slug,
      });
      continue;
    }

    // Convert qty_per_serving (in dish_components.unit) into recipe yield_unit
    // so the ratio (qty_per_serving / yield_qty) is dimensionally honest.
    const ratio = computeRecipeRatio({
      portionQty: c.qty_per_serving,
      portionUnit: c.unit,
      yieldQty: yieldRow.yield_qty,
      yieldUnit: yieldRow.yield_unit,
    });
    if (ratio == null) {
      result.unresolved.push({
        dish_name,
        reason: 'cross_dim_unit_mismatch',
        detail: `${c.qty_per_serving}${c.unit} → ${yieldRow.yield_unit} for ${c.recipe_slug}`,
      });
      continue;
    }

    const bom = fetchBomLines(db, c.recipe_slug, location_id);
    if (bom.length === 0) {
      // Recipe has yield but no BOM — nothing to deplete. Not an error
      // per se; surface as unresolved so operators see the gap.
      result.unresolved.push({
        dish_name,
        reason: 'no_dish_components',
        detail: `recipe=${c.recipe_slug} has zero bom_lines`,
      });
      continue;
    }

    for (const line of bom) {
      if (line.qty == null || !Number.isFinite(line.qty) || line.qty <= 0) continue;
      const cookedQty = ratio * line.qty * quantity_sold;
      const shrink = applyShrinkage(cookedQty, line.loss_factor, line.unit);
      result.depletions.push({
        ingredient: line.ingredient,
        qty: shrink.raw_qty,
        unit: shrink.unit,
        source: 'recipe_ingredient',
        breakdown:
          `${quantity_sold} × ${dish_name} → ${c.recipe_slug} ` +
          `(${c.qty_per_serving}${c.unit}/${yieldRow.yield_qty}${yieldRow.yield_unit}) ` +
          `× ${line.qty}${line.unit} ${line.ingredient}` +
          (shrink.applied
            ? ` × shrinkage(${(shrink.loss_factor as number).toFixed(2)}) = ${shrink.raw_qty.toFixed(3)}${line.unit}`
            : ` = ${cookedQty.toFixed(3)}${line.unit}`),
        shrinkage_applied: shrink.applied,
      });
    }
  }

  return result;
}

/**
 * Compute the dimensionless ratio "how much of a recipe's yield is one
 * serving of this dish." `null` when the conversion isn't well-defined.
 *
 * Same-dim case is handled via convertQty(); identity short-circuits.
 * Cross-dim (volume↔weight) returns null because we'd need a density,
 * which we don't carry on dish_components / entities_recipes today.
 * Operators get a clear `cross_dim_unit_mismatch` unresolved row.
 *
 * Exposed for tests; not used outside this module.
 */
export function computeRecipeRatio(input: {
  portionQty: number;
  portionUnit: string | null;
  yieldQty: number;
  yieldUnit: string;
}): number | null {
  const { portionQty, portionUnit, yieldQty, yieldUnit } = input;
  if (!Number.isFinite(portionQty) || portionQty <= 0) return null;
  if (!Number.isFinite(yieldQty) || yieldQty <= 0) return null;

  const pn = normalizeUnit(portionUnit ?? '');
  const yn = normalizeUnit(yieldUnit);
  if (pn === yn) return portionQty / yieldQty;

  const pd = unitDimension(pn);
  const yd = unitDimension(yn);
  if (!pd || !yd || pd !== yd) return null;

  // Same dimension, different unit: convert portion into yield unit.
  const portionInYield = convertQty(portionQty, pn, yn, null);
  if (portionInYield == null) return null;
  return portionInYield / yieldQty;
}

// ── DB Applier ─────────────────────────────────────────────────────

export interface ApplyResult {
  /** Whether a write actually happened (false on dry-run or skipped). */
  applied: boolean;
  /** Reason for skipping when applied=false. */
  skip_reason?: 'dry_run' | 'already_applied';
  /** sales_depletion_runs row id (only when applied=true). */
  run_id?: number;
  sales_rows_processed: number;
  depletions_written: number;
  unresolved_count: number;
  unresolved_sample: UnresolvedDish[];
}

interface ApplyOptions {
  location_id: string;
  period_label: string;
  /** YYYY-MM-DD stamp for the resulting inventory_updates rows. */
  shift_date: string;
  apply: boolean;
  /** When true, allow a re-run even if (location, period) already in
   *  sales_depletion_runs. inventory_updates rows from prior runs are
   *  NOT deleted — operators must clean those up by hand. */
  force?: boolean;
  /** Cap how many unresolved dishes to return in the result for the
   *  CLI report. Default 25. */
  unresolvedSample?: number;
}

/**
 * Apply depletion for every row of sales_lines matching
 * (location_id, period_label). Uses one outer transaction so a partial
 * failure rolls back the inventory_updates rows along with the
 * sales_depletion_runs entry.
 */
export function applyDepletionsForPeriod(
  db: Database,
  opts: ApplyOptions,
): ApplyResult {
  const sampleCap = opts.unresolvedSample ?? 25;

  // Skip-if-already-run check (outside the transaction so we can return
  // a clean ApplyResult without touching the DB).
  if (!opts.force) {
    const existing = db
      .prepare(
        `SELECT id FROM sales_depletion_runs
          WHERE location_id = ? AND period_label = ?
          ORDER BY id DESC LIMIT 1`,
      )
      .get(opts.location_id, opts.period_label) as { id: number } | undefined;
    if (existing) {
      return {
        applied: false,
        skip_reason: 'already_applied',
        run_id: existing.id,
        sales_rows_processed: 0,
        depletions_written: 0,
        unresolved_count: 0,
        unresolved_sample: [],
      };
    }
  }

  const sales = db
    .prepare(
      `SELECT item_name, quantity_sold FROM sales_lines
        WHERE period_label = ? AND location_id = ?
          AND quantity_sold > 0
          AND item_name IS NOT NULL AND TRIM(item_name) != ''`,
    )
    .all(opts.period_label, opts.location_id) as Array<{
      item_name: string;
      quantity_sold: number;
    }>;

  // Resolve all depletions BEFORE any writes so the transaction is a
  // single atomic block.
  const allDepletions: Array<{ row: ResolvedDepletion; from: string }> = [];
  const allUnresolved: UnresolvedDish[] = [];
  for (const s of sales) {
    const r = resolveDepletionsForSale(db, {
      dish_name: s.item_name,
      quantity_sold: s.quantity_sold,
      location_id: opts.location_id,
    });
    for (const d of r.depletions) {
      allDepletions.push({ row: d, from: s.item_name });
    }
    allUnresolved.push(...r.unresolved);
  }

  if (!opts.apply) {
    return {
      applied: false,
      skip_reason: 'dry_run',
      sales_rows_processed: sales.length,
      depletions_written: allDepletions.length,
      unresolved_count: allUnresolved.length,
      unresolved_sample: allUnresolved.slice(0, sampleCap),
    };
  }

  const writeResult = db.transaction(() => {
    const runInfo = db
      .prepare(
        `INSERT INTO sales_depletion_runs
           (location_id, period_label, shift_date,
            sales_rows_processed, depletions_written, unresolved_dish_count)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        opts.location_id,
        opts.period_label,
        opts.shift_date,
        sales.length,
        allDepletions.length,
        allUnresolved.length,
      );
    const runId = Number(runInfo.lastInsertRowid);

    const insertInv = db.prepare(
      `INSERT INTO inventory_updates
         (shift_date, station_id, item, delta, direction, note, cook_id, location_id)
       VALUES (?, NULL, ?, ?, 'out', ?, NULL, ?)`,
    );

    for (const { row, from } of allDepletions) {
      const delta = formatDepletionDelta(row.qty, row.unit);
      const note = `[deplete-run=${runId}] from "${from}": ${row.breakdown}`;
      const info = insertInv.run(
        opts.shift_date,
        row.ingredient,
        delta,
        note,
        opts.location_id,
      );
      postAuditEvent({
        entity: 'inventory_updates',
        entity_id: Number(info.lastInsertRowid),
        action: 'insert',
        actor_cook_id: null,
        actor_source: 'sales_depletion',
        location_id: opts.location_id,
        shift_date: opts.shift_date,
        payload: {
          run_id: runId,
          dish_name: from,
          ingredient: row.ingredient,
          delta,
          shrinkage_applied: row.shrinkage_applied,
          source: row.source,
        },
      });
    }
    return { runId };
  })();

  return {
    applied: true,
    run_id: writeResult.runId,
    sales_rows_processed: sales.length,
    depletions_written: allDepletions.length,
    unresolved_count: allUnresolved.length,
    unresolved_sample: allUnresolved.slice(0, sampleCap),
  };
}
