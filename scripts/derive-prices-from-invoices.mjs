#!/usr/bin/env node
// scripts/derive-prices-from-invoices.mjs
//
// Fill in unit_price for vendor_prices rows that have none, by dividing what an
// invoice says was paid for a case by what the Master Product Catalog says a
// case holds.
//
// Neither source is sufficient alone. Invoices know the money and not the size;
// the catalog knows the size and, for 411 of its 752 rows, no money at all.
//
// This writes NOTHING to the database. It emits a CSV for
// scripts/import-vendor-prices.mjs, which validates every row and snapshots
// vendor_prices_history. Review the CSV, then run that importer. A second
// direct writer into vendor_prices is what produced the 2026-08-01 breakage.
//
// Usage:
//   node --experimental-strip-types scripts/derive-prices-from-invoices.mjs \
//     "<master-product-catalog.csv>" [--out <file.csv>] [--location default]

import fs from 'node:fs';
import path from 'node:path';

const { parseMasterCatalog } = await import('../lib/masterCatalogParse.ts');
const { derivePrices, toImporterCsv } = await import(
  '../lib/derivePricesFromInvoices.ts'
);
const { getDb } = await import('../lib/db.ts');

const argv = process.argv.slice(2);
const flagValue = (name) => {
  const i = argv.indexOf(name);
  return i === -1 ? null : argv[i + 1];
};
const outPath = flagValue('--out') ?? 'data/derived-vendor-prices.csv';
const locationId = flagValue('--location') ?? 'default';
const flagValues = new Set([outPath, locationId].filter(Boolean));
const catalogPath = argv.find((a) => !a.startsWith('--') && !flagValues.has(a));

if (!catalogPath || !fs.existsSync(catalogPath)) {
  process.stderr.write(
    'usage: derive-prices-from-invoices.mjs <master-product-catalog.csv> ' +
      '[--out <file.csv>] [--location <id>]\n',
  );
  process.exit(2);
}

// ── how big is a case ───────────────────────────────────────────────
// Both the importable rows and the ones skipped for want of a price: a row
// with no price still knows its own pack size, and that is exactly the half
// the invoices cannot supply.
const { rows: priced, skipped } = parseMasterCatalog(
  fs.readFileSync(catalogPath, 'utf8'),
);
const packBySku = new Map();
for (const r of priced) {
  if (r.sku) packBySku.set(r.sku, { pack_size: r.pack_size, pack_unit: r.pack_unit });
}
for (const s of skipped) {
  if (s.sku && s.pack_size != null && !packBySku.has(s.sku)) {
    packBySku.set(s.sku, { pack_size: s.pack_size, pack_unit: s.pack_unit });
  }
}

const db = getDb();

// ── what was paid for one ───────────────────────────────────────────
// Preference order is by how the number was read, not by date: a machine-read
// invoice line beats OCR of a photograph even when the photo is newer.
const qSysco = db.prepare(
  `SELECT unit_price AS pack_price, delivery_date AS date, 'sysco invoice' AS source
     FROM sysco_invoices WHERE sku = ? AND unit_price > 0
    ORDER BY delivery_date DESC LIMIT 1`,
);
const qShamrock = db.prepare(
  `SELECT unit_price AS pack_price, delivery_date AS date, 'shamrock invoice' AS source
     FROM shamrock_invoices WHERE sku = ? AND unit_price > 0
    ORDER BY delivery_date DESC LIMIT 1`,
);
const qPhoto = db.prepare(
  `SELECT l.unit_price AS pack_price, i.invoice_date AS date,
          'photo invoice' AS source, l.parse_confidence AS conf
     FROM photo_invoice_lines l
     JOIN photo_invoices i ON i.id = l.photo_invoice_id
    WHERE l.sku = ? AND l.unit_price > 0
    ORDER BY (l.parse_confidence = 'high') DESC, i.invoice_date DESC LIMIT 1`,
);

const quoteFor = (sku) => {
  const machine = qSysco.get(sku) ?? qShamrock.get(sku);
  if (machine) return { ...machine, confidence: 'invoice' };
  const photo = qPhoto.get(sku);
  if (!photo) return null;
  return {
    pack_price: photo.pack_price,
    date: photo.date,
    source: photo.source,
    confidence: photo.conf === 'high' ? 'photo-high' : 'photo-low',
  };
};

const items = db
  .prepare(
    `SELECT ingredient, vendor, sku FROM vendor_prices
      WHERE location_id = ? AND unit_price IS NULL AND COALESCE(sku,'') != ''
      ORDER BY ingredient`,
  )
  .all(locationId);

const { derived, unresolved } = derivePrices(items, quoteFor, (sku) =>
  packBySku.get(sku) ?? null,
);

process.stdout.write(`\nprice-less rows with a sku : ${items.length}\n`);
process.stdout.write(`derived                    : ${derived.length}\n`);
process.stdout.write(`still unresolved           : ${unresolved.length}\n`);

if (unresolved.length) {
  const byReason = new Map();
  for (const u of unresolved) {
    byReason.set(u.reason, (byReason.get(u.reason) ?? 0) + 1);
  }
  process.stdout.write('\nnot derived:\n');
  for (const [reason, n] of [...byReason].sort((a, b) => b[1] - a[1])) {
    process.stdout.write(`  ${String(n).padStart(4)}  ${reason}\n`);
  }
}

const bySource = new Map();
for (const d of derived) {
  const key = d.notes.slice('derived: '.length).split(' ')[0] + ' ' +
    d.notes.slice('derived: '.length).split(' ')[1];
  bySource.set(key, (bySource.get(key) ?? 0) + 1);
}
if (bySource.size) {
  process.stdout.write('\nderived from:\n');
  for (const [src, n] of [...bySource].sort((a, b) => b[1] - a[1])) {
    process.stdout.write(`  ${String(n).padStart(4)}  ${src}\n`);
  }
}

if (derived.length === 0) {
  process.stderr.write('\nderive-prices: nothing derived. Refusing to write an empty file.\n');
  process.exit(1);
}

fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
fs.writeFileSync(outPath, toImporterCsv(derived, new Date().toISOString()), 'utf8');

process.stdout.write(`\nwrote ${derived.length} rows → ${outPath}\n`);
process.stdout.write(
  'Nothing has been written to the database. Review the CSV, then:\n' +
    `  node --experimental-strip-types scripts/import-vendor-prices.mjs ${outPath} --dry-run\n\n`,
);
