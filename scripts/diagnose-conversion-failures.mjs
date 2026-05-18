#!/usr/bin/env node
/**
 * Diagnostic: classify every BOM row by what would happen during T4
 * volume↔weight conversion. Mirrors _ingestCostingImpl's resolvePackUnit
 * + convertQty code path exactly. Read-only.
 *
 * Usage: LARIAT_DB=/path/to/lariat.db node scripts/diagnose-conversion-failures.mjs
 */
import Database from 'better-sqlite3';
import path from 'path';
import { normalizeIngredientKey } from '../lib/ingredientKey.ts';
import { convertQty, normalizeUnit, unitDimension } from '../lib/unitConvert.mjs';
import { bridgeCount } from './ingest-costing.mjs';

const DB_PATH = process.env.LARIAT_DB || path.join(process.cwd(), 'data', 'lariat.db');
// Audit F7 (2026-05-16): prefer canonical LARIAT_LOCATION_ID, fall through
// to the legacy LARIAT_LOCATION for back-compat. Warn on legacy-only so
// operators migrate before the alias is dropped.
const LOCATION = (process.env.LARIAT_LOCATION_ID || process.env.LARIAT_LOCATION || 'default').trim();
if (!process.env.LARIAT_LOCATION_ID && process.env.LARIAT_LOCATION) {
  console.warn('[diagnose] LARIAT_LOCATION is deprecated — rename to LARIAT_LOCATION_ID.');
}
const db = new Database(DB_PATH, { readonly: true });

const densityByKey = new Map();
for (const r of db.prepare('SELECT ingredient_key, g_per_ml FROM ingredient_densities').all()) {
  densityByKey.set(r.ingredient_key, r.g_per_ml);
}

const unitWeightByKey = new Map();
for (const r of db.prepare('SELECT ingredient_key, unit, g_per_unit FROM ingredient_unit_weights').all()) {
  let inner = unitWeightByKey.get(r.ingredient_key);
  if (!inner) { inner = new Map(); unitWeightByKey.set(r.ingredient_key, inner); }
  inner.set(r.unit, r.g_per_unit);
}

const vpPackUnitByRaw = new Map();
const vpPackUnitByNormKey = new Map();
for (const row of db.prepare(
  `SELECT ingredient, pack_unit FROM vendor_prices
    WHERE location_id = ? ORDER BY imported_at DESC, id DESC`,
).all(LOCATION)) {
  const raw = row.ingredient ?? '';
  if (raw && !vpPackUnitByRaw.has(raw)) vpPackUnitByRaw.set(raw, row.pack_unit);
  const key = normalizeIngredientKey(raw);
  if (key && !vpPackUnitByNormKey.has(key)) vpPackUnitByNormKey.set(key, row.pack_unit);
}
const resolvePackUnit = (bomIngredient, vendorIngredient) => {
  if (vendorIngredient && vpPackUnitByRaw.has(vendorIngredient)) return vpPackUnitByRaw.get(vendorIngredient);
  const vKey = normalizeIngredientKey(vendorIngredient ?? '');
  if (vKey && vpPackUnitByNormKey.has(vKey)) return vpPackUnitByNormKey.get(vKey);
  const bKey = normalizeIngredientKey(bomIngredient ?? '');
  if (bKey && vpPackUnitByNormKey.has(bKey)) return vpPackUnitByNormKey.get(bKey);
  return undefined;
};

const bom = db.prepare(`
  SELECT id, recipe_id, ingredient, vendor_ingredient, unit, qty,
         pack_price, pack_size, map_status
    FROM bom_lines WHERE location_id = ?`).all(LOCATION);

const PROTECTED = new Set(['confirmed', 'mapped', 'auto_mapped']);

const buckets = {
  ok_same_unit: [],
  ok_same_dim: [],
  ok_cross_dim_with_density: [],
  ok_count_bridge: [],
  skip_guard_null_or_zero: [],
  skip_guard_yield_domain: [],
  fail_missing_density: [],
  fail_unknown_pack_unit: [],
  fail_unknown_bom_unit: [],
  fail_count_involved: [],
  fail_bom_empty_vendor_set: [],
  fail_empty_both: [],
  no_vendor_match: [],
};

