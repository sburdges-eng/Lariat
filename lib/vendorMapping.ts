// lib/vendorMapping.ts — catalog search + mapping coverage for Sysco/Shamrock link UI.

import type { Database as DB } from 'better-sqlite3';
import { COMPARE_VENDORS, type CompareVendor } from './vendorCompare.ts';

export interface CatalogKey {
  vendor: CompareVendor;
  sku: string;
  ingredient: string;
}

export interface CatalogRow extends CatalogKey {
  pack_label: string | null;
  unit_price: number | null;
  master_id: string | null;
}

export interface SingleVendorMaster {
  master_id: string;
  canonical_name: string;
  linked_vendor: CompareVendor;
  missing_vendor: CompareVendor;
}

export interface MappingCoverageSummary {
  mapped_pairs: number;
  single_vendor: number;
  unlinked_sysco: number;
  unlinked_shamrock: number;
}

export interface SearchCatalogOpts {
  vendor: CompareVendor;
  q?: string | null;
  unlinkedOnly?: boolean;
  locationId?: string;
  limit?: number;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

function clampLimit(raw: number | null | undefined): number {
  if (raw == null) return DEFAULT_LIMIT;
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(n)));
}

function normVendor(v: string | null | undefined): string {
  return (v ?? '').trim().toLowerCase();
}

function isCompareVendor(v: string): v is CompareVendor {
  return (COMPARE_VENDORS as readonly string[]).includes(v);
}

function packLabel(row: { pack_size: number | null; pack_unit: string | null }): string | null {
  if (row.pack_size == null && !row.pack_unit) return null;
  const u = row.pack_unit ?? '';
  if (row.pack_size == null) return u || null;
  return u ? `${row.pack_size} ${u}` : String(row.pack_size);
}

export function catalogKeyString(key: CatalogKey): string {
  return `${normVendor(key.vendor)}\x1f${key.sku}\x1f${key.ingredient}`;
}

export function parseCatalogKeyString(raw: string): CatalogKey | null {
  const parts = raw.split('\x1f');
  if (parts.length < 3) return null;
  const vendor = normVendor(parts[0]);
  if (!isCompareVendor(vendor)) return null;
  const sku = parts[1] ?? '';
  const ingredient = parts.slice(2).join('\x1f');
  if (!sku || !ingredient) return null;
  return { vendor, sku, ingredient };
}

