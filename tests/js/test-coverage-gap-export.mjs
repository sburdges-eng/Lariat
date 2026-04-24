// Tests for scripts/export-coverage-gap.mjs + lib/dishCoverageReport.ts.
//
// Fixture: temp cwd with data/lariat.db + data/cache/recipes.json. Three
// dishes exercised — one fully_linked, one declared_only, one unlinked —
// plus a revenue-threshold case so the --min-revenue and --include-unlinked
// flags can each be asserted in isolation.
//
// All assertions drive the CLI via spawnSync (parent test process already
// has data/cache bound to the real repo, so we can't piggyback on it for
// the fixture — children get their own cwd).

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

register(new URL('./resolver.mjs', import.meta.url));

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = path.resolve(path.dirname(__filename), '..', '..');
const EXPORT_SCRIPT = path.join(REPO_ROOT, 'scripts', 'export-coverage-gap.mjs');
const IMPORT_SCRIPT = path.join(REPO_ROOT, 'scripts', 'import-dish-components.mjs');

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-coverage-gap-'));
const CHILD_CWD = path.join(TMP_DIR, 'cwd');
fs.mkdirSync(path.join(CHILD_CWD, 'data', 'cache'), { recursive: true });
const TMP_DB = path.join(CHILD_CWD, 'data', 'lariat.db');
const CSV_DIR = path.join(TMP_DIR, 'csv');
fs.mkdirSync(CSV_DIR, { recursive: true });

// ── Fixture recipe + sales seed ──────────────────────────────────
//
// Dish layout:
//   - "Fully Linked Burger" → has dish_components row (fully_linked bucket)
//   - "Declared Only Tacos" → recipe.menu_items declares a link, but no
//       dish_components row (declared_only bucket, emits ONE gap row)
//   - "Unlinked Drink" → no recipe link at all (unlinked bucket)
//   - "Tiny Dish" → declared_only but revenue below threshold (filter test)
const FIXTURE_RECIPES = [
  {
    slug: 'bacon_jam',
    name: 'Bacon Jam',
    yield_qty: 4,
    yield_unit: 'qt',
    ingredients: [],
    menu_items: ['Fully Linked Burger'],
  },
  {
    slug: 'birria',
    name: 'Birria',
    yield_qty: 1,
    yield_unit: 'gal',
    ingredients: [],
    menu_items: ['Declared Only Tacos'],
  },
  {
    slug: 'tiny_sauce',
    name: 'Tiny Sauce',
    yield_qty: 1,
    yield_unit: 'cup',
    ingredients: [],
    menu_items: ['Tiny Dish'],
  },
];

const dbMod = await import('../../lib/db.ts');

dbMod.setDbPathForTest(TMP_DB);
const testDb = dbMod.getDb();

fs.writeFileSync(
  path.join(CHILD_CWD, 'data', 'cache', 'recipes.json'),
  JSON.stringify(FIXTURE_RECIPES, null, 2),
);

