#!/usr/bin/env node
// Tests for scripts/sync-normalized-to-bom.mjs — pure-resolver path
// (CSV rows → entities_recipes + bom_lines) using an in-memory DB.
//
// Run: node --experimental-strip-types --test tests/js/test-sync-normalized-to-bom.mjs

import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const { getDb, setDbPathForTest } = await import('../../lib/db.ts');
const { resolveOrCreateRecipe } = await import('../../lib/entities.ts');
const { parseCsv, syncNormalizedRecipes } = await import(
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
    DELETE FROM ingest_runs WHERE kind = 'sync_normalized_csv';
  `);
});

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
