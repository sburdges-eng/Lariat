#!/usr/bin/env node
// Option 7: raw-cut vendor proposals for plan_restaurant_grind bom_lines.
//
// These are bom_line rows where the restaurant grinds/processes the
// ingredient in-house (whole peppercorns → cracked pepper, chuck roast
// → ground chuck, etc.). The cost should trace to the RAW input, not
// the finished form, plus a yield percentage and labor cost. This
// script proposes the RAW vendor SKU only — yield_pct and
// labor_cost_per_min are intentionally blank and must be filled by the
// operator from BOH measurement + scheduling.
//
// Input sources (read only, never mutated):
//   - data/lariat.db:bom_lines       (rows at map_status='plan_restaurant_grind')
//   - data/lariat.db:vendor_prices   (candidate raw SKUs)
//
// Output (default: data/proposals/bom-plan-restaurant-grind.csv)
//   bom_line_id, ingredient, qty, unit, candidate_rank, candidate_name,
//   vendor, pack_unit, unit_price, proposed_yield_pct,
//   proposed_labor_cost_per_min, confidence, notes
//
// Anti-scope:
//   - No DB writes.
//   - No invented yield_pct. No invented labor_cost_per_min.
//   - No LLM or external search.
//   - order_guide_items is NOT searched here — raw-cut matching wants
//     authoritative vendor pricing, not placeholder rows.
//
// Usage:
//   node scripts/propose-plan-restaurant-grind.mjs \
//     [--out <path>] [--location-id <id>]
//
// Exit codes:
//   0 on success (even if zero bom_lines match)
//   1 on missing DB / arg error

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { register } from 'node:module';
import { fileURLToPath } from 'node:url';

register(new URL('../tests/js/resolver.mjs', import.meta.url));

const { getDb } = await import('../lib/db.ts');
const { matchRawCutForGrind } = await import('../lib/bomVendorProposals.ts');

const TARGET_STATUS = 'plan_restaurant_grind';

// Canonical guidance text that accompanies every candidate row. Kept
// identical across all emitted rows so the CSV is easy to review at scale.
const YIELD_NOTE =
  'typical 85-92% for beef grind, 70-80% for pork/chicken — fill from BOH measurement';
const LABOR_NOTE =
  'labor rate × minutes / batch_lb — fill from scheduling';
const APPLY_NOTE =
  'raw cost = unit_price × (1/yield_pct); final cost = raw cost + (labor_cost_per_min × minutes_per_lb)';

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
  'candidate_name',
  'vendor',
  'pack_unit',
  'unit_price',
  'proposed_yield_pct',
  'proposed_labor_cost_per_min',
  'confidence',
  'notes',
];

