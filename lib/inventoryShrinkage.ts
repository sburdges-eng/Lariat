/**
 * T8 — Cooking-shrinkage math for inventory depletion.
 *
 * Toast sells cooked weight (e.g. 8 oz burger); raw inventory depletes at
 * the pre-cook equivalent (e.g. 10.667 oz at 25% loss). This module is the
 * pure-function layer — the API route (app/api/inventory/route.js) calls
 * `resolveCookingShrinkage` and then formats + persists the result.
 *
 * Design notes:
 *
 * - Loss factor lives on `bom_lines.loss_factor` (added in T1) per
 *   (recipe_id, ingredient). A recipe with no cooking step simply has
 *   NULL — the fallback path returns cooked_qty unchanged.
 *
 * - We intentionally gate this math on `source === 'toast'`. Manual /
 *   ad-hoc inventory updates preserve the pre-T8 free-text semantic so
 *   that a walk-in waste-log stays as-typed; only POS-driven depletions
 *   get the raw-weight conversion.
 *
 * - Out-of-range loss_factor (NULL, <0, >=1) is treated as "no shrinkage
 *   known" and the cooked_qty is used as the delta. `loss_factor=1`
 *   means 100% loss — meaningless for depletion math and a divide-by-
 *   zero trap — so it's in the unsafe bucket with a WARN reason.
 */

import type { Database } from 'better-sqlite3';

export interface ShrinkageLookupInput {
  recipe_id: string;
  ingredient: string;
  location_id: string;
}

export interface ShrinkageMath {
  /** Cooked qty as supplied by Toast (POS). */
  cooked_qty: number;
  /** Unit of the cooked_qty (e.g. 'oz', 'g'). Passed through untouched. */
  unit: string | null;
  /** Raw qty that should deplete from inventory. */
  raw_qty: number;
  /** Whether shrinkage math fired (true) or we fell through to cooked_qty (false). */
  applied: boolean;
  /** Loss factor actually used (null when fell through). */
  loss_factor: number | null;
  /** Human-readable reason for audit trail. */
  reason:
    | 'shrinkage_applied'
    | 'no_loss_factor'
    | 'loss_factor_out_of_range'
    | 'no_bom_line'
    | 'invalid_cooked_qty';
}

/**
 * Look up `bom_lines.loss_factor` for a (recipe_id, ingredient) pair. Returns
 * null when no row matches or the column is NULL. Match is case-insensitive
 * on `ingredient` + tolerant of surrounding whitespace to keep parity with
 * the kitchen-assistant route's LIKE-based lookups.
 *
 * Scoped to `location_id` so multi-site installs don't cross-read.
 */
export function lookupLossFactor(
  db: Database,
  input: ShrinkageLookupInput,
): number | null {
  const row = db
    .prepare(
      `SELECT loss_factor FROM bom_lines
        WHERE recipe_id = ?
          AND LOWER(TRIM(ingredient)) = LOWER(TRIM(?))
          AND location_id = ?
          AND loss_factor IS NOT NULL
        LIMIT 1`,
    )
    .get(input.recipe_id, input.ingredient, input.location_id) as
    | { loss_factor: number | null }
    | undefined;
  if (!row) return null;
  const lf = row.loss_factor;
  return typeof lf === 'number' ? lf : null;
}

/**
 * Compute raw-weight depletion given cooked qty and a loss factor. Pure,
 * no DB. Used directly by tests and by `resolveCookingShrinkage` below.
 *
 *   raw = cooked / (1 - loss_factor)
 *
 * A loss_factor of 0.25 (25% shrinkage) turns 8 oz cooked into
 * 8 / 0.75 = 10.6667 oz raw.
 */
