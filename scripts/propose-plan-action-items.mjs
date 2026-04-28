#!/usr/bin/env node
// Option 8: action-item list for plan_placeholder_verify_bid and
// plan_replace_franks bom_lines.
//
// These rows are NOT auto-resolvable candidate-match rows — they are
// "manual todo" rows. This script emits a single action-item line per
// bom_line with a recommended next step for the operator to execute:
//
//   - plan_placeholder_verify_bid: confirm vendor bid; update
//     vendor_prices; set map_status='mapped'.
//   - plan_replace_franks: identify replacement SKU for Frank's
//     product(s); list candidate replacements from vendor_prices that
//     look like hot-sauce equivalents (hot sauce, cayenne sauce,
//     louisiana, buffalo); set map_status='mapped'.
//
// Input sources (read only, never mutated):
//   - data/lariat.db:bom_lines       (rows at the two target statuses)
//   - data/lariat.db:vendor_prices   (candidate hot-sauce replacements
//                                     for plan_replace_franks only)
//
// Output (default: data/proposals/bom-plan-action-items.csv)
//   bom_line_id, ingredient, current_map_status, current_vendor,
//   current_unit_price, action_needed, recommended_action, notes
//
// Anti-scope:
//   - No DB writes.
//   - No vendor-matching heuristics beyond the existing proposals lib
//     (general `proposeVendorMatchesForBom`). These are flag-for-user
//     rows, not auto-resolvable.
//   - No LLM or external search.
//
// Usage:
//   node scripts/propose-plan-action-items.mjs \
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
const {
  findHotSauceCandidates,
  recommendedActionFor,
  actionNeededFor,
  notesFor,
} = await import('../lib/bomPlanActionItems.mjs');

const TARGET_STATUSES = ['plan_placeholder_verify_bid', 'plan_replace_franks'];

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
  'current_map_status',
  'current_vendor',
  'current_unit_price',
  'action_needed',
  'recommended_action',
  'notes',
];

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
      'Usage: node scripts/propose-plan-action-items.mjs ' +
        '[--out <path>] [--location-id <id>]\n' +
        `\nTargets bom_lines with map_status IN (${TARGET_STATUSES.map((s) => `"${s}"`).join(', ')}).\n` +
        '\nDefaults: --out=data/proposals/bom-plan-action-items.csv ' +
        '--location-id=default\n' +
        '\nOutput is REVIEW-READY — no DB writes. One row per bom_line ' +
        'with a recommended next-step action.\n',
    );
    process.exit(0);
  }

  const outPath = path.resolve(
    values.out || path.join('data', 'proposals', 'bom-plan-action-items.csv'),
  );
  const locationId = values['location-id'] || 'default';

  const db = getDb();

  // 1. Fetch bom_lines rows at target statuses.
  const placeholders = TARGET_STATUSES.map(() => '?').join(', ');
  const bomRows = db
    .prepare(
      `SELECT id AS bom_line_id, recipe_id, ingredient, qty, unit,
              map_status, vendor, vendor_ingredient, pack_price
         FROM bom_lines
        WHERE map_status IN (${placeholders}) AND location_id = ?
        ORDER BY id`,
    )
    .all(...TARGET_STATUSES, locationId);

  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  if (bomRows.length === 0) {
    process.stderr.write(
      `propose-plan-action-items: no bom_lines with map_status IN ` +
        `(${TARGET_STATUSES.join(', ')}) in location_id="${locationId}"\n`,
    );
    fs.writeFileSync(outPath, CSV_HEADER.join(',') + '\n', 'utf8');
    process.exit(0);
  }

  // 2. Load vendor_prices once; compute hot-sauce candidates once for
  //    plan_replace_franks rows (cheap, fine in memory).
  const vendorPriceRows = db
    .prepare(
      `SELECT ingredient AS name, vendor, pack_unit, unit_price
         FROM vendor_prices
        WHERE ingredient IS NOT NULL AND ingredient != ''
          AND location_id = ?`,
    )
    .all(locationId);

  const hotSauceCandidates = findHotSauceCandidates(vendorPriceRows);

  // 3. Emit one action row per bom_line.
  const csvLines = [CSV_HEADER.join(',')];
  const counts = { plan_placeholder_verify_bid: 0, plan_replace_franks: 0, other: 0 };

  for (const row of bomRows) {
    const candidatesForRow =
      row.map_status === 'plan_replace_franks' ? hotSauceCandidates : [];
    const action = recommendedActionFor(row, candidatesForRow);
    if (counts[row.map_status] !== undefined) counts[row.map_status] += 1;
    else counts.other += 1;

    csvLines.push(
      [
        csvField(row.bom_line_id),
        csvField(row.ingredient),
        csvField(row.map_status),
        csvField(row.vendor || ''),
        csvField(row.pack_price ?? ''),
        csvField(actionNeededFor(row)),
        csvField(action),
        csvField(notesFor(row)),
      ].join(','),
    );
  }
  fs.writeFileSync(outPath, csvLines.join('\n') + '\n', 'utf8');

  // 4. Summary.
  process.stderr.write(
    `propose-plan-action-items: ${bomRows.length} rows ` +
      `(verify_bid=${counts.plan_placeholder_verify_bid}, ` +
      `replace_franks=${counts.plan_replace_franks}, other=${counts.other}) ` +
      `→ ${outPath}\n`,
  );
  process.stderr.write(
    `  hot-sauce candidates found in vendor_prices: ${hotSauceCandidates.length}\n`,
  );
  for (const row of bomRows) {
    process.stderr.write(
      `  #${row.bom_line_id} "${row.ingredient}" [${row.map_status}] → ${actionNeededFor(row)}\n`,
    );
  }
}
