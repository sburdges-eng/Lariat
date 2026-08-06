#!/usr/bin/env node
// scripts/import-master-catalog.mjs
//
// Import the "Master Product Catalog" export into vendor_prices.
//
// WHY THIS EXISTS
// ---------------
// On 2026-08-01 this catalog reached vendor_prices some other way and left 334
// rows carrying a name, a SKU and a category but no pack size and no price.
// Price-less rows are not harmless: they read downstream as "we don't know
// what this costs", and they sit alongside correctly-priced rows for the same
// item under a different spelling ("Pangasius Filet" vs "Pangasius Fillet"),
// so the good price stops being found.
//
// Two rules follow from that, and they are the whole design:
//
//   1. A row without a usable price is NOT imported. It is reported.
//   2. A pack size that cannot be read exactly is NOT guessed. It is reported.
//
// Everything written goes through validateVendorPriceRow / upsertVendorPrice
// in lib/vendorPricesRepo.ts, which snapshots vendor_prices_history on update
// and rejects a non-positive price. The 2026-08-01 rows could not have come
// through that path — it would have refused them.
//
// The catalog is business data and lives outside the repo
// (~/Dev/lariat-data-sources). Pass its path; nothing is vendored in.
//
// Usage:
//   node --experimental-strip-types scripts/import-master-catalog.mjs <catalog.csv>
//   node --experimental-strip-types scripts/import-master-catalog.mjs <catalog.csv> --apply
//
// Dry run is the default and prints exactly what --apply would write.
// Exit 1 on a file that yields no importable rows (a parse regression looks
// identical to an empty file otherwise).

import fs from 'node:fs';
import path from 'node:path';

const { parseMasterCatalog } = await import('../lib/masterCatalogParse.ts');
const { getDb } = await import('../lib/db.ts');
const { upsertVendorPrice, validateVendorPriceRow } = await import(
  '../lib/vendorPricesRepo.ts'
);

const argv = process.argv.slice(2);
const apply = argv.includes('--apply');
const locIdx = argv.indexOf('--location');
const locationId = locIdx !== -1 ? argv[locIdx + 1] : 'default';
// Skip the value that belongs to --location, but only when the flag is present
// (indexOf returns -1, and argv[-1 + 1] is the file path itself).
const locValueIdx = locIdx === -1 ? -1 : locIdx + 1;
const file = argv.find((a, i) => !a.startsWith('--') && i !== locValueIdx);

if (!file) {
  process.stderr.write(
    'usage: import-master-catalog.mjs <catalog.csv> [--apply] [--location <id>]\n',
  );
  process.exit(2);
}
if (!fs.existsSync(file)) {
  process.stderr.write(`import-master-catalog: no such file: ${file}\n`);
  process.exit(2);
}

const { rows, skipped, total } = parseMasterCatalog(fs.readFileSync(file, 'utf8'));

process.stdout.write(`\nmaster catalog: ${path.basename(file)}\n`);
process.stdout.write(`  data rows        ${total}\n`);
process.stdout.write(`  importable       ${rows.length}\n`);
process.stdout.write(`  skipped          ${skipped.length}\n`);

if (skipped.length) {
  const byReason = new Map();
  for (const s of skipped) {
    // Collapse the quoted specimen so reasons group.
    const key = s.reason.replace(/"[^"]*"/, '"…"');
    if (!byReason.has(key)) byReason.set(key, []);
    byReason.get(key).push(s);
  }
  process.stdout.write('\n  not imported:\n');
  for (const [reason, group] of [...byReason.entries()].sort(
    (a, b) => b[1].length - a[1].length,
  )) {
    process.stdout.write(`    ${String(group.length).padStart(4)}  ${reason}\n`);
    // Name a few so the operator can go look, but don't dump 400 lines.
    for (const s of group.slice(0, 3)) {
      process.stdout.write(`          line ${s.line}: ${s.ingredient}\n`);
    }
    if (group.length > 3) {
      process.stdout.write(`          … and ${group.length - 3} more\n`);
    }
  }
}

// A file that parses to nothing is indistinguishable from a parser regression.
// Fail loudly rather than reporting a clean no-op.
if (rows.length === 0) {
  process.stderr.write(
    '\nimport-master-catalog: no importable rows. Refusing to report success.\n',
  );
  process.exit(1);
}

// Validate everything before writing anything, so a bad row can't leave the
// table half-updated.
const invalid = [];
for (const r of rows) {
  const v = validateVendorPriceRow({ ...r, location_id: locationId });
  if (!v.ok) invalid.push({ ingredient: r.ingredient, errors: v.errors });
}
if (invalid.length) {
  process.stderr.write(`\nimport-master-catalog: ${invalid.length} row(s) failed validation:\n`);
  for (const b of invalid.slice(0, 10)) {
    process.stderr.write(`  ${b.ingredient}: ${b.errors.join('; ')}\n`);
  }
  process.exit(1);
}

if (!apply) {
  process.stdout.write('\n  DRY RUN — nothing written. Re-run with --apply.\n\n');
  const preview = rows.slice(0, 5);
  for (const r of preview) {
    process.stdout.write(
      `    ${r.ingredient.slice(0, 38).padEnd(38)} ${String(r.pack_size).padStart(7)} ${r.pack_unit.padEnd(4)}` +
        ` $${r.pack_price.toFixed(2).padStart(8)}  →  $${r.unit_price.toFixed(4)}/${r.pack_unit}\n`,
    );
  }
  if (rows.length > preview.length) {
    process.stdout.write(`    … and ${rows.length - preview.length} more\n`);
  }
  process.stdout.write('\n');
  process.exit(0);
}

const db = getDb();
const counts = { inserted: 0, updated: 0, skipped: 0 };
const write = db.transaction(() => {
  for (const r of rows) {
    const { outcome } = upsertVendorPrice(db, { ...r, location_id: locationId });
    counts[outcome]++;
  }
});
write();

process.stdout.write(
  `\n  wrote: ${counts.inserted} inserted, ${counts.updated} updated, ` +
    `${counts.skipped} already identical\n\n`,
);
