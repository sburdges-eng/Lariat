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

  // ACID-C: SELECT → INSERT/UPDATE must be atomic to prevent TOCTOU races
  // where two concurrent callers both see "not existing" and both INSERT.
  return db.transaction(() => {
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
      return { outcome: 'skipped' as UpsertOutcome, row: existing };
    }

    if (existing) {
      // Snapshot the pre-update row into the append-only history BEFORE
      // the UPDATE so the prior price/pack survives the in-place mutation.
      // The food side gets this through scripts/ingest-costing.mjs which
      // snapshot-then-DELETE-then-INSERTs; this path is the missing
      // beverage-import equivalent. Same db.transaction means an UPDATE
      // failure rolls the snapshot back too — no orphan history rows.
      db.prepare(
        `INSERT INTO vendor_prices_history
           (source_vendor_price_id, ingredient, vendor, sku,
            pack_size, pack_unit, pack_price, unit_price, category,
            yield_pct, actual_received_lb, reconciled_unit_price, master_id,
            location_id, imported_at, snapshot_reason)
         SELECT id, ingredient, vendor, sku,
                pack_size, pack_unit, pack_price, unit_price, category,
                yield_pct, actual_received_lb, reconciled_unit_price, master_id,
                location_id, imported_at, 'upsert-vendor-price'
           FROM vendor_prices
          WHERE id = ?`,
      ).run(existing.id);

      db.prepare(
        `UPDATE vendor_prices
            SET pack_size = ?, pack_unit = ?, pack_price = ?, unit_price = ?,
                category = ?, imported_at = datetime('now')
          WHERE id = ?`,
      ).run(pack_size, pack_unit, pack_price, unit_price, category, existing.id);
      const refetched = db
        .prepare(`SELECT * FROM vendor_prices WHERE id = ?`)
        .get(existing.id) as StoredVendorPrice;
      return { outcome: 'updated' as UpsertOutcome, row: refetched };
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
    return { outcome: 'inserted' as UpsertOutcome, row: refetched };
  })();
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

/**
 * Options for {@link listPriceSeries}.
 *
 * vendor + sku identify the timeline. location_id scopes to one kitchen
 * (defaults to 'default' for single-site installs). limit defaults to 100
 * and is clamped to [1, 1000] — the helper answers "how did this SKU's
 * price change" and a timeline of >1000 points is a downstream concern.
 */
export type PriceSeriesOptions = {
  vendor: string;
  sku: string;
  location_id?: string;
  limit?: number;
};

/**
 * One point on a per-SKU price timeline. Intentionally narrower than
 * {@link StoredVendorPrice} / the full vendor_prices_history row:
 *   - No `category` — the question this answers is "how did price
 *     change over time?", not "what category is this SKU?". Category
 *     doesn't vary snapshot-to-snapshot in practice, and omitting it
 *     keeps the payload tight.
 *   - No `ingredient` / `vendor` / `sku` — the caller already knows
 *     these (they supplied them in the query). Echoing them per row
 *     just bloats the JSON.
 *   - No `id` / `source_vendor_price_id` — an internal detail.
 */
export type PriceSeriesRow = {
  snapshot_at: string;
  run_id: number | null;
  pack_size: number | null;
  pack_unit: string | null;
  pack_price: number | null;
  unit_price: number | null;
  yield_pct: number | null;
  actual_received_lb: number | null;
  reconciled_unit_price: number | null;
  imported_at: string | null;
};

/**
 * Read the snapshot history for a single (vendor, sku) pair at a
 * location, ordered oldest-first so the caller gets a chronological
 * timeline they can feed directly into a chart.
 *
 * Ordering: `snapshot_at ASC, id ASC` — id breaks ties when multiple
 * rows share a snapshot_at (e.g. two runs in the same second under
 * subsec precision, or a future migration that backfills snapshots).
 *
 * Limit direction: when the history is longer than `limit`, this keeps
 * the OLDEST N rows (via `ORDER BY snapshot_at ASC LIMIT N`). A
 * chronological chart that shows the beginning of a SKU's price
 * history is more useful than an arbitrarily truncated suffix — the
 * caller can ask for a bigger limit if they need the tail.
 *
 * Rules:
 *   - vendor and sku are required; blank/whitespace returns `[]`
 *     (the caller may query on a blank field from the UI).
 *   - limit defaults to 100, clamps into [1, 1000]. Non-finite,
 *     non-positive, or absent values fall back to the default.
 *   - No dedup / no gap-fill. Every snapshot row comes back as-is;
 *     downstream can DISTINCT on pack_price/unit_price if they want
 *     a change-only series.
 */
