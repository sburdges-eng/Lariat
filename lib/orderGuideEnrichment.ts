// lib/orderGuideEnrichment.ts — preferred/lock/mismatch badges for order guide rows.

import type { Database as DB } from 'better-sqlite3';

export interface OrderGuideRow {
  ingredient: string;
  base_qty: number | null;
  unit: string | null;
  vendor: string | null;
  unit_price: number | null;
}

export interface OrderGuideEnrichment {
  preferred_vendor: string | null;
  quality_locked: boolean;
  quality_lock_reason: string | null;
  vendor_mismatch: boolean;
}

function normVendor(v: string | null | undefined): string {
  return (v ?? '').trim().toLowerCase();
}

function resolveMasterForGuideRow(
  db: DB,
  row: OrderGuideRow,
  locationId: string,
): {
  master_id: string;
  preferred_vendor: string | null;
  quality_locked: number;
  quality_lock_reason: string | null;
} | null {
  const vendor = normVendor(row.vendor);
  const ingredient = row.ingredient?.trim();
  if (!vendor || !ingredient) return null;

  const vp = db
    .prepare(
      `
      SELECT master_id FROM vendor_prices
       WHERE location_id = ?
         AND lower(trim(vendor)) = ?
         AND ingredient = ?
       ORDER BY imported_at DESC, id DESC
       LIMIT 1
    `,
    )
    .get(locationId, vendor, ingredient) as { master_id: string | null } | undefined;

  if (!vp?.master_id) return null;

  const master = db
    .prepare(
      `
      SELECT master_id, preferred_vendor, quality_locked, quality_lock_reason
        FROM ingredient_masters WHERE master_id = ?
    `,
    )
    .get(vp.master_id) as
    | {
        master_id: string;
        preferred_vendor: string | null;
        quality_locked: number;
        quality_lock_reason: string | null;
      }
    | undefined;

  return master ?? null;
}

export function enrichOrderGuideRow(
  db: DB,
  row: OrderGuideRow,
  locationId = 'default',
): OrderGuideEnrichment | null {
  const master = resolveMasterForGuideRow(db, row, locationId);
  if (!master) return null;

  const guideVendor = normVendor(row.vendor);
  const preferred = normVendor(master.preferred_vendor);
  const vendor_mismatch = Boolean(preferred && guideVendor && preferred !== guideVendor);

  return {
    preferred_vendor: master.preferred_vendor,
    quality_locked: Boolean(master.quality_locked),
    quality_lock_reason: master.quality_lock_reason,
    vendor_mismatch,
  };
}

export function enrichOrderGuideRows(
  db: DB,
  rows: OrderGuideRow[],
  locationId = 'default',
): Array<OrderGuideRow & { enrichment: OrderGuideEnrichment | null }> {
  return rows.map((row) => ({
    ...row,
    enrichment: enrichOrderGuideRow(db, row, locationId),
  }));
}
