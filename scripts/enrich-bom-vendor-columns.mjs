#!/usr/bin/env node
/**
 * Re-enrich existing bom_lines with vendor columns without a full CSV sync.
 *
 * Targets rows that are still UNMAPPED (or null map_status) — e.g. legacy
 * workbook recipes with no recipes/normalized/<slug>.csv yet. Uses the same
 * two-tier lookup as sync-normalized-to-bom.mjs.
 *
 * Usage:
 *   node --experimental-strip-types scripts/enrich-bom-vendor-columns.mjs
 *   node --experimental-strip-types scripts/enrich-bom-vendor-columns.mjs --dry
 *   LARIAT_DATA_DIR=/path/to/data node --experimental-strip-types scripts/enrich-bom-vendor-columns.mjs
 */
import {
  buildIngredientMapIndex,
  buildVendorPriceIndex,
  resolveVendorEnrichment,
} from './sync-normalized-to-bom.mjs';

import { pathToFileURL } from 'node:url';

const isMain = (() => {
  const arg = process.argv[1];
  if (!arg) return false;
  try {
    return import.meta.url === pathToFileURL(arg).href;
  } catch {
    return false;
  }
})();

export function enrichUnmappedBomLines(db, opts = {}) {
  const locationId = opts.locationId ?? 'default';
  const dryRun = opts.dryRun ?? false;

  const vpIndex = buildVendorPriceIndex(db, locationId);
  const imIndex = buildIngredientMapIndex(db, locationId);

  const rows = db.prepare(`
    SELECT id, ingredient, sub_recipe, map_status
      FROM bom_lines
     WHERE location_id = ?
       AND sub_recipe IS NULL
       AND (map_status IS NULL OR map_status = 'UNMAPPED')
  `).all(locationId);

  const summary = {
    candidates: rows.length,
    enriched: 0,
    still_unmapped: 0,
    tier_1: 0,
    tier_2: 0,
  };

  const upd = db.prepare(`
    UPDATE bom_lines
       SET vendor = ?,
           pack_price = ?,
           pack_size = ?,
           vendor_ingredient = ?,
           map_status = ?,
           yield_pct = ?,
           master_id = ?
     WHERE id = ?
  `);

  const run = dryRun ? () => {} : (fn) => fn();

  for (const row of rows) {
    const enrichment = resolveVendorEnrichment(vpIndex, imIndex, row.ingredient);
    if (!enrichment.mapped) {
      summary.still_unmapped++;
      continue;
    }
    summary.enriched++;
    if (enrichment.tier === 1) summary.tier_1++;
    else summary.tier_2++;

    const mapStatus = enrichment.map_status
      ?? (enrichment.tier === 2 ? 'auto_mapped' : 'mapped');

    run(() => upd.run(
      enrichment.vendor,
      enrichment.pack_price,
      enrichment.pack_size,
      enrichment.vendor_ingredient,
      mapStatus,
      enrichment.yield_pct,
      enrichment.master_id,
      row.id,
    ));
  }

  return summary;
}

if (isMain) {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry') || args.includes('--dry-run');
  const locArg = args.find((a) => a.startsWith('--location='));
  const locationId = locArg ? locArg.split('=', 2)[1] : 'default';

  const { getDb } = await import('../lib/db.ts');
  const db = getDb();
  const summary = enrichUnmappedBomLines(db, { locationId, dryRun });
  console.log(JSON.stringify({ mode: dryRun ? 'dry' : 'apply', location: locationId, summary }, null, 2));
}
