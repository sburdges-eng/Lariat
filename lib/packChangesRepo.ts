/**
 * Read + acknowledge helpers for pack_size_changes.
 *
 * Pack-size changes are detected during scripts/ingest-costing.mjs (T6):
 * when a vendor SKU's pack_size or pack_unit flips relative to the
 * latest prior row, an audit row lands in pack_size_changes and the new
 * vendor_prices row gets `map_status='PACK_CHANGED'`. The dashboard
 * tile (app/costing/page.jsx) shows the count of unacknowledged rows;
 * this module is the detail/triage view's data layer.
 *
 * The table is intentionally unscoped by location — pack changes are a
 * vendor catalog property, not a per-restaurant fact. Acknowledgement
 * is a costing-side management action, so it routes to the file audit
 * (lib/auditLog.mjs) rather than the regulated audit_events stream.
 */

import type { Database } from 'better-sqlite3';

export interface PackSizeChange {
  id: number;
  vendor: string;
  sku: string;
  prev_pack: string | null;
  new_pack: string | null;
  prev_price: number | null;
  new_price: number | null;
  detected_at: string;
  acknowledged: 0 | 1;
}

export interface PackChangeWithIngredient extends PackSizeChange {
  /** Ingredient name from the latest vendor_prices row matching (vendor, sku). */
  ingredient: string | null;
  /** Computed unit-price delta as a fraction (0.10 = +10%). */
  price_delta_pct: number | null;
}

export interface ListOptions {
  /** When 'all', returns acknowledged + unacknowledged. Default 'open'. */
  filter?: 'open' | 'acknowledged' | 'all';
  /** Optional vendor filter (case-insensitive prefix match). */
  vendor?: string | null;
  /** Cap returned rows; default 200, max 1000. */
  limit?: number;
}

function priceDeltaPct(prev: number | null, next: number | null): number | null {
  if (prev == null || next == null) return null;
  if (!Number.isFinite(prev) || !Number.isFinite(next)) return null;
  if (prev === 0) return null;
  return (next - prev) / prev;
}

/**
 * List pack changes joined to the most-recent ingredient name from
 * vendor_prices. Ingredient is best-effort — a SKU that's no longer in
 * vendor_prices (e.g. discontinued) returns ingredient=null.
 */
export function listPackChanges(
  db: Database,
  opts: ListOptions = {},
): PackChangeWithIngredient[] {
  const filter = opts.filter ?? 'open';
  const limit = Math.max(1, Math.min(1000, opts.limit ?? 200));

  const where: string[] = [];
  const params: Array<string | number> = [];
  if (filter === 'open') where.push('psc.acknowledged = 0');
  else if (filter === 'acknowledged') where.push('psc.acknowledged = 1');
  if (opts.vendor && opts.vendor.trim()) {
    where.push(`LOWER(psc.vendor) LIKE LOWER(?)`);
    params.push(`${opts.vendor.trim()}%`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  // LEFT JOIN onto vendor_prices for the ingredient label. We pick a
  // single row per (vendor, sku) by MAX(id) — that's the same row the
  // ingest leaves behind as the "current" catalog entry.
  const sql = `
    SELECT psc.id, psc.vendor, psc.sku,
           psc.prev_pack, psc.new_pack,
           psc.prev_price, psc.new_price,
           psc.detected_at, psc.acknowledged,
           vp.ingredient AS ingredient
      FROM pack_size_changes psc
      LEFT JOIN (
        SELECT vendor, sku, ingredient,
               ROW_NUMBER() OVER (PARTITION BY vendor, sku ORDER BY id DESC) AS rn
          FROM vendor_prices
      ) vp
        ON vp.vendor = psc.vendor AND vp.sku = psc.sku AND vp.rn = 1
      ${whereSql}
     ORDER BY psc.detected_at DESC, psc.id DESC
     LIMIT ?
  `;
  params.push(limit);
  const rows = db.prepare(sql).all(...params) as Array<
    PackSizeChange & { ingredient: string | null }
  >;

  return rows.map((r) => ({
    ...r,
    price_delta_pct: priceDeltaPct(r.prev_price, r.new_price),
  }));
}

export interface UnackCount {
  total: number;
}

/** Count of acknowledged=0 rows. Cheap aggregate for tile/badges. */
export function unacknowledgedCount(db: Database): UnackCount {
  const row = db
    .prepare(`SELECT COUNT(*) AS c FROM pack_size_changes WHERE acknowledged = 0`)
    .get() as { c: number };
  return { total: row.c };
}

export interface AcknowledgeResult {
  /** Was the row found? */
  found: boolean;
  /** Was the row already acknowledged before this call? */
  was_already_acknowledged: boolean;
  /** Final state after the call (always 1 when found=true). */
  acknowledged: 0 | 1;
  /** Resolved row (post-acknowledge); null when not found. */
  row: PackSizeChange | null;
}

export function getPackChangeById(
  db: Database,
  id: number,
): PackSizeChange | null {
  return (
    db
      .prepare(`SELECT * FROM pack_size_changes WHERE id = ?`)
      .get(id) as PackSizeChange | undefined
  ) ?? null;
}

/**
 * Mark one pack_size_changes row as acknowledged. Idempotent — a second
 * call on the same id returns `was_already_acknowledged=true` without
 * touching the DB. Caller is responsible for any audit logging side
 * effects (the route handler writes to lib/auditLog.mjs).
 */
export function acknowledgePackChange(
  db: Database,
  id: number,
): AcknowledgeResult {
  const row = getPackChangeById(db, id) ?? undefined;
  if (!row) {
    return {
      found: false,
      was_already_acknowledged: false,
      acknowledged: 0,
      row: null,
    };
  }
  if (row.acknowledged === 1) {
    return {
      found: true,
      was_already_acknowledged: true,
      acknowledged: 1,
      row,
    };
  }
  db.prepare(`UPDATE pack_size_changes SET acknowledged = 1 WHERE id = ?`).run(id);
  return {
    found: true,
    was_already_acknowledged: false,
    acknowledged: 1,
    row: { ...row, acknowledged: 1 },
  };
}
