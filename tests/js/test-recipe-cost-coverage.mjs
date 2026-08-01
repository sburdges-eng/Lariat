/**
 * A partial cost must not read as a complete one.
 *
 * `rollupRecipeCosts` sums whatever BOM lines it can price and, if any line
 * contributed, writes `batch_cost` as though the recipe were fully costed. A
 * line it could not price is skipped silently — it is not even recorded in
 * `unconverted`, which only captures unit-conversion failures, not "no vendor
 * price at all".
 *
 * `recipe_costs` already carries `costed_lines` and `total_lines`, so the shape
 * for saying "this cost is built from 4 of 8 lines" exists. But only
 * `scripts/ingest-costing.mjs` ever writes them, from the Excel workbook at
 * import time. The rollup recomputes `batch_cost` from live vendor prices and
 * leaves the coverage figures frozen, so they drift into asserting complete
 * coverage on recipes that are demonstrably partial.
 *
 * Measured on the live DB: all 42 rows report costed_lines == total_lines,
 * while 26 of them have unpriced BOM lines. `birria` reports 8/8 and has 4
 * priced lines, 3 mapped-but-unpriced and 1 water. `lib/dbQueryRegistry.ts`
 * serves those figures to the Kitchen Assistant, so the false completeness is
 * not confined to a table nobody reads.
 *
 * What counts as costed, and why:
 *   - a line with a price                 -> costed
 *   - a sub-recipe line                   -> costed (its cost comes from the child)
 *   - a `no_cost_utility` line (water)    -> costed (deliberately free, not missing)
 *   - mapped but no vendor price          -> NOT costed
 *   - unmapped                            -> NOT costed
 *
 * Water counting as costed matters: it is a resolved decision, not a gap, and
 * counting it as missing would make every stock and brine look permanently
 * incomplete.
 */

import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

const { getDb, setDbPathForTest } = await import('../../lib/db.ts');
const { rollupRecipeCosts } = await import('../../lib/computeEngine/rollupRecipeCosts.ts');

setDbPathForTest(':memory:');
const db = getDb();
after(() => setDbPathForTest(null));

const LOC = 'default';