for (const line of bom) {
  const {
    id, ingredient, vendor_ingredient, unit, qty, pack_price, pack_size, map_status,
  } = line;
  if (qty == null || pack_price == null || pack_size == null ||
      !(qty > 0) || !(pack_price > 0) || !(pack_size > 0) ||
      !Number.isFinite(qty) || !Number.isFinite(pack_price) || !Number.isFinite(pack_size)) {
    buckets.skip_guard_null_or_zero.push(line);
    continue;
  }
  const packUnit = resolvePackUnit(ingredient, vendor_ingredient);
  const bomCanon = normalizeUnit(unit);
  const packCanon = normalizeUnit(packUnit);
  if (!packCanon) {
    buckets.no_vendor_match.push({ ...line, packUnit, bomCanon, packCanon });
    continue;
  }
  if (!bomCanon) {
    buckets.fail_bom_empty_vendor_set.push({ ...line, packUnit });
    continue;
  }
  if (bomCanon === packCanon) {
    buckets.ok_same_unit.push(line);
    continue;
  }
  const bomDim = unitDimension(bomCanon);
  const packDim = unitDimension(packCanon);
  if (!bomDim) { buckets.fail_unknown_bom_unit.push({ ...line, packUnit }); continue; }
  if (!packDim) { buckets.fail_unknown_pack_unit.push({ ...line, packUnit }); continue; }
  if (bomDim === 'count' || packDim === 'count') {
    const key = normalizeIngredientKey(ingredient ?? '');
    const density = key ? densityByKey.get(key) : undefined;
    const weights = key ? unitWeightByKey.get(key) : undefined;
    const bridged = bridgeCount(pack_size, packCanon, bomCanon, density, weights);
    if (bridged !== null && bridged > 0 && Number.isFinite(bridged)) {
      buckets.ok_count_bridge.push({ ...line, packUnit, bridged });
    } else {
      buckets.fail_count_involved.push({ ...line, packUnit, bomDim, packDim, density, weights: weights ? [...weights.entries()] : null });
    }
    continue;
  }
  if (bomDim === packDim) {
    buckets.ok_same_dim.push(line);
    continue;
  }
  const key = normalizeIngredientKey(ingredient ?? '');
  const density = key ? densityByKey.get(key) : undefined;
  const conv = convertQty(pack_size, packUnit, unit, density);
  if (conv !== null && conv > 0 && Number.isFinite(conv)) {
    buckets.ok_cross_dim_with_density.push(line);
  } else {
    buckets.fail_missing_density.push({ ...line, packUnit, key, density });
  }
}

const total = bom.length;
console.log(`\n== T4 conversion bucket summary (${total} BOM rows, location=${LOCATION}) ==\n`);
for (const [name, rows] of Object.entries(buckets)) {
  const protectedCount = rows.filter(r => PROTECTED.has(r.map_status ?? '')).length;
  console.log(`${name.padEnd(35)} ${String(rows.length).padStart(4)}  (${protectedCount} protected)`);
}

function dump(name, rows, max = 999, cols = ['id','ingredient','unit','qty','vendor_ingredient','packUnit','pack_size','map_status','density']) {
  if (rows.length === 0) return;
  console.log(`\n── ${name} — ${rows.length} row(s) ──`);
  for (const r of rows.slice(0, max)) {
    console.log(cols.map(c => `${c}=${JSON.stringify(r[c] ?? null)}`).join('  '));
  }
}

dump('fail_missing_density', buckets.fail_missing_density);
dump('fail_unknown_pack_unit', buckets.fail_unknown_pack_unit);
dump('fail_unknown_bom_unit', buckets.fail_unknown_bom_unit);
dump('fail_count_involved', buckets.fail_count_involved);
dump('fail_bom_empty_vendor_set', buckets.fail_bom_empty_vendor_set);

console.log('\n== ingredients needing density (unique, cross-dim only) ==');
const need = new Map();
for (const r of buckets.fail_missing_density) {
  const key = normalizeIngredientKey(r.ingredient);
  if (!need.has(key)) need.set(key, { ingredient: r.ingredient, rowCount: 0, protected: 0 });
  const n = need.get(key);
  n.rowCount++;
  if (PROTECTED.has(r.map_status ?? '')) n.protected++;
}
for (const [key, info] of [...need.entries()].sort()) {
  console.log(`${key.padEnd(40)} rows=${info.rowCount} protected=${info.protected} name="${info.ingredient}"`);
}

db.close();
