#!/usr/bin/env node
// Option 6: best-effort vendor-match proposals for UNMAPPED bom_lines rows.
//
// Reads bom_lines with a caller-chosen map_status (default UNMAPPED) and
// writes a review-ready CSV of candidate vendor/recipe matches per row.
//
// Input sources (read only, never mutated):
//   - data/lariat.db:bom_lines         (rows to propose against)
//   - data/lariat.db:vendor_prices     (authoritative candidate prices)
//   - data/lariat.db:order_guide_items (lower-trust candidate prices)
//   - data/cache/recipes.json          (house sub-recipe slugs)
//
// Output (default: data/proposals/bom-vendor-matches.csv)
//   bom_line_id, ingredient, qty, unit, candidate_rank, candidate_source,
//   candidate_name, vendor, pack_unit, unit_price, confidence, notes
//
// One output row per (bom_line, candidate). Zero-candidate bom_lines
// still emit one sentinel row with blank candidate columns,
// confidence=none, and a note explaining why (water tap, needs recipe,
// or manual review).
//
// Usage:
//   node scripts/propose-bom-vendor-matches.mjs \
//     [--out <path>] [--status <map_status>] [--location-id <id>]
//
// Exit codes:
//   0 on success (even if zero bom_lines match the status filter)
//   1 on missing DB / unreadable recipes / arg error

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { register } from 'node:module';
import { fileURLToPath } from 'node:url';

register(new URL('../tests/js/resolver.mjs', import.meta.url));

const { getDb } = await import('../lib/db.ts');
const { getRecipes } = await import('../lib/data.ts');
const { proposeVendorMatchesForBom } = await import('../lib/bomVendorProposals.ts');

// ── CSV emit (RFC-4180) ────────────────────────────────────────────

