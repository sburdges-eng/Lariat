// lib/vendorCompare.ts
//
// Sysco vs Shamrock normalized price compare for mapped ingredient_masters.
// Pure read layer — writes go through ingredientMastersRepo.

import type { Database as DB } from 'better-sqlite3';
import { normalizeIngredientKey } from './ingredientKey.ts';
import {
  convertQty,
  normalizeUnit,
  unitDimension,
} from './unitConvert.mjs';

export const COMPARE_VENDORS = ['sysco', 'shamrock'] as const;
export type CompareVendor = (typeof COMPARE_VENDORS)[number];

export type CompareOfferStatus = 'ok' | 'cannot_compare';

export interface VendorOfferSnapshot {
  vendor: CompareVendor;
  sku: string | null;
  pack_label: string | null;
  normalized_price: number | null;
  normalized_unit: string | null;
  status: CompareOfferStatus;
  reason: string | null;
}

export interface VendorCompareRow {
  master_id: string;
  canonical_name: string;
  preferred_vendor: string | null;
  quality_locked: boolean;
  quality_lock_reason: string | null;
  sysco: VendorOfferSnapshot | null;
  shamrock: VendorOfferSnapshot | null;
  compare_status: 'comparable' | 'cannot_compare';
  cheaper_vendor: CompareVendor | null;
}

export interface VendorCompareSummary {
  mapped_pair_count: number;
  masters_with_both_vendors: number;
  masters_single_vendor_only: number;
  rows: VendorCompareRow[];
}

export interface ListVendorCompareOpts {
  locationId?: string;
  limit?: number;
}

type VendorPriceRow = {
  vendor: string | null;
  sku: string | null;
  ingredient: string;
  pack_size: number | null;
  pack_unit: string | null;
  pack_price: number | null;
  unit_price: number | null;
  reconciled_unit_price: number | null;
  master_id: string | null;
};

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;
const WEIGHT_COMPARE_UNIT = 'lb';

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
  return v === 'sysco' || v === 'shamrock';
}

function packLabel(row: VendorPriceRow): string | null {
  if (row.pack_size == null || !row.pack_unit) return row.pack_unit ?? null;
  const u = String(row.pack_unit).trim();
  return `${row.pack_size} ${u}`.trim();
}

function dollarPerPackUnit(row: VendorPriceRow): number | null {
  const rec = row.reconciled_unit_price;
  if (rec != null && Number.isFinite(rec) && rec > 0) return rec;
  const up = row.unit_price;
  if (up != null && Number.isFinite(up) && up > 0) return up;
  const pp = row.pack_price;
  const ps = row.pack_size;
  if (pp != null && ps != null && Number.isFinite(pp) && Number.isFinite(ps) && ps > 0 && pp > 0) {
    return pp / ps;
  }
  return null;
}

export interface ComparableUnitPriceResult {
  price: number | null;
  unit: string | null;
  status: CompareOfferStatus;
  reason: string | null;
}

export function computeComparableUnitPrice(
  row: VendorPriceRow,
  targetUnit: string,
  densityGPerMl?: number | null,
): ComparableUnitPriceResult {
  const perUnit = dollarPerPackUnit(row);
  if (perUnit == null) {
    return { price: null, unit: null, status: 'cannot_compare', reason: 'no_price' };
  }

  const packCanon = normalizeUnit(row.pack_unit);
  const targetCanon = normalizeUnit(targetUnit);
  if (!packCanon || !targetCanon) {
    return { price: null, unit: null, status: 'cannot_compare', reason: 'unknown_unit' };
  }
  if (packCanon === targetCanon) {
    return { price: perUnit, unit: targetCanon, status: 'ok', reason: null };
  }

  const packDim = unitDimension(packCanon);
  const targetDim = unitDimension(targetCanon);
  if (!packDim || !targetDim) {
    return { price: null, unit: null, status: 'cannot_compare', reason: 'unknown_unit' };
  }

  if (packDim === targetDim) {
    const converted = convertQty(perUnit, packCanon, targetCanon, densityGPerMl ?? undefined);
    if (converted == null || !Number.isFinite(converted)) {
      return { price: null, unit: null, status: 'cannot_compare', reason: 'unit_mismatch' };
    }
    return { price: converted, unit: targetCanon, status: 'ok', reason: null };
  }

  if (packDim === 'count' || targetDim === 'count') {
    return { price: null, unit: null, status: 'cannot_compare', reason: 'count_bridge' };
  }

  const converted = convertQty(perUnit, packCanon, targetCanon, densityGPerMl ?? undefined);
  if (converted == null || !Number.isFinite(converted)) {
    return { price: null, unit: null, status: 'cannot_compare', reason: 'need_density' };
  }
  return { price: converted, unit: targetCanon, status: 'ok', reason: null };
}

function pickTargetUnit(offers: VendorPriceRow[]): string | null {
  const dims = offers
    .map((o) => unitDimension(normalizeUnit(o.pack_unit)))
    .filter(Boolean);
  if (dims.length === 0) return null;
  if (dims.every((d) => d === 'weight')) return WEIGHT_COMPARE_UNIT;
  const units = offers.map((o) => normalizeUnit(o.pack_unit)).filter(Boolean);
  if (units.length > 0 && units.every((u) => u === units[0])) return units[0] ?? null;
  return null;
}

