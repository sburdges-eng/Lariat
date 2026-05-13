#!/usr/bin/env node
// Tests for scripts/sync-normalized-to-bom.mjs — pure-resolver path
// (CSV rows → entities_recipes + bom_lines) using an in-memory DB.
//
// Run: node --experimental-strip-types --test tests/js/test-sync-normalized-to-bom.mjs

import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const { getDb, setDbPathForTest } = await import('../../lib/db.ts');
const { resolveOrCreateRecipe } = await import('../../lib/entities.ts');
const { parseCsv, syncNormalizedRecipes, SCAFFOLD_SKIP_SLUGS } = await import(
  '../../scripts/sync-normalized-to-bom.mjs'
);

setDbPathForTest(':memory:');
const db = getDb();
after(() => setDbPathForTest(null));

beforeEach(() => {
  db.exec(`
    DELETE FROM bom_lines;
    DELETE FROM entities_recipes;
    DELETE FROM external_ids;
    DELETE FROM vendor_prices;
    DELETE FROM ingredient_maps;
    DELETE FROM ingest_runs WHERE kind = 'sync_normalized_csv';
  `);
});

function seedIngredientMap(recipeIngredient, vendorIngredient, opts = {}) {
  const status = opts.status ?? 'mapped';
  const locationId = opts.location_id ?? 'default';
  db.prepare(`
    INSERT INTO ingredient_maps (recipe_ingredient, vendor_ingredient, status, location_id)
    VALUES (?, ?, ?, ?)
  `).run(recipeIngredient, vendorIngredient, status, locationId);
}

