#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';
import Database from 'better-sqlite3';
import { initSchema, DB_FILE } from '../lib/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PY = path.join(__dirname, 'ingest_costing.py');
const DEFAULT_COSTING = path.join(ROOT, 'XL', 'Lariat_Master_Costing_2026-04-09.xlsx');
const DEFAULT_OPS = path.join(ROOT, 'XL', 'lariat_operations_workbook_2026-04-10.xlsx');

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
initSchema(db);

const del = (sql) => db.prepare(sql).run(LOC);

db.transaction(() => {
  del('DELETE FROM vendor_prices WHERE location_id = ?');
  del('DELETE FROM recipe_costs WHERE location_id = ?');
  del('DELETE FROM bom_lines WHERE location_id = ?');
  del('DELETE FROM ingredient_maps WHERE location_id = ?');
  del('DELETE FROM order_guide_items WHERE location_id = ?');

  const ivp = db.prepare(`
    INSERT INTO vendor_prices (ingredient, vendor, sku, pack_size, pack_unit, pack_price, unit_price, category, location_id)
    VALUES (?,?,?,?,?,?,?,?,?)
  `);
  for (const r of data.vendor_prices || []) {
    ivp.run(
      r.ingredient,
      r.vendor,
      r.sku ?? '',
      r.pack_size ?? null,
      r.pack_unit ?? '',
      r.pack_price ?? null,
      r.unit_price ?? null,
      r.category ?? null,
      LOC
    );
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
      LOC
    );
  }

  const ibom = db.prepare(`
    INSERT INTO bom_lines (recipe_id, ingredient, qty, unit, sub_recipe, vendor_ingredient, map_status, vendor, pack_price, pack_size, location_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
  `);
  for (const r of data.bom_lines || []) {
    if (!r.recipe_id) continue;
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
      LOC
    );
  }

  const iim = db.prepare(`
    INSERT INTO ingredient_maps (recipe_ingredient, vendor_ingredient, status, location_id)
    VALUES (?,?,?,?)
  `);
  for (const r of data.ingredient_maps || []) {
    iim.run(r.recipe_ingredient, r.vendor_ingredient ?? '', r.status ?? '', LOC);
  }

  const iog = db.prepare(`
    INSERT INTO order_guide_items (ingredient, base_qty, unit, vendor, unit_price, location_id)
    VALUES (?,?,?,?,?,?)
  `);
  for (const r of data.order_guide || []) {
    iog.run(r.ingredient, r.base_qty ?? null, r.unit ?? '', r.vendor ?? '', r.unit_price ?? null, LOC);
  }
})();

console.log(
  `✓ Costing ingest: ${data.vendor_prices?.length || 0} vendor prices, ${data.recipe_costs?.length || 0} recipe costs, ${data.bom_lines?.length || 0} BOM lines, ${data.ingredient_maps?.length || 0} maps, ${data.order_guide?.length || 0} order guide rows → SQLite (${LOC})`
);