export function searchVendorCatalog(db: DB, opts: SearchCatalogOpts): CatalogRow[] {
  const locationId = opts.locationId ?? 'default';
  const limit = clampLimit(opts.limit);
  const q = opts.q?.trim() || null;
  const vendor = opts.vendor;

  const wheres = [
    'location_id = @location_id',
    "lower(trim(vendor)) = @vendor",
    "sku IS NOT NULL AND TRIM(sku) != ''",
  ];
  const params: Record<string, unknown> = { location_id: locationId, vendor, limit };

  if (q) {
    wheres.push('lower(ingredient) LIKE lower(@q)');
    params.q = `%${q}%`;
  }
  if (opts.unlinkedOnly) {
    wheres.push("(master_id IS NULL OR TRIM(master_id) = '')");
  }

  const rows = db
    .prepare(
      `
      SELECT vendor, sku, ingredient, pack_size, pack_unit, unit_price, master_id
        FROM vendor_prices
       WHERE ${wheres.join(' AND ')}
       ORDER BY imported_at DESC, id DESC
    `,
    )
    .all(params) as Array<{
    vendor: string;
    sku: string;
    ingredient: string;
    pack_size: number | null;
    pack_unit: string | null;
    unit_price: number | null;
    master_id: string | null;
  }>;

  const seen = new Set<string>();
  const out: CatalogRow[] = [];
  for (const row of rows) {
    const v = normVendor(row.vendor);
    if (!isCompareVendor(v)) continue;
    const dedupe = `${v}\x1f${row.sku}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    out.push({
      vendor: v,
      sku: row.sku,
      ingredient: row.ingredient,
      pack_label: packLabel(row),
      unit_price: row.unit_price,
      master_id: row.master_id,
    });
    if (out.length >= limit) break;
  }
  return out;
}

export function countUnlinkedCatalog(db: DB, locationId = 'default'): { sysco: number; shamrock: number } {
  const countVendor = (vendor: CompareVendor) => {
    const row = db
      .prepare(
        `
        SELECT COUNT(DISTINCT sku) AS c FROM vendor_prices
         WHERE location_id = ?
           AND lower(trim(vendor)) = ?
           AND sku IS NOT NULL AND TRIM(sku) != ''
           AND (master_id IS NULL OR TRIM(master_id) = '')
      `,
      )
      .get(locationId, vendor) as { c: number };
    return row?.c ?? 0;
  };
  return { sysco: countVendor('sysco'), shamrock: countVendor('shamrock') };
}

export function listSingleVendorMasters(db: DB, locationId = 'default'): SingleVendorMaster[] {
  const masters = db
    .prepare(`SELECT master_id, canonical_name FROM ingredient_masters ORDER BY canonical_name ASC`)
    .all() as Array<{ master_id: string; canonical_name: string }>;

  const out: SingleVendorMaster[] = [];
  for (const m of masters) {
    const rows = db
      .prepare(
        `
        SELECT DISTINCT lower(trim(vendor)) AS vendor
          FROM vendor_prices
         WHERE location_id = ?
           AND master_id = ?
           AND lower(trim(vendor)) IN ('sysco', 'shamrock')
      `,
      )
      .all(locationId, m.master_id) as Array<{ vendor: string }>;

    const vendors = new Set<CompareVendor>();
    for (const r of rows) {
      const v = normVendor(r.vendor);
      if (isCompareVendor(v)) vendors.add(v);
    }
    if (vendors.size !== 1) continue;
    const linked = [...vendors][0]!;
    const missing: CompareVendor = linked === 'sysco' ? 'shamrock' : 'sysco';
    out.push({
      master_id: m.master_id,
      canonical_name: m.canonical_name,
      linked_vendor: linked,
      missing_vendor: missing,
    });
  }
  return out;
}

export function summarizeMappingCoverage(db: DB, locationId = 'default'): MappingCoverageSummary {
  const pairs = db
    .prepare(
      `
      SELECT COUNT(*) AS c FROM (
        SELECT im.master_id
          FROM ingredient_masters im
         WHERE EXISTS (
           SELECT 1 FROM vendor_prices vp
            WHERE vp.master_id = im.master_id AND vp.location_id = ? AND lower(trim(vp.vendor)) = 'sysco'
         )
         AND EXISTS (
           SELECT 1 FROM vendor_prices vp
            WHERE vp.master_id = im.master_id AND vp.location_id = ? AND lower(trim(vp.vendor)) = 'shamrock'
         )
      )
    `,
    )
    .get(locationId, locationId) as { c: number };

  const unlinked = countUnlinkedCatalog(db, locationId);
  return {
    mapped_pairs: pairs?.c ?? 0,
    single_vendor: listSingleVendorMasters(db, locationId).length,
    unlinked_sysco: unlinked.sysco,
    unlinked_shamrock: unlinked.shamrock,
  };
}

export function getLatestVendorPriceRow(
  db: DB,
  key: CatalogKey,
  locationId = 'default',
): { id: number; master_id: string | null; ingredient: string } | null {
  const row = db
    .prepare(
      `
      SELECT id, master_id, ingredient FROM vendor_prices
       WHERE location_id = ?
         AND lower(trim(vendor)) = ?
         AND sku = ?
       ORDER BY imported_at DESC, id DESC
       LIMIT 1
    `,
    )
    .get(locationId, normVendor(key.vendor), key.sku) as
    | { id: number; master_id: string | null; ingredient: string }
    | undefined;
  return row ?? null;
}