export function applyShrinkage(
  cooked_qty: number,
  loss_factor: number | null,
  unit: string | null,
): ShrinkageMath {
  if (!Number.isFinite(cooked_qty) || cooked_qty <= 0) {
    return {
      cooked_qty,
      unit,
      raw_qty: cooked_qty,
      applied: false,
      loss_factor: null,
      reason: 'invalid_cooked_qty',
    };
  }
  if (loss_factor == null) {
    return {
      cooked_qty,
      unit,
      raw_qty: cooked_qty,
      applied: false,
      loss_factor: null,
      reason: 'no_loss_factor',
    };
  }
  // Out-of-range guard: <0 is nonsensical, ==0 means no shrinkage (skip
  // math but log the reason), >=1 is the divide-by-zero / 100%-loss trap.
  if (loss_factor <= 0 || loss_factor >= 1) {
    return {
      cooked_qty,
      unit,
      raw_qty: cooked_qty,
      applied: false,
      loss_factor,
      reason: 'loss_factor_out_of_range',
    };
  }
  if (loss_factor === 0) {
    return {
      cooked_qty,
      unit,
      raw_qty: cooked_qty,
      applied: false,
      loss_factor: 0,
      reason: 'loss_factor_out_of_range',
    };
  }
  const raw_qty = cooked_qty / (1 - loss_factor);
  return {
    cooked_qty,
    unit,
    raw_qty,
    applied: true,
    loss_factor,
    reason: 'shrinkage_applied',
  };
}

/**
 * Full resolution: DB lookup + math. Returns a ShrinkageMath result. If no
 * matching `bom_lines` row exists (recipe_id + ingredient pair never seen),
 * reason='no_bom_line' and raw_qty === cooked_qty (fall-through). Callers
 * should persist the cooked_qty as-is in that case and rely on the
 * annotated note for auditability.
 */
export function resolveCookingShrinkage(
  db: Database,
  input: ShrinkageLookupInput & { cooked_qty: number; unit: string | null },
): ShrinkageMath {
  const { recipe_id, ingredient, location_id, cooked_qty, unit } = input;
  if (!recipe_id || !ingredient) {
    // Defensive — route should have already validated. Treat as no bom line.
    return {
      cooked_qty,
      unit,
      raw_qty: cooked_qty,
      applied: false,
      loss_factor: null,
      reason: 'no_bom_line',
    };
  }
  // Check whether ANY bom_lines row exists for (recipe, ingredient) to
  // distinguish "no row" from "row with NULL loss_factor". The audit note
  // semantic differs between the two.
  const anyRow = db
    .prepare(
      `SELECT loss_factor FROM bom_lines
        WHERE recipe_id = ?
          AND LOWER(TRIM(ingredient)) = LOWER(TRIM(?))
          AND location_id = ?
        LIMIT 1`,
    )
    .get(recipe_id, ingredient, location_id) as
    | { loss_factor: number | null }
    | undefined;
  if (!anyRow) {
    return {
      cooked_qty,
      unit,
      raw_qty: cooked_qty,
      applied: false,
      loss_factor: null,
      reason: 'no_bom_line',
    };
  }
  return applyShrinkage(cooked_qty, anyRow.loss_factor ?? null, unit);
}

/**
 * Format the `inventory_updates.delta` column as a signed numeric string
 * with unit suffix. Depletion = negative. Example: `-10.667 oz`.
 *
 * Rounds to 3 decimal places — enough to keep `±0.1 oz` acceptance
 * threshold for typical Toast burger / sandwich / plate volumes and stops
 * the default JS toString from emitting `10.666666666666666`.
 */
export function formatDepletionDelta(raw_qty: number, unit: string | null): string {
  const sign = -Math.abs(raw_qty);
  const rounded = Math.round(sign * 1000) / 1000;
  const qtyStr = rounded.toFixed(3).replace(/\.?0+$/, '') || '0';
  const u = unit && unit.trim() ? unit.trim() : '';
  return u ? `${qtyStr} ${u}` : qtyStr;
}

/**
 * Format the `inventory_updates.note` column with the shrinkage math so
 * variance audit / costing review can recover the exact conversion used.
 * Example:
 *   "T8: cooked=8 oz × 1/(1-0.25) → raw=10.667 oz [shrinkage_applied]"
 */
export function formatShrinkageNote(math: ShrinkageMath): string {
  const unit = math.unit ? ` ${math.unit}` : '';
  if (math.applied && math.loss_factor != null) {
    const raw = Math.round(math.raw_qty * 1000) / 1000;
    return `T8: cooked=${math.cooked_qty}${unit} × 1/(1-${math.loss_factor}) → raw=${raw}${unit} [${math.reason}]`;
  }
  return `T8: cooked=${math.cooked_qty}${unit} (no shrinkage) [${math.reason}]`;
}