function proposalToCsvRows(result) {
  const lines = [];
  const { row, candidates, note, classification } = result;
  candidates.forEach((c, idx) => {
    const combinedNote = [
      `[${classification}] ${c.reason || note}`,
      `yield_pct: ${YIELD_NOTE}`,
      `labor_cost_per_min: ${LABOR_NOTE}`,
      `apply: ${APPLY_NOTE}`,
    ].join(' | ');
    lines.push(
      [
        csvField(row.bom_line_id),
        csvField(row.ingredient),
        csvField(row.qty),
        csvField(row.unit),
        csvField(idx + 1),
        csvField(c.name),
        csvField(c.vendor),
        csvField(c.pack_unit),
        csvField(c.unit_price),
        csvField(''), // proposed_yield_pct — intentionally blank
        csvField(''), // proposed_labor_cost_per_min — intentionally blank
        csvField(c.confidence),
        csvField(combinedNote),
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
      'location-id': { type: 'string' },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });

  if (values.help) {
    process.stdout.write(
      'Usage: node scripts/propose-plan-restaurant-grind.mjs ' +
        '[--out <path>] [--location-id <id>]\n' +
        `\nTargets bom_lines with map_status="${TARGET_STATUS}".\n` +
        '\nDefaults: --out=data/proposals/bom-plan-restaurant-grind.csv ' +
        '--location-id=default\n' +
        '\nOutput is REVIEW-READY — no DB writes. proposed_yield_pct + ' +
        'proposed_labor_cost_per_min are intentionally blank and must ' +
        'be filled by the operator.\n',
    );
    process.exit(0);
  }

  const outPath = path.resolve(
    values.out || path.join('data', 'proposals', 'bom-plan-restaurant-grind.csv'),
  );
  const locationId = values['location-id'] || 'default';

  const db = getDb();

  // 1. Fetch bom_lines rows at target status.
  const bomRows = db
    .prepare(
      `SELECT id AS bom_line_id, recipe_id, ingredient, qty, unit
         FROM bom_lines
        WHERE map_status = ? AND location_id = ?
        ORDER BY id`,
    )
    .all(TARGET_STATUS, locationId);

  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  if (bomRows.length === 0) {
    process.stderr.write(
      `propose-plan-restaurant-grind: no bom_lines with map_status="${TARGET_STATUS}" ` +
        `in location_id="${locationId}"\n`,
    );
    fs.writeFileSync(outPath, CSV_HEADER.join(',') + '\n', 'utf8');
    process.exit(0);
  }

  // 2. Load vendor_prices as raw-cut candidates.
  const vendorPriceRows = db
    .prepare(
      `SELECT ingredient AS name, vendor, pack_unit, unit_price
         FROM vendor_prices
        WHERE ingredient IS NOT NULL AND ingredient != ''
          AND location_id = ?`,
    )
    .all(locationId);

  const vendorCandidates = vendorPriceRows.map((r) => ({
    source: 'vendor_prices',
    name: r.name,
    vendor: r.vendor || '',
    pack_unit: r.pack_unit || '',
    unit_price: r.unit_price ?? null,
  }));

  // 3. Run matching per bom_line. Widen the per-row candidate cap from
  //    the lib default of 5 so the operator sees the full span of
  //    variety-penalized candidates alongside the clean SPICE-prefixed
  //    bulk forms. A generic bom ingredient like "pepper" can anchor
  //    dozens of catalog rows (red, chile, jalp, chipotle, etc.); 10
  //    keeps the CSV reviewable but gives enough variety for pick.
  const results = bomRows.map((r) =>
    matchRawCutForGrind(r, vendorCandidates, { maxCandidatesPerRow: 10 }),
  );

  // 4. Write CSV.
  const csvLines = [CSV_HEADER.join(',')];
  for (const result of results) {
    for (const line of proposalToCsvRows(result)) {
      csvLines.push(line);
    }
  }
  fs.writeFileSync(outPath, csvLines.join('\n') + '\n', 'utf8');

  // 5. Summary on stderr.
  const confCounts = { high: 0, medium: 0, low: 0, none: 0 };
  let rowsWithHigh = 0;
  let rowsWithCandidate = 0;
  for (const r of results) {
    const top = r.candidates[0];
    if (top && top.confidence !== 'none') rowsWithCandidate++;
    if (top && top.confidence === 'high') rowsWithHigh++;
    for (const c of r.candidates) {
      confCounts[c.confidence] = (confCounts[c.confidence] || 0) + 1;
    }
  }

  process.stderr.write(
    `propose-plan-restaurant-grind: ${bomRows.length} rows, ` +
      `${rowsWithCandidate} with ≥1 candidate, ` +
      `${rowsWithHigh} with a whole/raw form in catalog → ${outPath}\n`,
  );
  process.stderr.write(
    `  top-candidate confidence: high=${results.filter((r) => r.candidates[0]?.confidence === 'high').length} ` +
      `medium=${results.filter((r) => r.candidates[0]?.confidence === 'medium').length} ` +
      `low=${results.filter((r) => r.candidates[0]?.confidence === 'low').length} ` +
      `none=${results.filter((r) => r.candidates[0]?.confidence === 'none').length}\n`,
  );

  for (const r of results) {
    const top = r.candidates[0];
    const topDesc = top
      ? `${top.confidence} ${top.name || '—'}`
      : 'no candidate';
    process.stderr.write(
      `  #${r.row.bom_line_id} "${r.row.ingredient}" → ${topDesc}\n`,
    );
  }
}
