#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import Database from 'better-sqlite3';
import { initSchema, DB_FILE } from '../lib/db.ts';
import { normalizeIngredientKey } from '../lib/ingredientKey.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PY = path.join(__dirname, 'ingest_costing.py');
const DEFAULT_COSTING = path.join(ROOT, 'XL', 'Lariat_Master_Costing_2026-04-09.xlsx');
const DEFAULT_OPS = path.join(ROOT, 'XL', 'lariat_operations_workbook_2026-04-10.xlsx');

/**
 * Ingest a costing JSON payload (the shape produced by scripts/ingest_costing.py)
 * into the provided SQLite database. Populates vendor_prices.yield_pct and
 * bom_lines.{yield_pct, loss_factor} by joining on the ingredient_yields table
 * via the shared normalizeIngredientKey() normalizer.
 *
 * @param {import('better-sqlite3').Database} db - Open SQLite handle. Caller owns lifecycle.
 * @param {object} data - Parsed payload with arrays: vendor_prices, recipe_costs,
 *                        bom_lines, ingredient_maps, order_guide.
 * @param {string} [locationId='default'] - Tenant scope for the DELETE+INSERT sweep.
 * @returns {{
 *   vendor_prices: number,
 *   recipe_costs: number,
 *   bom_lines: number,
 *   bom_lines_with_yield: number,
 *   bom_coverage_pct: number,
 *   ingredient_maps: number,
 *   order_guide: number,
 * }} Summary of rows inserted and yield-coverage stats.
 */
export function ingestCosting(db, data, locationId = 'default') {
  initSchema(db);

  // Build an in-memory lookup of ingredient_key → {yield_pct, loss_factor} once
  // per ingest. Avoids a per-row SELECT on potentially thousands of BOM rows.
  const yieldLookup = new Map();
  for (const row of db.prepare(
    'SELECT ingredient_key, yield_pct, loss_factor FROM ingredient_yields',
  ).all()) {
    yieldLookup.set(row.ingredient_key, {
      yield_pct: row.yield_pct,
      loss_factor: row.loss_factor,
    });
  }

  const lookup = (rawIngredient) => {
    const key = normalizeIngredientKey(rawIngredient ?? '');
    return yieldLookup.get(key) ?? null;
  };

  const summary = {
    vendor_prices: 0,
    recipe_costs: 0,
    bom_lines: 0,
    bom_lines_with_yield: 0,
    bom_coverage_pct: 0,
    ingredient_maps: 0,
    order_guide: 0,
  };

  const del = (sql) => db.prepare(sql).run(locationId);

  db.transaction(() => {
    del('DELETE FROM vendor_prices WHERE location_id = ?');
    del('DELETE FROM recipe_costs WHERE location_id = ?');
    del('DELETE FROM bom_lines WHERE location_id = ?');
    del('DELETE FROM ingredient_maps WHERE location_id = ?');
    del('DELETE FROM order_guide_items WHERE location_id = ?');

    const ivp = db.prepare(`
      INSERT INTO vendor_prices (ingredient, vendor, sku, pack_size, pack_unit, pack_price, unit_price, category, yield_pct, location_id)
      VALUES (?,?,?,?,?,?,?,?,?,?)
    `);
    for (const r of data.vendor_prices || []) {
      const y = lookup(r.ingredient);
      ivp.run(
        r.ingredient,
        r.vendor,
        r.sku ?? '',
        r.pack_size ?? null,
        r.pack_unit ?? '',
        r.pack_price ?? null,
        r.unit_price ?? null,
        r.category ?? null,
        y?.yield_pct ?? null, // NULL on miss — NEVER default to 1.0 (would silently poison COGS)
        locationId,
      );
      summary.vendor_prices++;
    }

    const irc = db.prepare(`
      INSERT INTO recipe_costs (recipe_id, recipe_name, category, yield, yield_unit, batch_cost, cost_per_yield_unit, costed_lines, total_lines, interpretations, location_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)
    `);
    for (const r of data.recipe_costs || []) {
      if (!r.recipe_id) continue;
      irc.run(
        r.recipe_id,
        r.recipe_name,
        r.category ?? '',
        r.yield ?? null,
        r.yield_unit ?? '',
        r.batch_cost ?? null,
        r.cost_per_yield_unit ?? null,
        r.costed_lines ?? null,
        r.total_lines ?? null,
        r.interpretations ?? null,
        locationId,
      );
      summary.recipe_costs++;
    }

    const ibom = db.prepare(`
      INSERT INTO bom_lines (recipe_id, ingredient, qty, unit, sub_recipe, vendor_ingredient, map_status, vendor, pack_price, pack_size, yield_pct, loss_factor, location_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    `);
    for (const r of data.bom_lines || []) {
      if (!r.recipe_id) continue;
      const y = lookup(r.ingredient);
      const yieldPct = y?.yield_pct ?? null;
      const lossFactor = y?.loss_factor ?? null;
      ibom.run(
        r.recipe_id,
        r.ingredient ?? '',
        r.qty ?? null,
        r.unit ?? '',
        r.sub_recipe ?? null,
        r.vendor_ingredient ?? null,
        r.map_status ?? null,
        r.vendor ?? null,
        r.pack_price ?? null,
        r.pack_size ?? null,
        yieldPct, // NULL on miss — see comment on vendor_prices insert above
        lossFactor,
        locationId,
      );
      summary.bom_lines++;
      if (yieldPct !== null) summary.bom_lines_with_yield++;
    }

    const iim = db.prepare(`
      INSERT INTO ingredient_maps (recipe_ingredient, vendor_ingredient, status, location_id)
      VALUES (?,?,?,?)
    `);
    for (const r of data.ingredient_maps || []) {
      iim.run(r.recipe_ingredient, r.vendor_ingredient ?? '', r.status ?? '', locationId);
      summary.ingredient_maps++;
    }

    const iog = db.prepare(`
      INSERT INTO order_guide_items (ingredient, base_qty, unit, vendor, unit_price, location_id)
      VALUES (?,?,?,?,?,?)
    `);
    for (const r of data.order_guide || []) {
      iog.run(
        r.ingredient,
        r.base_qty ?? null,
        r.unit ?? '',
        r.vendor ?? '',
        r.unit_price ?? null,
        locationId,
      );
      summary.order_guide++;
    }
  })();

  summary.bom_coverage_pct =
    summary.bom_lines > 0 ? (100 * summary.bom_lines_with_yield) / summary.bom_lines : 0;

  return summary;
}

