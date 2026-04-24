/**
 * Shared persistence + validation for dish_components.
 *
 * Extracted so both the POST route (app/api/dish-components/route.ts) and
 * the CLI importer (scripts/import-dish-components.mjs) run the same SQL
 * and the same row validation. Do not duplicate upsert SQL elsewhere.
 *
 * dish_name is stored CANONICAL (normalizeDishName from dishCostBridge).
 * Callers must normalize before handing a row to upsertDishComponent.
 */

import type { Database as DB } from 'better-sqlite3';
import { normalizeUnit, unitDimension } from './unitConvert.mjs';
import type { DishComponent } from './db';

export type DishComponentRow = {
  location_id: string;
  dish_name: string;
  component_type: 'recipe' | 'vendor_item';
  recipe_slug: string | null;
  vendor_ingredient: string | null;
  qty_per_serving: number;
  unit: string;
  notes: string | null;
};

export type ValidationResult =
  | { ok: true }
  | { ok: false; errors: string[] };

/**
 * Row-level validation used by the importer.
 *
 * Rules:
 *   - component_type ∈ {'recipe', 'vendor_item'}
 *   - exactly ONE of recipe_slug / vendor_ingredient is set (matches
 *     the table's CHECK constraint)
 *   - qty_per_serving > 0
 *   - unit is recognized by lib/unitConvert.mjs (weight | volume | count)
 *   - dish_name is non-empty after trim
 */