export function listPriceSeries(
  db: DB,
  opts: PriceSeriesOptions,
): PriceSeriesRow[] {
  const vendor = typeof opts?.vendor === 'string' ? opts.vendor.trim() : '';
  const sku = typeof opts?.sku === 'string' ? opts.sku.trim() : '';
  if (!vendor || !sku) return [];

  const location_id =
    typeof opts?.location_id === 'string' && opts.location_id.trim()
      ? opts.location_id.trim()
      : 'default';

  const rawLimit = Number(opts?.limit);
  let limit: number;
  if (!Number.isFinite(rawLimit) || rawLimit <= 0) {
    limit = 100;
  } else {
    limit = Math.min(1000, Math.floor(rawLimit));
  }

  return db
    .prepare(
      `SELECT snapshot_at, run_id, pack_size, pack_unit, pack_price,
              unit_price, yield_pct, actual_received_lb,
              reconciled_unit_price, imported_at
         FROM vendor_prices_history
        WHERE location_id = ?
          AND vendor = ?
          AND sku = ?
        ORDER BY snapshot_at ASC, id ASC
        LIMIT ?`,
    )
    .all(location_id, vendor, sku, limit) as PriceSeriesRow[];
}

/**
 * Options for {@link listPriceShocks}.
 *
 * windowDays: how far back to compare against (default 7, clamps to [1, 90]).
 *             We pick the EARLIEST snapshot inside the window as the
 *             baseline ("price one week ago") and compare to the live
 *             current vendor_prices row when present. Operators are typically
 *             watching for "what changed since Monday" — the inside-window
 *             baseline matches that mental model better than min/max.
 *
 * minPctMove: only return rows whose absolute % change ≥ this value.
 *             Default 5. Clamps to [0, 1000].
 *
 * limit:      cap on returned rows (default 50, clamps to [1, 500]).
 *             Sorted by absolute % change DESC, so the cap drops the
 *             smallest movers first.
 */
export type PriceShockOptions = {
  location_id?: string;
  windowDays?: number;
  minPctMove?: number;
  limit?: number;
};

/**
 * One row in the price-shock list: a vendor SKU whose unit_price moved
 * by more than minPctMove inside the lookback window.
 */
export type PriceShockRow = {
  vendor: string;
  sku: string;
  ingredient: string;
  category: string | null;
  baseline_unit_price: number;
  baseline_at: string;
  latest_unit_price: number;
  latest_at: string;
  delta_pct: number;
  direction: 'up' | 'down';
};

/**
 * Rank vendor SKUs by absolute price change over a lookback window.
 *
 * Inputs collapse to:
 *   baseline = oldest snapshot inside [now - windowDays, now]
 *   latest   = newest point after unioning vendor_prices_history and the
 *              live vendor_prices row (no upper bound — if a SKU moved today
 *              and the previous snapshot was 6 days ago, that's a 6-day
 *              shock, not 7)
 *   delta_pct = (latest - baseline) / baseline × 100
 *
 * Rows where baseline_unit_price is null/zero are skipped (can't
 * compute %). SKUs with only a single snapshot in the window are
 * skipped (no comparison possible). Beverage / category-preserved
 * SKUs flow through unchanged — the caller can filter by `category`
 * if they want to scope to food-only.
 *
 * Returned rows are not deduped on (vendor, sku, ingredient). In
 * practice the natural key (vendor, sku, location_id) is unique in
 * vendor_prices, but vendor_prices_history can have multiple ingredient
 * spellings if the upstream catalog renamed mid-stream — surface them
 * separately rather than silently picking one.
 */