// ── CLI entrypoint ─────────────────────────────────────────────────
// Only runs when invoked directly (node scripts/ingest-costing.mjs), not when
// imported by the test harness.
function main() {
  const COSTING = process.env.LARIAT_COSTING || DEFAULT_COSTING;
  const OPS = process.env.LARIAT_OPS || DEFAULT_OPS;

  if (!fs.existsSync(COSTING)) {
    console.error('✗ Costing workbook not found:', COSTING);
    process.exit(1);
  }

  const env = { ...process.env, LARIAT_COSTING: COSTING, LARIAT_OPS: fs.existsSync(OPS) ? OPS : '' };

  let data;
  try {
    data = JSON.parse(execSync(`python3 ${JSON.stringify(PY)}`, { maxBuffer: 100 * 1024 * 1024, env }));
  } catch (e) {
    console.error('✗ ingest_costing.py failed:', e.stderr?.toString() || e.message);
    process.exit(1);
  }

  const LOC = 'default';
  const db = new Database(DB_FILE);
  try {
    const summary = ingestCosting(db, data, LOC);

    console.log(
      `✓ Costing ingest: ${summary.vendor_prices} vendor prices, ${summary.recipe_costs} recipe costs, ${summary.bom_lines} BOM lines, ${summary.ingredient_maps} maps, ${summary.order_guide} order guide rows → SQLite (${LOC})`,
    );
    console.log(
      `  yield coverage: ${summary.bom_lines_with_yield}/${summary.bom_lines} bom_lines (${summary.bom_coverage_pct.toFixed(1)}%) have yield_pct populated`,
    );
    if (summary.bom_lines > 0 && summary.bom_coverage_pct < 50) {
      console.warn(
        `⚠ yield coverage ${summary.bom_coverage_pct.toFixed(1)}% is below 50% — ingredient_yields seed may be stale vs current BOM ingredient names`,
      );
    }
  } finally {
    db.close();
  }
}

// Detect direct invocation so `import { ingestCosting }` from tests doesn't
// trigger the CLI path.
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