function seedRecipe(recipeId, lines, { costedLines = null, totalLines = null } = {}) {
  db.prepare(
    `INSERT INTO recipe_costs (recipe_id, recipe_name, yield, yield_unit, batch_cost,
                               costed_lines, total_lines, location_id)
     VALUES (?, ?, 1, 'batch', NULL, ?, ?, ?)`,
  ).run(recipeId, recipeId, costedLines, totalLines, LOC);

  const insert = db.prepare(
    `INSERT INTO bom_lines (recipe_id, ingredient, qty, unit, sub_recipe,
                            vendor_ingredient, map_status, vendor, pack_price,
                            pack_size, location_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  // The engine prices a leaf from `vendor_prices`, not from bom_lines.pack_price
  // — the latter is a denormalized copy. A fixture that seeds only bom_lines
  // produces a recipe where nothing can be priced, which is not what these
  // tests are about.
  const price = db.prepare(
    `INSERT INTO vendor_prices (ingredient, vendor, pack_size, pack_unit,
                                pack_price, location_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  for (const line of lines) {
    insert.run(
      recipeId, line.ingredient, line.qty ?? 1, line.unit ?? 'lb',
      line.sub_recipe ?? null, line.vendor_ingredient ?? null,
      line.map_status ?? null, line.vendor ?? null,
      line.pack_price ?? null, line.pack_size ?? 1, LOC,
    );
    if (line.pack_price != null) {
      price.run(line.ingredient, line.vendor ?? 'sysco', line.pack_size ?? 1,
                line.unit ?? 'lb', line.pack_price, LOC);
    }
  }
}

const coverageOf = (recipeId) =>
  db.prepare(
    'SELECT costed_lines, total_lines, batch_cost FROM recipe_costs WHERE recipe_id = ?',
  ).get(recipeId);

beforeEach(() => {
  db.exec('DELETE FROM recipe_costs; DELETE FROM bom_lines;');
});

describe('rollupRecipeCosts — coverage is recomputed, not inherited', () => {
  it('reports a partial recipe as partial', () => {
    seedRecipe('birria', [
      { ingredient: 'beef cheeks', map_status: 'mapped', vendor: 'sysco', pack_price: 40 },
      { ingredient: 'guajillo peppers', map_status: 'mapped', vendor: 'sysco', pack_price: 12 },
      // mapped to a catalog product that carries no price
      { ingredient: 'birria seasoning', map_status: 'mapped', vendor: 'sysco' },
      { ingredient: 'achiote', map_status: 'mapped', vendor: 'sysco' },
    ], { costedLines: 4, totalLines: 4 });

    rollupRecipeCosts(db, LOC, { repriceLeafOnly: true });
    const row = coverageOf('birria');
    assert.equal(row.total_lines, 4);
    assert.equal(row.costed_lines, 2, 'only two lines carry a price');
  });

  it('does not leave a stale 8/8 from the Excel import standing', () => {
    seedRecipe('stale', [
      { ingredient: 'priced', map_status: 'mapped', vendor: 'sysco', pack_price: 10 },
      { ingredient: 'unpriced', map_status: 'mapped', vendor: 'sysco' },
    ], { costedLines: 2, totalLines: 2 });

    rollupRecipeCosts(db, LOC, { repriceLeafOnly: true });
    assert.equal(coverageOf('stale').costed_lines, 1);
  });

  it('counts a fully priced recipe as complete', () => {
    seedRecipe('complete', [
      { ingredient: 'a', map_status: 'mapped', vendor: 'sysco', pack_price: 10 },
      { ingredient: 'b', map_status: 'mapped', vendor: 'sysco', pack_price: 20 },
    ]);
    rollupRecipeCosts(db, LOC, { repriceLeafOnly: true });
    const row = coverageOf('complete');
    assert.equal(row.costed_lines, row.total_lines);
    assert.equal(row.total_lines, 2);
  });

  it('counts water as costed, not missing', () => {
    // A no_cost_utility line is a resolved decision. Counting it as a gap would
    // make every stock and brine look permanently incomplete.
    seedRecipe('brine', [
      { ingredient: 'salt', map_status: 'mapped', vendor: 'sysco', pack_price: 5 },
      { ingredient: 'water', map_status: 'no_cost_utility' },
    ]);
    rollupRecipeCosts(db, LOC, { repriceLeafOnly: true });
    const row = coverageOf('brine');
    assert.equal(row.costed_lines, 2);
    assert.equal(row.total_lines, 2);
  });

  it('counts a sub-recipe line as costed', () => {
    seedRecipe('child', [
      { ingredient: 'flour', map_status: 'mapped', vendor: 'sysco', pack_price: 8 },
    ]);
    seedRecipe('parent', [
      // unit must match the child's yield_unit ('batch') or the conversion,
      // not the coverage logic, is what fails.
      { ingredient: 'child', sub_recipe: 'YES', unit: 'batch', qty: 1 },
      { ingredient: 'butter', map_status: 'mapped', vendor: 'sysco', pack_price: 6 },
    ]);
    rollupRecipeCosts(db, LOC, { repriceLeafOnly: true });
    const row = coverageOf('parent');
    assert.equal(row.costed_lines, 2, 'a sub-recipe carries its own cost');
  });

  it('an unmapped line is not costed', () => {
    seedRecipe('gappy', [
      { ingredient: 'priced', map_status: 'mapped', vendor: 'sysco', pack_price: 10 },
      { ingredient: 'arugula', map_status: 'UNMAPPED' },
    ]);
    rollupRecipeCosts(db, LOC, { repriceLeafOnly: true });
    assert.equal(coverageOf('gappy').costed_lines, 1);
  });
});
