/**
 * Shared persistence + validation for vendor_prices.
 *
 * Extracted so the drink-prices CSV importer (scripts/import-vendor-prices.mjs)
 * can speak the same row-validation and idempotent-upsert language as any
 * future caller. Do not duplicate upsert SQL elsewhere.
 *
 * Note: the existing costing ingest (scripts/ingest-costing.mjs) rebuilds
 * vendor_prices wholesale per location (DELETE + INSERT). That flow owns
 * per-run pack-size diffing and is intentionally separate. This repo is for
 * surgical additions — initially, beverage SKUs that the costing ingest has
 * no source feed for — keyed by (location_id, vendor, sku, ingredient).
 *
 * The vendor_prices table has no UNIQUE index; uniqueness is enforced
 * procedurally here via a SELECT-then-INSERT/UPDATE against the natural key.
 * All 341 rows currently in the food-side data respect this key as a
 * hard invariant (verified at time of writing).
 */

import type { Database as DB } from 'better-sqlite3';
import { normalizeUnit, unitDimension } from './unitConvert.mjs';

export type VendorPriceRow = {
  location_id: string;
  vendor: string;
  sku: string | null;
  ingredient: string;
  pack_size: number | null;
  pack_unit: string;
  pack_price: number;
  unit_price: number;
  category: string | null;
};

export type StoredVendorPrice = VendorPriceRow & {
  id: number;
  imported_at: string;
};

export type ValidationResult =
  | { ok: true }
  | { ok: false; errors: string[] };

/**
 * Row-level validation used by the importer.
 *
 * Rules:
 *   - vendor is non-empty after trim
 *   - ingredient is non-empty after trim
 *   - pack_price is a finite positive number
 *   - unit_price is a finite positive number
 *   - pack_unit is a recognized unit (weight | volume | count) per unitConvert
 *   - pack_size, if provided, must be finite and positive
 *
 * Intentionally does NOT cross-check unit_price = pack_price / pack_size —
 * catch-weight items and yield-adjusted prices legitimately diverge. The
 * caller (importer) is responsible for deriving unit_price when the CSV
 * leaves it blank and pack_size is present.
 */