export function validateDishComponentRow(
  row: Partial<DishComponentRow> | null | undefined,
): ValidationResult {
  const errors: string[] = [];
  if (!row || typeof row !== 'object') {
    return { ok: false, errors: ['row must be an object'] };
  }

  if (!row.dish_name || typeof row.dish_name !== 'string' || !row.dish_name.trim()) {
    errors.push('dish_name is required');
  }

  const t = row.component_type;
  if (t !== 'recipe' && t !== 'vendor_item') {
    errors.push("component_type must be 'recipe' or 'vendor_item'");
  } else if (t === 'recipe') {
    const slugSet = !!(row.recipe_slug && String(row.recipe_slug).trim());
    const vendorSet = !!(row.vendor_ingredient && String(row.vendor_ingredient).trim());
    if (!slugSet) errors.push('recipe_slug is required when component_type=recipe');
    if (vendorSet) errors.push('vendor_ingredient must be empty when component_type=recipe');
  } else if (t === 'vendor_item') {
    const slugSet = !!(row.recipe_slug && String(row.recipe_slug).trim());
    const vendorSet = !!(row.vendor_ingredient && String(row.vendor_ingredient).trim());
    if (!vendorSet) errors.push('vendor_ingredient is required when component_type=vendor_item');
    if (slugSet) errors.push('recipe_slug must be empty when component_type=vendor_item');
  }

  const qty = Number(row.qty_per_serving);
  if (!Number.isFinite(qty) || qty <= 0) {
    errors.push('qty_per_serving must be a positive number');
  }

  if (!row.unit || typeof row.unit !== 'string' || !row.unit.trim()) {
    errors.push('unit is required');
  } else {
    const canon = normalizeUnit(row.unit);
    const dim = unitDimension(canon);
    if (!dim) {
      errors.push(`unit "${row.unit}" is not a known unit (see lib/unitConvert.mjs)`);
    }
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

type UpsertOutcome = 'inserted' | 'updated' | 'skipped';

export interface UpsertResult {
  outcome: UpsertOutcome;
  row: DishComponent;
}

/**
 * Upsert a dish_components row.
 *
 * Branches the SQL by component_type because the table has two partial
 * UNIQUE indexes — one per type — and SQLite ON CONFLICT must target a
 * specific conflict column list. Caller must pass a canonical dish_name.
 *
 * outcome:
 *   - 'inserted'  — no prior row for this key
 *   - 'updated'   — prior row existed with different qty / unit / notes
 *   - 'skipped'   — prior row identical across qty, unit, notes
 */
export function upsertDishComponent(db: DB, row: DishComponentRow): UpsertResult {
  const {
    location_id,
    dish_name,
    component_type,
    recipe_slug,
    vendor_ingredient,
    qty_per_serving,
    unit,
    notes,
  } = row;

  const existing =
    component_type === 'recipe'
      ? (db
          .prepare(
            `SELECT * FROM dish_components
              WHERE location_id = ? AND dish_name = ?
                AND component_type = 'recipe' AND recipe_slug = ?`,
          )
          .get(location_id, dish_name, recipe_slug) as DishComponent | undefined)
      : (db
          .prepare(
            `SELECT * FROM dish_components
              WHERE location_id = ? AND dish_name = ?
                AND component_type = 'vendor_item' AND vendor_ingredient = ?`,
          )
          .get(location_id, dish_name, vendor_ingredient) as DishComponent | undefined);

  if (
    existing &&
    Number(existing.qty_per_serving) === Number(qty_per_serving) &&
    String(existing.unit) === String(unit) &&
    (existing.notes ?? null) === (notes ?? null)
  ) {
    return { outcome: 'skipped', row: existing };
  }

  if (component_type === 'recipe') {
    db.prepare(
      `INSERT INTO dish_components
         (location_id, dish_name, component_type, recipe_slug, vendor_ingredient,
          qty_per_serving, unit, notes)
       VALUES (?, ?, 'recipe', ?, NULL, ?, ?, ?)
       ON CONFLICT(location_id, dish_name, recipe_slug)
         WHERE component_type = 'recipe'
         DO UPDATE SET
           qty_per_serving = excluded.qty_per_serving,
           unit            = excluded.unit,
           notes           = excluded.notes,
           updated_at      = datetime('now')`,
    ).run(location_id, dish_name, recipe_slug, qty_per_serving, unit, notes);
  } else {
    db.prepare(
      `INSERT INTO dish_components
         (location_id, dish_name, component_type, recipe_slug, vendor_ingredient,
          qty_per_serving, unit, notes)
       VALUES (?, ?, 'vendor_item', NULL, ?, ?, ?, ?)
       ON CONFLICT(location_id, dish_name, vendor_ingredient)
         WHERE component_type = 'vendor_item'
         DO UPDATE SET
           qty_per_serving = excluded.qty_per_serving,
           unit            = excluded.unit,
           notes           = excluded.notes,
           updated_at      = datetime('now')`,
    ).run(location_id, dish_name, vendor_ingredient, qty_per_serving, unit, notes);
  }

  const refetched =
    component_type === 'recipe'
      ? (db
          .prepare(
            `SELECT * FROM dish_components
              WHERE location_id = ? AND dish_name = ?
                AND component_type = 'recipe' AND recipe_slug = ?`,
          )
          .get(location_id, dish_name, recipe_slug) as DishComponent)
      : (db
          .prepare(
            `SELECT * FROM dish_components
              WHERE location_id = ? AND dish_name = ?
                AND component_type = 'vendor_item' AND vendor_ingredient = ?`,
          )
          .get(location_id, dish_name, vendor_ingredient) as DishComponent);

  return { outcome: existing ? 'updated' : 'inserted', row: refetched };
}

/**
 * Read dish_components rows, optionally filtered by location.
 * Ordered stably so the exporter produces deterministic output that
 * round-trips cleanly through the importer.
 */
export function listDishComponents(
  db: DB,
  filter?: { location_id?: string },
): DishComponent[] {
  if (filter?.location_id) {
    return db
      .prepare(
        `SELECT * FROM dish_components
          WHERE location_id = ?
          ORDER BY dish_name, component_type, recipe_slug, vendor_ingredient`,
      )
      .all(filter.location_id) as DishComponent[];
  }
  return db
    .prepare(
      `SELECT * FROM dish_components
        ORDER BY location_id, dish_name, component_type, recipe_slug, vendor_ingredient`,
    )
    .all() as DishComponent[];
}