function csvField(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  if (s === '') return '';
  if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

const CSV_HEADER = [
  'bom_line_id',
  'ingredient',
  'qty',
  'unit',
  'candidate_rank',
  'candidate_source',
  'candidate_name',
  'vendor',
  'pack_unit',
  'unit_price',
  'confidence',
  'notes',
];

function proposalToCsvRows(result) {
  const lines = [];
  const { row, candidates, note, classification } = result;
  candidates.forEach((c, idx) => {
    lines.push(
      [
        csvField(row.bom_line_id),
        csvField(row.ingredient),
        csvField(row.qty),
        csvField(row.unit),
        csvField(idx + 1),
        csvField(c.source),
        csvField(c.name),
        csvField(c.vendor),
        csvField(c.pack_unit),
        csvField(c.unit_price),
        csvField(c.confidence),
        csvField(`[${classification}] ${c.reason || note}`),
      ].join(','),
    );
  });
  return lines;
}

// ── CLI ────────────────────────────────────────────────────────────

const isMain =
  import.meta.url === `file://${process.argv[1]}` ||
  fileURLToPath(import.meta.url) === process.argv[1];

if (isMain) {
  const { values } = parseArgs({
    options: {
      out: { type: 'string' },
      status: { type: 'string' },
      'location-id': { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });

  if (values.help) {
    process.stdout.write(
      'Usage: node scripts/propose-bom-vendor-matches.mjs ' +
        '[--out <path>] [--status <map_status>] [--location-id <id>]\n' +
        '\nDefaults: --out=data/proposals/bom-vendor-matches.csv ' +
        '--status=UNMAPPED --location-id=default\n' +
        '\nOutput is REVIEW-READY — no DB writes. Operator approves/edits ' +
        'candidates before applying any vendor mapping.\n',
    );
    process.exit(0);
  }

  const outPath = path.resolve(
    values.out || path.join('data', 'proposals', 'bom-vendor-matches.csv'),
  );
  const status = values.status || 'UNMAPPED';
  const locationId = values['location-id'] || 'default';

  const db = getDb();

  // 1. Fetch bom_lines rows at the requested status.
  const bomRows = db
    .prepare(
      `SELECT id AS bom_line_id, recipe_id, ingredient, qty, unit
         FROM bom_lines
        WHERE map_status = ? AND location_id = ?
        ORDER BY id`,
    )
    .all(status, locationId);

  if (bomRows.length === 0) {
    process.stderr.write(
      `propose-bom-vendor-matches: no bom_lines with map_status="${status}" ` +
        `in location_id="${locationId}"\n`,
    );
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, CSV_HEADER.join(',') + '\n', 'utf8');
    process.exit(0);
  }

  // 2. Load candidate sources.
  const vendorPriceRows = db
    .prepare(
      `SELECT ingredient AS name, vendor, pack_unit, unit_price
         FROM vendor_prices
        WHERE ingredient IS NOT NULL AND ingredient != ''
          AND location_id = ?`,
    )
    .all(locationId);

  const orderGuideRows = db
    .prepare(
      `SELECT ingredient AS name, vendor, unit AS pack_unit, unit_price
         FROM order_guide_items
        WHERE ingredient IS NOT NULL AND ingredient != ''
          AND location_id = ?`,
    )
    .all(locationId);

  const sources = {
    vendorPrices: vendorPriceRows.map((r) => ({
      source: 'vendor_prices',
      name: r.name,
      vendor: r.vendor || '',
      pack_unit: r.pack_unit || '',
      unit_price: r.unit_price ?? null,
    })),
    orderGuide: orderGuideRows.map((r) => ({
      source: 'order_guide',
      name: r.name,
      vendor: r.vendor || '',
      pack_unit: r.pack_unit || '',
      unit_price: r.unit_price ?? null,
    })),
    recipeSlugs: getRecipes().map((r) => r.slug),
  };

  // 3. Run inference per bom_line.
  const results = bomRows.map((r) => proposeVendorMatchesForBom(r, sources));

  // 4. Write CSV.
  const csvLines = [CSV_HEADER.join(',')];
  for (const result of results) {
    for (const line of proposalToCsvRows(result)) {
      csvLines.push(line);
    }
  }
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, csvLines.join('\n') + '\n', 'utf8');

  // 5. Summary on stderr.
  const classCounts = { matched: 0, matched_house_recipe: 0, needs_house_recipe: 0, house: 0, manual: 0 };
  const confCounts = { high: 0, medium: 0, low: 0, none: 0 };
  let rowsWithCandidate = 0;
  for (const r of results) {
    classCounts[r.classification] = (classCounts[r.classification] || 0) + 1;
    const top = r.candidates[0];
    if (top && top.confidence !== 'none') rowsWithCandidate++;
    for (const c of r.candidates) {
      confCounts[c.confidence] = (confCounts[c.confidence] || 0) + 1;
    }
  }

  process.stderr.write(
    `propose-bom-vendor-matches: ${bomRows.length} ${status} rows, ` +
      `${rowsWithCandidate} with ≥1 real candidate, ` +
      `${classCounts.needs_house_recipe} needing house recipe, ` +
      `${classCounts.house} water-like (none) → ${outPath}\n`,
  );
  process.stderr.write(
    `  classification: matched=${classCounts.matched} ` +
      `matched_house_recipe=${classCounts.matched_house_recipe} ` +
      `needs_house_recipe=${classCounts.needs_house_recipe} ` +
      `house=${classCounts.house} ` +
      `manual=${classCounts.manual}\n`,
  );
  process.stderr.write(
    `  top-candidate confidence: high=${results.filter((r) => r.candidates[0]?.confidence === 'high').length} ` +
      `medium=${results.filter((r) => r.candidates[0]?.confidence === 'medium').length} ` +
      `low=${results.filter((r) => r.candidates[0]?.confidence === 'low').length} ` +
      `none=${results.filter((r) => r.candidates[0]?.confidence === 'none').length}\n`,
  );

  // Per-row one-line summary for quick eyeballing.
  for (const r of results) {
    const top = r.candidates[0];
    const topDesc = top
      ? `${top.confidence} ${top.source}:${top.name || '—'}`
      : 'no candidate';
    process.stderr.write(
      `  #${r.row.bom_line_id} "${r.row.ingredient}" [${r.classification}] → ${topDesc}\n`,
    );
  }
}