function seedVendorPrice(overrides = {}) {
  const row = {
    ingredient: 'tomato',
    vendor: 'sysco',
    pack_price: 24.0,
    pack_size: 25,
    pack_unit: 'lb',
    yield_pct: 0.95,
    master_id: null,
    location_id: 'default',
    ...overrides,
  };
  db.prepare(`
    INSERT INTO vendor_prices (
      ingredient, vendor, pack_price, pack_size, pack_unit,
      yield_pct, master_id, location_id, imported_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(
    row.ingredient, row.vendor, row.pack_price, row.pack_size, row.pack_unit,
    row.yield_pct, row.master_id, row.location_id,
  );
}

function indexRow(overrides = {}) {
  return {
    recipe_id: 'gazpacho',
    recipe_name: 'Gazpacho',
    category: 'soup',
    yield: '4',
    yield_unit: 'qt',
    ingredient_count: '2',
    sub_recipes: '',
    station: 'saute',
    menu_items: 'Gazpacho (BEO)',
    notes: '',
    ...overrides,
  };
}

function ingRow(overrides = {}) {
  return { ingredient: '', qty: '', unit: '', portions_per_batch: '', notes: '', ...overrides };
}

function call(opts) {
  return syncNormalizedRecipes(db, {
    resolveRecipe: resolveOrCreateRecipe,
    locationId: 'default',
    ...opts,
  });
}

describe('parseCsv', () => {
  it('parses headers + rows + trims whitespace', () => {
    const rows = parseCsv('a,b,c\n 1, 2 ,3\n4,5,6');
    assert.deepEqual(rows, [
      { a: '1', b: '2', c: '3' },
      { a: '4', b: '5', c: '6' },
    ]);
  });

  it('handles quoted fields with embedded commas', () => {
    const rows = parseCsv('name,note\nfoo,"hello, world"\nbar,baz');
    assert.deepEqual(rows, [
      { name: 'foo', note: 'hello, world' },
      { name: 'bar', note: 'baz' },
    ]);
  });

  it('skips fully blank rows', () => {
    const rows = parseCsv('a,b\n1,2\n\n3,4\n');
    assert.equal(rows.length, 2);
  });
});

describe('syncNormalizedRecipes — apply mode', () => {
  it('upserts entities_recipes + writes bom_lines for one recipe', () => {
    const indexRows = [indexRow()];
    const csvByRecipeId = new Map([
      [
        'gazpacho',
        [
          ingRow({ ingredient: 'roma tomatoes', qty: '6', unit: 'lb' }),
          ingRow({ ingredient: 'cucumber', qty: '2', unit: 'lb' }),
        ],
      ],
    ]);

    const summary = call({ indexRows, csvByRecipeId });

    assert.equal(summary.recipes_in_index, 1);
    assert.equal(summary.recipes_with_csv, 1);
    assert.equal(summary.recipes_upserted, 1);
    assert.equal(summary.bom_lines_written, 2);

    const er = db.prepare("SELECT slug, display_name, yield_qty, yield_unit, category FROM entities_recipes WHERE slug='gazpacho'").get();
    assert.deepEqual(er, {
      slug: 'gazpacho',
      display_name: 'Gazpacho',
      yield_qty: 4,
      yield_unit: 'qt',
      category: 'soup',
    });

    const bl = db.prepare("SELECT ingredient, qty, unit, sub_recipe FROM bom_lines WHERE recipe_id='gazpacho' ORDER BY id").all();
    assert.deepEqual(bl, [
      { ingredient: 'roma tomatoes', qty: 6, unit: 'lb', sub_recipe: null },
      { ingredient: 'cucumber', qty: 2, unit: 'lb', sub_recipe: null },
    ]);
  });

  it('records an ingest_runs row with status=ok and rows_out=bom_lines_written', () => {
    const indexRows = [indexRow()];
    const csvByRecipeId = new Map([
      ['gazpacho', [ingRow({ ingredient: 'tomato', qty: '6', unit: 'lb' })]],
    ]);
    const summary = call({ indexRows, csvByRecipeId });

    const run = db.prepare(`
      SELECT kind, status, rows_in, rows_out FROM ingest_runs
       WHERE kind = 'sync_normalized_csv' ORDER BY id DESC LIMIT 1
    `).get();
    assert.deepEqual(run, {
      kind: 'sync_normalized_csv',
      status: 'ok',
      rows_in: 1,
      rows_out: summary.bom_lines_written,
    });
  });

  it('detects sub-recipes via "sub-recipe" notes + slug match', () => {
    const indexRows = [
      indexRow({ recipe_id: 'mexican_dinner', recipe_name: 'Mexican Dinner', category: 'dinner', yield: '1', yield_unit: 'menu' }),
      indexRow({ recipe_id: 'spanish_rice', recipe_name: 'Spanish Rice', category: 'side', yield: '3', yield_unit: 'qt' }),
      indexRow({ recipe_id: 'birria', recipe_name: 'Birria', category: 'entree', yield: '16', yield_unit: 'qt' }),
    ];
    const csvByRecipeId = new Map([
      [
        'mexican_dinner',
        [
          ingRow({ ingredient: 'birria', qty: '1', unit: 'portion', notes: 'sub-recipe — main entree' }),
          ingRow({ ingredient: 'spanish rice', qty: '1', unit: 'batch', notes: 'sub-recipe (3 qt batch)' }),
          ingRow({ ingredient: 'flour tortillas', qty: '50', unit: 'ea', notes: '8-in; warmed' }),
        ],
      ],
      ['spanish_rice', [ingRow({ ingredient: 'rice', qty: '1.5', unit: 'lb' })]],
      ['birria', [ingRow({ ingredient: 'beef cheek', qty: '15', unit: 'lb' })]],
    ]);

    const summary = call({ indexRows, csvByRecipeId });
    assert.equal(summary.sub_recipe_links, 2);

    const md = db.prepare("SELECT ingredient, sub_recipe FROM bom_lines WHERE recipe_id='mexican_dinner' ORDER BY id").all();
    assert.deepEqual(md, [
      { ingredient: 'birria', sub_recipe: 'birria' },
      { ingredient: 'spanish rice', sub_recipe: 'spanish_rice' },
      { ingredient: 'flour tortillas', sub_recipe: null },
    ]);
  });

  it('does not flag a sub-recipe when slug is unknown', () => {
    const indexRows = [
      indexRow({ recipe_id: 'mexican_dinner', recipe_name: 'Mexican Dinner', yield: '1', yield_unit: 'menu' }),
    ];
    const csvByRecipeId = new Map([
      [
        'mexican_dinner',
        [ingRow({ ingredient: 'mystery side', qty: '1', unit: 'batch', notes: 'sub-recipe' })],
      ],
    ]);
    const summary = call({ indexRows, csvByRecipeId });
    assert.equal(summary.sub_recipe_links, 0);
    const row = db.prepare("SELECT sub_recipe FROM bom_lines WHERE recipe_id='mexican_dinner'").get();
    assert.equal(row.sub_recipe, null);
  });

  it('is idempotent — re-running with same input produces same row counts', () => {
    const indexRows = [indexRow()];
    const csvByRecipeId = new Map([
      ['gazpacho', [
        ingRow({ ingredient: 'tomato', qty: '6', unit: 'lb' }),
        ingRow({ ingredient: 'cucumber', qty: '2', unit: 'lb' }),
      ]],
    ]);

    call({ indexRows, csvByRecipeId });
    const after1 = db.prepare("SELECT COUNT(*) AS c FROM bom_lines WHERE recipe_id='gazpacho'").get().c;
    assert.equal(after1, 2);

    call({ indexRows, csvByRecipeId });
    const after2 = db.prepare("SELECT COUNT(*) AS c FROM bom_lines WHERE recipe_id='gazpacho'").get().c;
    assert.equal(after2, 2, 'second sync should leave row count unchanged');

    // entities_recipes should also be deduped to one row by slug.
    const erCount = db.prepare("SELECT COUNT(*) AS c FROM entities_recipes WHERE slug='gazpacho'").get().c;
    assert.equal(erCount, 1);
  });

  it('refreshes existing recipe metadata when recipe_index.csv changes', () => {
    const csvByRecipeId = new Map([
      ['gazpacho', [ingRow({ ingredient: 'tomato', qty: '6', unit: 'lb' })]],
    ]);

    call({
      indexRows: [indexRow()],
      csvByRecipeId,
    });
    call({
      indexRows: [
        indexRow({
          recipe_name: 'Late Summer Gazpacho',
          category: 'chilled soup',
          yield: '6',
          yield_unit: 'quart',
        }),
      ],
      csvByRecipeId,
    });

    const er = db.prepare(`
      SELECT display_name, yield_qty, yield_unit, category
        FROM entities_recipes
       WHERE slug='gazpacho'
    `).get();
    assert.deepEqual(er, {
      display_name: 'Late Summer Gazpacho',
      yield_qty: 6,
      yield_unit: 'quart',
      category: 'chilled soup',
    });
  });

  it('refreshes bom_lines on edit — row count updates, no orphans', () => {
    const indexRows = [indexRow()];
    const v1 = new Map([['gazpacho', [
      ingRow({ ingredient: 'tomato', qty: '6', unit: 'lb' }),
      ingRow({ ingredient: 'cucumber', qty: '2', unit: 'lb' }),
      ingRow({ ingredient: 'bell pepper', qty: '1.5', unit: 'lb' }),
    ]]]);
    call({ indexRows, csvByRecipeId: v1 });
    assert.equal(db.prepare("SELECT COUNT(*) AS c FROM bom_lines WHERE recipe_id='gazpacho'").get().c, 3);

    const v2 = new Map([['gazpacho', [
      ingRow({ ingredient: 'tomato', qty: '6', unit: 'lb' }),
    ]]]);
    call({ indexRows, csvByRecipeId: v2 });
    assert.equal(db.prepare("SELECT COUNT(*) AS c FROM bom_lines WHERE recipe_id='gazpacho'").get().c, 1);
  });

  it('skips recipes from the index that have no CSV', () => {
    const indexRows = [
      indexRow(),
      indexRow({ recipe_id: 'phantom_recipe', recipe_name: 'Phantom' }),
    ];
    const csvByRecipeId = new Map([['gazpacho', [ingRow({ ingredient: 'tomato', qty: '6', unit: 'lb' })]]]);
    const summary = call({ indexRows, csvByRecipeId });
    assert.equal(summary.recipes_with_csv, 1);
    assert.equal(summary.recipes_skipped_no_csv, 1);
    const phantom = db.prepare("SELECT COUNT(*) AS c FROM entities_recipes WHERE slug='phantom_recipe'").get().c;
    assert.equal(phantom, 0, 'phantom recipe should not have an entities_recipes row');
  });

  it('respects location_id scoping', () => {
    const indexRows = [indexRow()];
    const csvByRecipeId = new Map([
      ['gazpacho', [ingRow({ ingredient: 'tomato', qty: '6', unit: 'lb' })]],
    ]);
    call({ indexRows, csvByRecipeId, locationId: 'satellite' });
    call({ indexRows, csvByRecipeId, locationId: 'default' });

    const def = db.prepare("SELECT COUNT(*) AS c FROM bom_lines WHERE recipe_id='gazpacho' AND location_id='default'").get().c;
    const sat = db.prepare("SELECT COUNT(*) AS c FROM bom_lines WHERE recipe_id='gazpacho' AND location_id='satellite'").get().c;
    assert.equal(def, 1);
    assert.equal(sat, 1);
  });
});

describe('syncNormalizedRecipes — dry-run mode', () => {
  it('returns counts but writes nothing', () => {
    const indexRows = [indexRow()];
    const csvByRecipeId = new Map([
      ['gazpacho', [
        ingRow({ ingredient: 'tomato', qty: '6', unit: 'lb' }),
        ingRow({ ingredient: 'cucumber', qty: '2', unit: 'lb' }),
      ]],
    ]);

    const summary = call({ indexRows, csvByRecipeId, dryRun: true });
    assert.equal(summary.bom_lines_written, 2);
    assert.equal(summary.recipes_with_csv, 1);

    assert.equal(db.prepare("SELECT COUNT(*) AS c FROM bom_lines WHERE recipe_id='gazpacho'").get().c, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS c FROM entities_recipes WHERE slug='gazpacho'").get().c, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS c FROM ingest_runs WHERE kind='sync_normalized_csv'").get().c, 0);
  });
});

describe('syncNormalizedRecipes — vendor-column enrichment', () => {
  it('attaches vendor cols when a single vendor_prices row matches; marks UNMAPPED otherwise', () => {
    // Two vendor matches available: "roma tomatoes" → tomato sku; "cucumber"
    // → english cucumber sku. "bell pepper" intentionally absent.
    seedVendorPrice({
      ingredient: 'Roma Tomatoes', vendor: 'sysco',
      pack_price: 24.5, pack_size: 25, pack_unit: 'lb',
      yield_pct: 0.95, master_id: 'mst_tomato',
    });
    seedVendorPrice({
      ingredient: 'Cucumber English', vendor: 'shamrock',
      pack_price: 18.0, pack_size: 12, pack_unit: 'ea',
      yield_pct: 0.88, master_id: null,
    });

    const indexRows = [indexRow()];
    const csvByRecipeId = new Map([
      ['gazpacho', [
        ingRow({ ingredient: 'roma tomatoes', qty: '6', unit: 'lb' }),
        ingRow({ ingredient: 'cucumber english', qty: '2', unit: 'lb' }),
        ingRow({ ingredient: 'bell pepper', qty: '1.5', unit: 'lb' }),
      ]],
    ]);

    const summary = call({ indexRows, csvByRecipeId });

    assert.equal(summary.bom_lines_written, 3);
    assert.equal(summary.vendor_columns_populated, 2);
    assert.equal(summary.vendor_columns_unmapped, 1);

    const rows = db.prepare(`
      SELECT ingredient, vendor, pack_price, pack_size, vendor_ingredient,
             map_status, yield_pct, master_id
        FROM bom_lines WHERE recipe_id='gazpacho' ORDER BY id
    `).all();

    assert.deepEqual(rows[0], {
      ingredient: 'roma tomatoes', vendor: 'sysco',
      pack_price: 24.5, pack_size: 25, vendor_ingredient: 'Roma Tomatoes',
      map_status: 'mapped', yield_pct: 0.95, master_id: 'mst_tomato',
    });
    assert.deepEqual(rows[1], {
      ingredient: 'cucumber english', vendor: 'shamrock',
      pack_price: 18.0, pack_size: 12, vendor_ingredient: 'Cucumber English',
      map_status: 'mapped', yield_pct: 0.88, master_id: null,
    });
    assert.deepEqual(rows[2], {
      ingredient: 'bell pepper', vendor: null,
      pack_price: null, pack_size: null, vendor_ingredient: null,
      map_status: 'UNMAPPED', yield_pct: null, master_id: null,
    });
  });

  it('uses ingredient_maps as a bridge when recipe-side name does not match vendor_prices directly', () => {
    // Workbook-confirmed bridge: "kosher salt" → "SALT, SEA WHT GRANULE 3LB KOSHER".
    seedIngredientMap('kosher salt', 'SALT, SEA WHT GRANULE 3LB KOSHER');
    seedVendorPrice({
      ingredient: 'SALT, SEA WHT GRANULE 3LB KOSHER', vendor: 'shamrock',
      pack_price: 33.01, pack_size: 36, yield_pct: 1.0, master_id: 'mst_salt',
    });

    const indexRows = [indexRow()];
    const csvByRecipeId = new Map([
      ['gazpacho', [ingRow({ ingredient: 'kosher salt', qty: '2', unit: 'tbsp' })]],
    ]);
    const summary = call({ indexRows, csvByRecipeId });

    assert.equal(summary.vendor_columns_populated, 1);
    assert.equal(summary.vendor_columns_unmapped, 0);
    const row = db.prepare(`
      SELECT vendor, pack_price, pack_size, vendor_ingredient, map_status, master_id
        FROM bom_lines WHERE recipe_id='gazpacho'
    `).get();
    assert.deepEqual(row, {
      vendor: 'shamrock', pack_price: 33.01, pack_size: 36,
      vendor_ingredient: 'SALT, SEA WHT GRANULE 3LB KOSHER',
      map_status: 'mapped', master_id: 'mst_salt',
    });
  });

  it('leaves vendor cols NULL when ingredient resolves to multiple distinct vendors', () => {
    // Same key → two vendors. Ambiguous from name alone; must not silently
    // pick one or it'd bias variance math.
    seedVendorPrice({ ingredient: 'tomato', vendor: 'sysco', pack_price: 24.5, pack_size: 25 });
    seedVendorPrice({ ingredient: 'tomato', vendor: 'shamrock', pack_price: 22.0, pack_size: 25 });

    const indexRows = [indexRow()];
    const csvByRecipeId = new Map([
      ['gazpacho', [ingRow({ ingredient: 'tomato', qty: '6', unit: 'lb' })]],
    ]);
    const summary = call({ indexRows, csvByRecipeId });

    assert.equal(summary.vendor_columns_populated, 0);
    assert.equal(summary.vendor_columns_unmapped, 1);
    const row = db.prepare(`SELECT vendor, map_status FROM bom_lines WHERE recipe_id='gazpacho'`).get();
    assert.deepEqual(row, { vendor: null, map_status: 'UNMAPPED' });
  });

  it('treats sub-recipe rows as neither populated nor unmapped (excluded from vendor counters)', () => {
    const indexRows = [
      indexRow({ recipe_id: 'mexican_dinner', recipe_name: 'Mexican Dinner', yield: '1', yield_unit: 'menu' }),
      indexRow({ recipe_id: 'birria', recipe_name: 'Birria', yield: '16', yield_unit: 'qt' }),
    ];
    const csvByRecipeId = new Map([
      ['mexican_dinner', [
        ingRow({ ingredient: 'birria', qty: '1', unit: 'portion', notes: 'sub-recipe' }),
        ingRow({ ingredient: 'unknown ingredient', qty: '1', unit: 'lb' }),
      ]],
      ['birria', [ingRow({ ingredient: 'beef cheek', qty: '15', unit: 'lb' })]],
    ]);
    const summary = call({ indexRows, csvByRecipeId });

    // mexican_dinner: 1 sub-recipe + 1 unmapped real ingredient = 1 unmapped only.
    // birria: 1 unmapped (no vendor_prices seeded).
    assert.equal(summary.vendor_columns_unmapped, 2);
    assert.equal(summary.vendor_columns_populated, 0);
    assert.equal(summary.sub_recipe_links, 1);

    const sub = db.prepare(`
      SELECT sub_recipe, map_status FROM bom_lines
       WHERE recipe_id='mexican_dinner' AND ingredient='birria'
    `).get();
    assert.equal(sub.sub_recipe, 'birria');
    assert.equal(sub.map_status, null);
  });
});

describe('syncNormalizedRecipes — scaffold skip set', () => {
  it('skips scaffold slugs entirely — no entities_recipes, no bom_lines, no error', () => {
    const indexRows = [
      indexRow({ recipe_id: 'prime_rib', recipe_name: 'Prime Rib' }),
      indexRow({ recipe_id: 'chocolate_cake', recipe_name: 'Chocolate Cake' }),
      indexRow({ recipe_id: 'churros', recipe_name: 'Churros' }),
      indexRow({ recipe_id: 'cupcakes', recipe_name: 'Cupcakes' }),
      indexRow({ recipe_id: 'mini_rellenos', recipe_name: 'Mini Rellenos' }),
      indexRow({ recipe_id: 'philo_bites', recipe_name: 'Philo Bites' }),
      indexRow({ recipe_id: 'tiramisu', recipe_name: 'Tiramisu' }),
      indexRow({ recipe_id: 'gazpacho', recipe_name: 'Gazpacho' }), // real one
    ];
    const csvByRecipeId = new Map([
      ['prime_rib', [ingRow({ ingredient: 'prime rib', qty: '1', unit: 'ea' })]],
      ['chocolate_cake', [ingRow({ ingredient: 'chocolate cake', qty: '1', unit: 'ea' })]],
      ['churros', [ingRow({ ingredient: 'churros', qty: '1', unit: 'case' })]],
      ['cupcakes', [ingRow({ ingredient: 'cupcakes', qty: '1', unit: 'case' })]],
      ['mini_rellenos', [ingRow({ ingredient: 'mini rellenos', qty: '1', unit: 'case' })]],
      ['philo_bites', [ingRow({ ingredient: 'philo bites', qty: '1', unit: 'case' })]],
      ['tiramisu', [ingRow({ ingredient: 'tiramisu', qty: '1', unit: 'ea' })]],
      ['gazpacho', [ingRow({ ingredient: 'tomato', qty: '6', unit: 'lb' })]],
    ]);

    const summary = call({ indexRows, csvByRecipeId });
    assert.equal(summary.recipes_skipped_scaffold, 7);
    assert.equal(summary.recipes_upserted, 1);
    assert.equal(summary.bom_lines_written, 1);

    for (const slug of SCAFFOLD_SKIP_SLUGS) {
      const er = db.prepare("SELECT COUNT(*) AS c FROM entities_recipes WHERE slug=?").get(slug).c;
      const bl = db.prepare("SELECT COUNT(*) AS c FROM bom_lines WHERE recipe_id=?").get(slug).c;
      assert.equal(er, 0, `${slug} should not appear in entities_recipes`);
      assert.equal(bl, 0, `${slug} should not appear in bom_lines`);
    }

    assert.equal(
      db.prepare("SELECT COUNT(*) AS c FROM entities_recipes WHERE slug='gazpacho'").get().c,
      1,
      'non-scaffold recipe should still sync normally',
    );
  });
});

describe('syncNormalizedRecipes — idempotency with vendor enrichment', () => {
  it('two runs produce identical bom_lines state (counts + vendor cols)', () => {
    seedVendorPrice({
      ingredient: 'tomato', vendor: 'sysco',
      pack_price: 24.5, pack_size: 25, yield_pct: 0.95, master_id: 'mst_tomato',
    });

    const indexRows = [indexRow()];
    const csvByRecipeId = new Map([
      ['gazpacho', [
        ingRow({ ingredient: 'tomato', qty: '6', unit: 'lb' }),
        ingRow({ ingredient: 'mystery', qty: '1', unit: 'lb' }),
      ]],
    ]);

    const s1 = call({ indexRows, csvByRecipeId });
    const snapshot1 = db.prepare(`
      SELECT ingredient, qty, unit, vendor, pack_price, pack_size,
             vendor_ingredient, map_status, yield_pct, master_id
        FROM bom_lines WHERE recipe_id='gazpacho' ORDER BY ingredient
    `).all();

    const s2 = call({ indexRows, csvByRecipeId });
    const snapshot2 = db.prepare(`
      SELECT ingredient, qty, unit, vendor, pack_price, pack_size,
             vendor_ingredient, map_status, yield_pct, master_id
        FROM bom_lines WHERE recipe_id='gazpacho' ORDER BY ingredient
    `).all();

    assert.deepEqual(snapshot1, snapshot2);
    assert.equal(s1.bom_lines_written, s2.bom_lines_written);
    assert.equal(s1.vendor_columns_populated, s2.vendor_columns_populated);
    assert.equal(s1.vendor_columns_unmapped, s2.vendor_columns_unmapped);
    assert.equal(snapshot1.length, 2);
  });
});