export function validateVendorPriceRow(
  row: Partial<VendorPriceRow> | null | undefined,
): ValidationResult {
  const errors: string[] = [];
  if (!row || typeof row !== 'object') {
    return { ok: false, errors: ['row must be an object'] };
  }

  if (!row.vendor || typeof row.vendor !== 'string' || !row.vendor.trim()) {
    errors.push('vendor is required');
  }
  if (!row.ingredient || typeof row.ingredient !== 'string' || !row.ingredient.trim()) {
    errors.push('ingredient is required');
  }

  const pp = Number(row.pack_price);
  if (!Number.isFinite(pp) || pp <= 0) {
    errors.push('pack_price must be a positive number');
  }

  const up = Number(row.unit_price);
  if (!Number.isFinite(up) || up <= 0) {
    errors.push('unit_price must be a positive number');
  }

  if (row.pack_size !== null && row.pack_size !== undefined) {
    const ps = Number(row.pack_size);
    if (!Number.isFinite(ps) || ps <= 0) {
      errors.push('pack_size must be a positive number when provided');
    }
  }

  if (!row.pack_unit || typeof row.pack_unit !== 'string' || !row.pack_unit.trim()) {
    errors.push('pack_unit is required');
  } else {
    const canon = normalizeUnit(row.pack_unit);
    const dim = unitDimension(canon);
    if (!dim) {
      errors.push(`pack_unit "${row.pack_unit}" is not a known unit (see lib/unitConvert.mjs)`);
    }
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

type UpsertOutcome = 'inserted' | 'updated' | 'skipped';

export interface UpsertResult {
  outcome: UpsertOutcome;
  row: StoredVendorPrice;
}

/**
 * Upsert a vendor_prices row using (location_id, vendor, sku, ingredient) as
 * the natural key. sku may be NULL / '' when the vendor item has no SKU (e.g.
 * draft beer poured from a keg); in that case the ingredient name alone
 * disambiguates within a vendor.
 *
 * Compared fields for "is this identical?" are the mutable pricing fields:
 * pack_size, pack_unit, pack_price, unit_price, category. imported_at is
 * always refreshed on a real INSERT / UPDATE so downstream resolvers that
 * pick "latest by imported_at" observe the write.
 *
 * outcome:
 *   - 'inserted'  — no prior row for this key
 *   - 'updated'   — prior row existed with different pricing / category
 *   - 'skipped'   — prior row identical across all compared fields
 */
export function upsertVendorPrice(db: DB, row: VendorPriceRow): UpsertResult {
  const {
    location_id,
    vendor,
    sku,
    ingredient,
    pack_size,
    pack_unit,
    pack_price,
    unit_price,
    category,
  } = row;

  // Normalize sku to '' so NULL and '' collide on the natural key. The
  // existing food-side rows in production use '' for missing SKUs; we
  // match that convention to stay round-trippable with the costing ingest.
  const skuKey = sku == null ? '' : String(sku);

  const existing = db
    .prepare(
      `SELECT * FROM vendor_prices
        WHERE location_id = ? AND vendor = ?
          AND COALESCE(sku, '') = ?
          AND ingredient = ?
        ORDER BY id DESC
        LIMIT 1`,
    )
    .get(location_id, vendor, skuKey, ingredient) as StoredVendorPrice | undefined;

  if (
    existing &&
    numEq(existing.pack_size, pack_size) &&
    String(existing.pack_unit ?? '') === String(pack_unit) &&
    numEq(existing.pack_price, pack_price) &&
    numEq(existing.unit_price, unit_price) &&
    (existing.category ?? null) === (category ?? null)
  ) {
    return { outcome: 'skipped', row: existing };
  }

  if (existing) {
    db.prepare(
      `UPDATE vendor_prices
          SET pack_size = ?, pack_unit = ?, pack_price = ?, unit_price = ?,
              category = ?, imported_at = datetime('now')
        WHERE id = ?`,
    ).run(pack_size, pack_unit, pack_price, unit_price, category, existing.id);
    const refetched = db
      .prepare(`SELECT * FROM vendor_prices WHERE id = ?`)
      .get(existing.id) as StoredVendorPrice;
    return { outcome: 'updated', row: refetched };
  }

  const info = db
    .prepare(
      `INSERT INTO vendor_prices
         (ingredient, vendor, sku, pack_size, pack_unit, pack_price, unit_price,
          category, location_id, imported_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    )
    .run(ingredient, vendor, skuKey, pack_size, pack_unit, pack_price, unit_price, category, location_id);
  const refetched = db
    .prepare(`SELECT * FROM vendor_prices WHERE id = ?`)
    .get(Number(info.lastInsertRowid)) as StoredVendorPrice;
  return { outcome: 'inserted', row: refetched };
}

/**
 * Read vendor_prices rows, optionally filtered by location.
 * Ordered stably so any future exporter produces deterministic output.
 */
export function listVendorPrices(
  db: DB,
  filter?: { location_id?: string },
): StoredVendorPrice[] {
  if (filter?.location_id) {
    return db
      .prepare(
        `SELECT * FROM vendor_prices
          WHERE location_id = ?
          ORDER BY vendor, ingredient, COALESCE(sku, ''), id`,
      )
      .all(filter.location_id) as StoredVendorPrice[];
  }
  return db
    .prepare(
      `SELECT * FROM vendor_prices
        ORDER BY location_id, vendor, ingredient, COALESCE(sku, ''), id`,
    )
    .all() as StoredVendorPrice[];
}

// Tolerant numeric equality: SQLite stores REAL, JS numbers can round-trip
// 6 as 6.0, null as null. We treat two numbers as equal if both are null or
// both are finite and Number()-equal. Exact bit equality is not required.
function numEq(a: number | null | undefined, b: number | null | undefined): boolean {
  const aNull = a === null || a === undefined;
  const bNull = b === null || b === undefined;
  if (aNull && bNull) return true;
  if (aNull || bNull) return false;
  return Number(a) === Number(b);
}