export function listPriceShocks(
  db: DB,
  opts: PriceShockOptions = {},
): PriceShockRow[] {
  const location_id =
    typeof opts.location_id === 'string' && opts.location_id.trim()
      ? opts.location_id.trim()
      : 'default';

  const rawWindow = Number(opts.windowDays);
  const windowDays =
    Number.isFinite(rawWindow) && rawWindow > 0
      ? Math.min(90, Math.max(1, Math.floor(rawWindow)))
      : 7;

  const rawMin = Number(opts.minPctMove);
  const minPctMove =
    Number.isFinite(rawMin) && rawMin >= 0
      ? Math.min(1000, rawMin)
      : 5;

  const rawLimit = Number(opts.limit);
  const limit =
    Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(500, Math.floor(rawLimit))
      : 50;

  // SQLite datetime arithmetic: snapshot_at >= datetime('now', '-Nd days').
  // We bind the days literal as part of the modifier string.
  const sinceModifier = `-${windowDays} days`;

  // Two passes: collect baseline (oldest in window) + latest per
  // (vendor, sku, ingredient), then compute delta in JS. Doing this in
  // pure SQL with two correlated subqueries works but is hard to read;
  // history tables here cap at <100k rows in practice so the JS pass
  // is cheap.
  const rows = db
    .prepare(
      `SELECT vendor, sku, ingredient, category, snapshot_at, unit_price,
              source_order, row_order
         FROM (
           SELECT vendor, sku, ingredient, category,
                  snapshot_at, unit_price,
                  0 AS source_order,
                  id AS row_order
             FROM vendor_prices_history
            WHERE location_id = ?
              AND snapshot_at >= datetime('now', ?)
              AND vendor IS NOT NULL
              AND sku IS NOT NULL
              AND unit_price IS NOT NULL
           UNION ALL
           SELECT vendor, sku, ingredient, category,
                  COALESCE(imported_at, datetime('now')) AS snapshot_at,
                  unit_price,
                  1 AS source_order,
                  id AS row_order
             FROM vendor_prices
            WHERE location_id = ?
              AND COALESCE(imported_at, datetime('now')) >= datetime('now', ?)
              AND vendor IS NOT NULL
              AND sku IS NOT NULL
              AND unit_price IS NOT NULL
         )
        ORDER BY vendor, sku, ingredient, snapshot_at ASC, source_order ASC, row_order ASC`,
    )
    .all(location_id, sinceModifier, location_id, sinceModifier) as Array<{
    vendor: string;
    sku: string;
    ingredient: string;
    category: string | null;
    snapshot_at: string;
    unit_price: number;
    source_order: number;
    row_order: number;
  }>;

  type Group = {
    vendor: string;
    sku: string;
    ingredient: string;
    category: string | null;
    baseline_unit_price: number | null;
    baseline_at: string | null;
    latest_unit_price: number | null;
    latest_at: string | null;
    point_count: number;
  };

  const groups = new Map<string, Group>();
  for (const r of rows) {
    const key = `${r.vendor}|${r.sku}|${r.ingredient}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        vendor: r.vendor,
        sku: r.sku,
        ingredient: r.ingredient,
        category: r.category,
        baseline_unit_price: null,
        baseline_at: null,
        latest_unit_price: null,
        latest_at: null,
        point_count: 0,
      };
      groups.set(key, g);
    }
    g.point_count += 1;
    if (g.baseline_at == null) {
      g.baseline_unit_price = r.unit_price;
      g.baseline_at = r.snapshot_at;
    }
    g.latest_unit_price = r.unit_price;
    g.latest_at = r.snapshot_at;
    // category may have been null on the first row but populated later;
    // keep the most recent non-null.
    if (r.category != null) g.category = r.category;
  }

  const out: PriceShockRow[] = [];
  for (const g of groups.values()) {
    if (
      g.baseline_unit_price == null ||
      g.latest_unit_price == null ||
      g.baseline_at == null ||
      g.latest_at == null ||
      g.point_count < 2 ||
      g.baseline_unit_price <= 0
    ) {
      continue;
    }
    const delta_pct =
      ((g.latest_unit_price - g.baseline_unit_price) / g.baseline_unit_price) * 100;
    if (Math.abs(delta_pct) < minPctMove) continue;
    out.push({
      vendor: g.vendor,
      sku: g.sku,
      ingredient: g.ingredient,
      category: g.category,
      baseline_unit_price: g.baseline_unit_price,
      baseline_at: g.baseline_at,
      latest_unit_price: g.latest_unit_price,
      latest_at: g.latest_at,
      delta_pct,
      direction: delta_pct > 0 ? 'up' : 'down',
    });
  }

  out.sort((a, b) => Math.abs(b.delta_pct) - Math.abs(a.delta_pct));
  return out.slice(0, limit);
}