function latestPricesByVendor(
  db: DB,
  masterId: string,
  locationId: string,
): Map<CompareVendor, VendorPriceRow> {
  const rows = db
    .prepare(
      `
      SELECT vendor, sku, ingredient, pack_size, pack_unit, pack_price, unit_price,
             reconciled_unit_price, master_id
        FROM vendor_prices
       WHERE location_id = ?
         AND master_id = ?
         AND lower(trim(vendor)) IN ('sysco', 'shamrock')
       ORDER BY lower(trim(vendor)), imported_at DESC, id DESC
    `,
    )
    .all(locationId, masterId) as VendorPriceRow[];

  const out = new Map<CompareVendor, VendorPriceRow>();
  for (const row of rows) {
    const v = normVendor(row.vendor);
    if (!isCompareVendor(v) || out.has(v)) continue;
    out.set(v, row);
  }
  return out;
}

function buildOffer(
  vendor: CompareVendor,
  row: VendorPriceRow,
  targetUnit: string | null,
  density: number | null,
): VendorOfferSnapshot {
  if (!targetUnit) {
    return {
      vendor,
      sku: row.sku,
      pack_label: packLabel(row),
      normalized_price: null,
      normalized_unit: null,
      status: 'cannot_compare',
      reason: 'unit_mismatch',
    };
  }
  const comp = computeComparableUnitPrice(row, targetUnit, density);
  return {
    vendor,
    sku: row.sku,
    pack_label: packLabel(row),
    normalized_price: comp.price,
    normalized_unit: comp.unit,
    status: comp.status,
    reason: comp.reason,
  };
}

function pickCheaper(
  sysco: VendorOfferSnapshot | null,
  shamrock: VendorOfferSnapshot | null,
  preferred: string | null,
  locked: boolean,
): CompareVendor | null {
  if (locked) return null;
  if (!sysco || !shamrock) return null;
  if (sysco.status !== 'ok' || shamrock.status !== 'ok') return null;
  if (sysco.normalized_price == null || shamrock.normalized_price == null) return null;

  const s = sysco.normalized_price;
  const h = shamrock.normalized_price;
  const pref = normVendor(preferred);
  if (pref === 'sysco' && h < s) return 'shamrock';
  if (pref === 'shamrock' && s < h) return 'sysco';
  if (!pref) {
    if (s < h) return 'sysco';
    if (h < s) return 'shamrock';
  }
  return null;
}

export function listVendorCompareRows(
  db: DB,
  opts: ListVendorCompareOpts = {},
): VendorCompareSummary {
  const locationId = opts.locationId ?? 'default';
  const limit = clampLimit(opts.limit);

  const masters = db
    .prepare(
      `
      SELECT master_id, canonical_name, preferred_vendor, quality_locked, quality_lock_reason
        FROM ingredient_masters
       ORDER BY canonical_name ASC
       LIMIT ?
    `,
    )
    .all(limit) as Array<{
    master_id: string;
    canonical_name: string;
    preferred_vendor: string | null;
    quality_locked: number;
    quality_lock_reason: string | null;
  }>;

  const rows: VendorCompareRow[] = [];
  let singleVendorOnly = 0;

  for (const m of masters) {
    const byVendor = latestPricesByVendor(db, m.master_id, locationId);
    if (!byVendor.has('sysco') || !byVendor.has('shamrock')) {
      if (byVendor.size > 0) singleVendorOnly++;
      continue;
    }

    const syscoRow = byVendor.get('sysco')!;
    const shamrockRow = byVendor.get('shamrock')!;
    const targetUnit = pickTargetUnit([syscoRow, shamrockRow]);

    const key = normalizeIngredientKey(syscoRow.ingredient || shamrockRow.ingredient || '');
    const densityRow = key
      ? (db
          .prepare(`SELECT g_per_ml FROM ingredient_densities WHERE ingredient_key = ?`)
          .get(key) as { g_per_ml: number } | undefined)
      : undefined;
    const density = densityRow?.g_per_ml ?? null;

    const sysco = buildOffer('sysco', syscoRow, targetUnit, density);
    const shamrock = buildOffer('shamrock', shamrockRow, targetUnit, density);
    const comparable = sysco.status === 'ok' && shamrock.status === 'ok';
    const locked = Boolean(m.quality_locked);

    rows.push({
      master_id: m.master_id,
      canonical_name: m.canonical_name,
      preferred_vendor: m.preferred_vendor,
      quality_locked: locked,
      quality_lock_reason: m.quality_lock_reason,
      sysco,
      shamrock,
      compare_status: comparable ? 'comparable' : 'cannot_compare',
      cheaper_vendor: pickCheaper(sysco, shamrock, m.preferred_vendor, locked),
    });
  }

  return {
    mapped_pair_count: masters.length,
    masters_with_both_vendors: rows.length,
    masters_single_vendor_only: singleVendorOnly,
    rows,
  };
}