after(() => {
  dbMod.setDbPathForTest(null);
  try {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

beforeEach(() => {
  // Fresh slate for each test: wipe the tables the gap exporter reads from.
  const db = openFresh();
  db.exec(`
    DELETE FROM dish_components;
    DELETE FROM recipe_costs;
    DELETE FROM sales_lines;
    DELETE FROM vendor_prices;
    DELETE FROM order_guide_items;
  `);
  dbMod.setDbPathForTest(null); // close so the child sees a clean WAL
});

function openFresh() {
  dbMod.setDbPathForTest(null);
  dbMod.setDbPathForTest(TMP_DB);
  return dbMod.getDb();
}

function seedRecipeCost(slug, name, costPerYield, yieldUnit) {
  const db = openFresh();
  db.prepare(
    `INSERT INTO recipe_costs
       (recipe_id, recipe_name, cost_per_yield_unit, yield_unit, location_id)
     VALUES (?, ?, ?, ?, 'default')
     ON CONFLICT(recipe_id) DO UPDATE SET
       recipe_name = excluded.recipe_name,
       cost_per_yield_unit = excluded.cost_per_yield_unit,
       yield_unit = excluded.yield_unit`,
  ).run(slug, name, costPerYield, yieldUnit);
  dbMod.setDbPathForTest(null);
}

function seedDishComponentRecipe(dishName, slug, qty, unit) {
  const db = openFresh();
  db.prepare(
    `INSERT INTO dish_components
       (location_id, dish_name, component_type, recipe_slug, vendor_ingredient,
        qty_per_serving, unit)
     VALUES ('default', ?, 'recipe', ?, NULL, ?, ?)
     ON CONFLICT(location_id, dish_name, recipe_slug) WHERE component_type='recipe'
       DO UPDATE SET qty_per_serving = excluded.qty_per_serving, unit = excluded.unit`,
  ).run(dishName, slug, qty, unit);
  dbMod.setDbPathForTest(null);
}

function seedSales(itemName, qty, rev) {
  const db = openFresh();
  db.prepare(
    `INSERT INTO sales_lines (item_name, quantity_sold, net_sales, location_id)
     VALUES (?, ?, ?, 'default')`,
  ).run(itemName, qty, rev);
  dbMod.setDbPathForTest(null);
}

function runExporter(extraArgs = [], outName = 'gap.csv') {
  const outPath = path.join(CSV_DIR, outName);
  const r = spawnSync(
    'node',
    [EXPORT_SCRIPT, '--out', outPath, ...extraArgs],
    { cwd: CHILD_CWD, encoding: 'utf8' },
  );
  return { ...r, outPath };
}

function runImporter(csvPath, extraArgs = []) {
  return spawnSync('node', [IMPORT_SCRIPT, csvPath, ...extraArgs], {
    cwd: CHILD_CWD,
    encoding: 'utf8',
  });
}

// RFC-4180 parse matching the importer's own parseCsv shape — enough to
// read back what the exporter wrote in these tests.
function parseCsv(text) {
  const src = text.replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      continue;
    }
    if (c === ',') {
      row.push(field);
      field = '';
      continue;
    }
    if (c === '\r') continue;
    if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      continue;
    }
    field += c;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function readCsvAsObjects(outPath) {
  const raw = parseCsv(fs.readFileSync(outPath, 'utf8'));
  if (raw.length === 0) return { header: [], rows: [] };
  const header = raw[0];
  const rows = [];
  for (let i = 1; i < raw.length; i++) {
    const fields = raw[i];
    if (fields.length === 0) continue;
    if (fields.length === 1 && fields[0] === '') continue;
    const obj = {};
    for (let j = 0; j < header.length; j++) obj[header[j]] = fields[j] ?? '';
    rows.push(obj);
  }
  return { header, rows };
}

// ── Tests ────────────────────────────────────────────────────────

describe('export-coverage-gap.mjs', () => {
  it('default export emits only declared_only gap rows (skips fully_linked and unlinked)', () => {
    // Fully linked: has dish_components row
    seedRecipeCost('bacon_jam', 'Bacon Jam', 4, 'qt');
    seedDishComponentRecipe('fully linked burger', 'bacon_jam', 0.5, 'cup');
    seedSales('Fully Linked Burger', 10, 100);

    // Declared only: recipe declares link, no dish_components row
    seedRecipeCost('birria', 'Birria', 8, 'gal');
    seedSales('Declared Only Tacos', 20, 500);

    // Unlinked: no recipe link
    seedSales('Unlinked Drink', 5, 50);

    const r = runExporter([], 'default.csv');
    assert.equal(r.status, 0, `exporter failed: ${r.stderr}\n${r.stdout}`);

    const { header, rows } = readCsvAsObjects(r.outPath);
    assert.deepEqual(header, [
      'dish_name',
      'component_type',
      'recipe_slug',
      'vendor_ingredient',
      'qty_per_serving',
      'unit',
      'notes',
    ]);
    assert.equal(rows.length, 1, 'only one declared_only gap row expected');
    const row = rows[0];
    assert.equal(row.dish_name, 'Declared Only Tacos');
    assert.equal(row.component_type, 'recipe');
    assert.equal(row.recipe_slug, 'birria');
    assert.equal(row.vendor_ingredient, '');
    assert.equal(row.qty_per_serving, '', 'qty_per_serving must be blank');
    assert.equal(row.unit, 'gal', 'unit pre-filled from recipe yield_unit');
    assert.match(row.notes, /declared_only/);
    assert.match(row.notes, /\$500\.00/);

    // Summary lands on stderr, not stdout.
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /1 rows \(1 dish/);
  });

  it('--include-unlinked adds one blank row per unlinked dish', () => {
    seedRecipeCost('birria', 'Birria', 8, 'gal');
    seedSales('Declared Only Tacos', 20, 500);
    seedSales('Unlinked Drink', 5, 50);

    const r = runExporter(['--include-unlinked'], 'unlinked.csv');
    assert.equal(r.status, 0, r.stderr);

    const { rows } = readCsvAsObjects(r.outPath);
    assert.equal(rows.length, 2);

    const declared = rows.find((x) => x.dish_name === 'Declared Only Tacos');
    const unlinked = rows.find((x) => x.dish_name === 'Unlinked Drink');
    assert.ok(declared, 'declared_only row present');
    assert.ok(unlinked, 'unlinked row present');

    // Declared row carries component metadata.
    assert.equal(declared.component_type, 'recipe');
    assert.equal(declared.recipe_slug, 'birria');

    // Unlinked row is blank for everything except dish_name + notes.
    assert.equal(unlinked.component_type, '');
    assert.equal(unlinked.recipe_slug, '');
    assert.equal(unlinked.vendor_ingredient, '');
    assert.equal(unlinked.qty_per_serving, '');
    assert.equal(unlinked.unit, '');
    assert.match(unlinked.notes, /unlinked/);
    assert.match(unlinked.notes, /\$50\.00/);

    // Revenue-desc ordering: declared at $500 beats unlinked at $50.
    assert.equal(rows[0].dish_name, 'Declared Only Tacos');
  });

  it('--min-revenue filters both declared_only and unlinked dishes', () => {
    seedRecipeCost('birria', 'Birria', 8, 'gal');
    seedSales('Declared Only Tacos', 20, 500); // passes $100 threshold
    seedRecipeCost('tiny_sauce', 'Tiny Sauce', 3, 'cup');
    seedSales('Tiny Dish', 1, 10); // filtered
    seedSales('Unlinked Drink', 5, 50); // filtered
    seedSales('Big Unlinked', 8, 800); // passes

    const r = runExporter(
      ['--include-unlinked', '--min-revenue', '100'],
      'minrev.csv',
    );
    assert.equal(r.status, 0, r.stderr);

    const { rows } = readCsvAsObjects(r.outPath);
    const names = rows.map((x) => x.dish_name).sort();
    assert.deepEqual(
      names,
      ['Big Unlinked', 'Declared Only Tacos'],
      'only dishes above threshold present',
    );
  });

  it('sorts by revenue desc across dishes; groups components within a dish', () => {
    // High-revenue declared_only dish with 2 components beats low-revenue dish.
    const extraRecipes = [
      ...FIXTURE_RECIPES,
      {
        slug: 'high_a',
        name: 'High A',
        yield_qty: 1,
        yield_unit: 'qt',
        ingredients: [],
        menu_items: ['High Dish'],
      },
      {
        slug: 'high_b',
        name: 'High B',
        yield_qty: 1,
        yield_unit: 'cup',
        ingredients: [],
        menu_items: ['High Dish'],
      },
    ];
    fs.writeFileSync(
      path.join(CHILD_CWD, 'data', 'cache', 'recipes.json'),
      JSON.stringify(extraRecipes, null, 2),
    );

    seedRecipeCost('high_a', 'High A', 1, 'qt');
    seedRecipeCost('high_b', 'High B', 1, 'cup');
    seedSales('High Dish', 50, 5000);

    seedRecipeCost('birria', 'Birria', 8, 'gal');
    seedSales('Declared Only Tacos', 20, 500);

    const r = runExporter([], 'sorted.csv');
    assert.equal(r.status, 0, r.stderr);
    const { rows } = readCsvAsObjects(r.outPath);
    assert.equal(rows.length, 3);

    // First two rows are High Dish's two components, then Declared Only Tacos.
    assert.equal(rows[0].dish_name, 'High Dish');
    assert.equal(rows[1].dish_name, 'High Dish');
    assert.equal(rows[2].dish_name, 'Declared Only Tacos');

    // Component ordering is deterministic: high_a before high_b (alphabetical slug).
    assert.equal(rows[0].recipe_slug, 'high_a');
    assert.equal(rows[1].recipe_slug, 'high_b');

    // Restore the standard fixture so the next test is not affected.
    fs.writeFileSync(
      path.join(CHILD_CWD, 'data', 'cache', 'recipes.json'),
      JSON.stringify(FIXTURE_RECIPES, null, 2),
    );
  });

  it('round-trip: fill qty/unit and pipe through import-dish-components --dry-run', () => {
    // Skip this end-to-end check if PR #26's importer isn't present yet
    // on the current branch (e.g. when this branch sits above main before
    // #26 merges). The exporter itself is still exercised above; this
    // case is strictly about pipe-compatibility with the importer.
    if (!fs.existsSync(IMPORT_SCRIPT)) {
      return;
    }

    seedRecipeCost('birria', 'Birria', 8, 'gal');
    seedSales('Declared Only Tacos', 20, 500);

    const r = runExporter([], 'roundtrip.csv');
    assert.equal(r.status, 0, r.stderr);

    // Read the gap CSV, fill qty=1 unit=each on each row, write it back.
    const csvText = fs.readFileSync(r.outPath, 'utf8');
    const lines = csvText.split('\n');
    const header = lines[0].split(',');
    const qtyIdx = header.indexOf('qty_per_serving');
    const unitIdx = header.indexOf('unit');

    const filled = [lines[0]];
    for (let i = 1; i < lines.length; i++) {
      if (!lines[i]) {
        filled.push(lines[i]);
        continue;
      }
      const fields = lines[i].split(',');
      fields[qtyIdx] = '1';
      // Leave the unit alone if it's already populated — either the exporter
      // picked one from yield_unit or the operator would override in Excel.
      if (!fields[unitIdx]) fields[unitIdx] = 'each';
      filled.push(fields.join(','));
    }
    const filledPath = path.join(CSV_DIR, 'filled.csv');
    fs.writeFileSync(filledPath, filled.join('\n'));

    const ir = runImporter(filledPath, ['--dry-run']);
    assert.equal(ir.status, 0, `importer --dry-run rejected output: ${ir.stderr}\n${ir.stdout}`);
    assert.match(ir.stdout, /DRY RUN/);
    assert.match(
      ir.stdout,
      /1 valid, 0 errored/,
      `expected all rows to pass importer validation: ${ir.stdout}`,
    );
  });
});
