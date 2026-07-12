import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { initSchema } from '../../lib/db.ts';
import { enrichUnmappedBomLines } from '../../scripts/enrich-bom-vendor-columns.mjs';

function makeDb() {
  const db = new Database(':memory:');
  initSchema(db);
  return db;
}

function seedVendorPrice(db, row) {
  db.prepare(`
    INSERT INTO vendor_prices (ingredient, vendor, pack_price, pack_size, pack_unit, location_id, imported_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(row.ingredient, row.vendor, row.pack_price, row.pack_size, row.pack_unit ?? 'lb', 'default');
}

describe('enrichUnmappedBomLines', () => {
  let db;

  beforeEach(() => {
    db = makeDb();
    db.prepare(`
      INSERT INTO bom_lines (recipe_id, ingredient, qty, unit, map_status, location_id)
      VALUES ('peach_cobbler', 'kosher salt', 1, 'tsp', 'UNMAPPED', 'default')
    `).run();
    db.prepare(`
      INSERT INTO ingredient_maps (recipe_ingredient, vendor_ingredient, status, location_id)
      VALUES ('kosher salt', 'SALT, SEA WHT GRANULE 3LB KOSHER', 'confirmed', 'default')
    `).run();
    seedVendorPrice(db, {
      ingredient: 'SALT, SEA WHT GRANULE 3LB KOSHER',
      vendor: 'shamrock',
      pack_price: 33.01,
      pack_size: 36,
    });
  });

  it('enriches legacy UNMAPPED rows without a CSV sync', () => {
    const summary = enrichUnmappedBomLines(db, { locationId: 'default' });
    assert.equal(summary.enriched, 1);
    assert.equal(summary.still_unmapped, 0);

    const row = db.prepare('SELECT map_status, vendor, pack_price FROM bom_lines WHERE recipe_id=?')
      .get('peach_cobbler');
    assert.equal(row.map_status, 'mapped');
    assert.equal(row.vendor, 'shamrock');
    assert.equal(row.pack_price, 33.01);
  });

  it('dry run does not mutate rows', () => {
    enrichUnmappedBomLines(db, { dryRun: true });
    const row = db.prepare('SELECT vendor FROM bom_lines WHERE recipe_id=?').get('peach_cobbler');
    assert.equal(row.vendor, null);
  });

  it('classifies legacy water rows as no-cost utility', () => {
    db.prepare(`
      INSERT INTO bom_lines (recipe_id, ingredient, qty, unit, map_status, location_id)
      VALUES ('green_chilli', 'water', 5, 'cup', 'UNMAPPED', 'default')
    `).run();

    const summary = enrichUnmappedBomLines(db, { locationId: 'default' });
    assert.equal(summary.no_cost_utility, 1);

    const row = db.prepare('SELECT map_status, vendor FROM bom_lines WHERE recipe_id=?').get('green_chilli');
    assert.deepEqual(row, { map_status: 'no_cost_utility', vendor: null });
  });
});
