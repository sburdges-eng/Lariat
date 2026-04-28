// Backfill entities_vendors from existing source tables.
//
// Vendor TEXT lives across many tables; we union the distinct values
// from the most reliable sources. Each distinct (normalized) vendor
// name → one entities_vendors row.
//
// Tagging:
//   - "Shamrock*" / "Sysco*" / "Webstaurant*" get their own source_system
//     so a future "Shamrock-only spend" query can filter on
//     external_ids.source_system without a string scan.
//   - Everything else is tagged 'manual'.

import { resolveOrCreateVendor } from '../../lib/entities.ts';
import { makeTally, bumpTally, vendorExternalId, vendorSourceSystem } from './lib.mjs';

const VENDOR_SOURCE_TABLES = [
  // (table, column). Listed explicitly so a new vendor-bearing table
  // requires a deliberate code change.
  ['vendor_prices', 'vendor'],
  ['vendor_prices_history', 'vendor'],
  ['bom_lines', 'vendor'],
  ['order_guide_items', 'vendor'],
  ['vendor_catch_weights', 'vendor'],
];

function tableExists(db, name) {
  return Boolean(
    db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`).get(name),
  );
}

function distinctVendorNames(db) {
  const seen = new Map(); // normalized → original (first-seen casing)
  for (const [t, col] of VENDOR_SOURCE_TABLES) {
    if (!tableExists(db, t)) continue;
    const cols = db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
    if (!cols.includes(col)) continue;
    const rows = db
      .prepare(`SELECT DISTINCT ${col} AS v FROM ${t} WHERE ${col} IS NOT NULL AND TRIM(${col}) != ''`)
      .all();
    for (const r of rows) {
      const original = String(r.v).trim();
      const normalized = vendorExternalId(original);
      if (!normalized) continue;
      if (!seen.has(normalized)) seen.set(normalized, original);
    }
  }
  // Invoice-issuing vendors aren't in the table list above (they're
  // in shamrock_invoices.vendor / sysco_invoices is implicit by table
  // name). Hard-code them so they always exist post-backfill, even on
  // a fresh DB with no invoice imports yet.
  if (tableExists(db, 'shamrock_invoices') && !seen.has('shamrock')) {
    seen.set('shamrock', 'Shamrock Foods');
  }
  if (tableExists(db, 'sysco_invoices') && !seen.has('sysco')) {
    seen.set('sysco', 'Sysco');
  }
  return seen;
}

export function backfillVendors(db, { apply = false } = {}) {
  const tally = makeTally();
  const vendors = distinctVendorNames(db);
  for (const [normalized, displayName] of vendors) {
    const source = vendorSourceSystem(normalized);
    if (!apply) {
      const exists = db
        .prepare(
          `SELECT 1 FROM external_ids
            WHERE entity_type='vendor' AND source_system=?
              AND external_id=? AND location_id='default'`,
        )
        .get(source, normalized);
      bumpTally(tally, exists ? 'reused' : 'created');
      continue;
    }
    try {
      const r = resolveOrCreateVendor(db, {
        source_system: source,
        external_id: normalized,
        display_name: displayName,
      });
      bumpTally(tally, r.created ? 'created' : 'reused');
    } catch (err) {
      bumpTally(tally, 'error');
      console.error(`vendors: ${normalized}: ${err.message}`);
    }
  }
  return tally;
}
