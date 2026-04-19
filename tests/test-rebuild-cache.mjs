#!/usr/bin/env node
// Tests for the enriched cache rebuild script.
// Run: node --test tests/test-rebuild-cache.mjs
// Expects: npm run rebuild-cache has already been executed.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(__dirname, '..', 'data', 'cache');

function readJSON(name) {
  const p = path.join(CACHE, name);
  assert.ok(fs.existsSync(p), `${name} must exist in data/cache/`);
  return JSON.parse(fs.readFileSync(p, 'utf-8'));
}

// ---------------------------------------------------------------------------
// recipes.json
// ---------------------------------------------------------------------------
describe('recipes.json', () => {
  it('has at least 42 recipes', () => {
    const recipes = readJSON('recipes.json');
    assert.ok(
      recipes.length >= 42,
      `Expected >= 42 recipes, got ${recipes.length}`
    );
  });

  it('every recipe has required fields', () => {
    const recipes = readJSON('recipes.json');
    const required = ['slug', 'name', 'ingredients', 'allergens', 'procedure'];
    for (const r of recipes) {
      for (const key of required) {
        assert.ok(
          key in r,
          `Recipe "${r.name || r.slug || '?'}" missing field "${key}"`
        );
      }
      assert.ok(Array.isArray(r.ingredients), `ingredients must be array for ${r.slug}`);
      assert.ok(Array.isArray(r.allergens), `allergens must be array for ${r.slug}`);
      assert.ok(Array.isArray(r.procedure), `procedure must be array for ${r.slug}`);
    }
  });

  it('queso has milk allergen', () => {
    const recipes = readJSON('recipes.json');
    const queso = recipes.find(
      (r) => r.slug === 'queso-mac-sauce' || /queso/i.test(r.name)
    );
    assert.ok(queso, 'queso recipe must exist');
    assert.ok(
      queso.allergens.some((a) => /milk|dairy/i.test(a)),
      `queso allergens should include milk/dairy, got: ${JSON.stringify(queso.allergens)}`
    );
  });

  it('beer_batter has wheat allergen', () => {
    const recipes = readJSON('recipes.json');
    const bb = recipes.find(
      (r) => r.slug === 'beer-batter' || (r.name === 'Beer Batter')
    );
    assert.ok(bb, 'beer batter recipe must exist');
    assert.ok(
      bb.allergens.some((a) => /wheat|gluten/i.test(a)),
      `beer batter allergens should include wheat/gluten, got: ${JSON.stringify(bb.allergens)}`
    );
  });

  it('pork_chop_marinade has soybeans allergen', () => {
    const recipes = readJSON('recipes.json');
    const pcm = recipes.find(
      (r) => r.slug === 'pork-chop-marinade' || /pork.chop.marinade/i.test(r.name)
    );
    assert.ok(pcm, 'pork chop marinade recipe must exist');
    assert.ok(
      pcm.allergens.some((a) => /soy/i.test(a)),
      `pork chop marinade allergens should include soy/soybeans, got: ${JSON.stringify(pcm.allergens)}`
    );
  });

  it('preserves procedure arrays from existing cache', () => {
    const recipes = readJSON('recipes.json');
    // Queso should have multi-step procedure
    const queso = recipes.find(
      (r) => r.slug === 'queso-mac-sauce' || /queso/i.test(r.name)
    );
    assert.ok(queso, 'queso recipe must exist');
    assert.ok(
      queso.procedure.length >= 2,
      `queso should have multi-step procedure, got ${queso.procedure.length}`
    );
  });
});

// ---------------------------------------------------------------------------
// allergen_matrix.json
// ---------------------------------------------------------------------------
describe('allergen_matrix.json', () => {
  it('exists and has keyed entries', () => {
    const matrix = readJSON('allergen_matrix.json');
    const keys = Object.keys(matrix);
    assert.ok(keys.length > 0, 'allergen_matrix must have entries');
  });

  it('each entry is an array of {ingredient, big9, notes}', () => {
    const matrix = readJSON('allergen_matrix.json');
    for (const [recipeId, entries] of Object.entries(matrix)) {
      assert.ok(Array.isArray(entries), `${recipeId} value must be array`);
      for (const entry of entries) {
        assert.ok('ingredient' in entry, `entry in ${recipeId} missing ingredient`);
        assert.ok('big9' in entry, `entry in ${recipeId} missing big9`);
        assert.ok(Array.isArray(entry.big9), `big9 must be array in ${recipeId}`);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// menu.json
// ---------------------------------------------------------------------------
describe('menu.json', () => {
  it('has at least 20 menu items', () => {
    const menu = readJSON('menu.json');
    assert.ok(
      menu.length >= 20,
      `Expected >= 20 menu items, got ${menu.length}`
    );
  });

  it('every item has required fields', () => {
    const menu = readJSON('menu.json');
    const required = ['display_name', 'category'];
    for (const item of menu) {
      for (const key of required) {
        assert.ok(key in item, `Menu item missing "${key}": ${JSON.stringify(item)}`);
      }
    }
  });

  it('does NOT include price_usd', () => {
    const menu = readJSON('menu.json');
    for (const item of menu) {
      assert.ok(!('price_usd' in item), `Menu item should not have price_usd: ${item.display_name}`);
    }
  });
});

// ---------------------------------------------------------------------------
// food_safety.json
// ---------------------------------------------------------------------------
describe('food_safety.json', () => {
  it('has ccps array with 10 entries', () => {
    const fs_ = readJSON('food_safety.json');
    assert.ok(Array.isArray(fs_.ccps), 'food_safety must have ccps array');
    assert.strictEqual(fs_.ccps.length, 10, `Expected 10 CCPs, got ${fs_.ccps.length}`);
  });

  it('CCP-4 critical limit includes 165', () => {
    const fs_ = readJSON('food_safety.json');
    const ccp4 = fs_.ccps.find((c) => c.ccp_id === 'CCP-4');
    assert.ok(ccp4, 'CCP-4 must exist');
    assert.ok(
      String(ccp4.critical_limit).includes('165'),
      `CCP-4 critical_limit should mention 165, got: ${ccp4.critical_limit}`
    );
  });

  it('has temp_monitoring array', () => {
    const fs_ = readJSON('food_safety.json');
    assert.ok(Array.isArray(fs_.temp_monitoring), 'food_safety must have temp_monitoring array');
  });
});

// ---------------------------------------------------------------------------
// vendor_summary.json
// ---------------------------------------------------------------------------
describe('vendor_summary.json', () => {
  it('has sysco data', () => {
    const vs = readJSON('vendor_summary.json');
    assert.ok(vs.sysco, 'vendor_summary must have sysco key');
    assert.ok(
      Array.isArray(vs.sysco.catalog) || Array.isArray(vs.sysco.recent_items),
      'sysco must have catalog or recent_items array'
    );
  });

  it('sysco catalog has items', () => {
    const vs = readJSON('vendor_summary.json');
    const items = vs.sysco.catalog || [];
    assert.ok(items.length > 0, 'sysco catalog should not be empty');
  });
});

// ---------------------------------------------------------------------------
// labor_summary.json (optional — only if export files exist)
// ---------------------------------------------------------------------------
describe('labor_summary.json', () => {
  const laborPath = path.join(CACHE, 'labor_summary.json');
  const exists = fs.existsSync(laborPath);

  it('exists if labor export files are present', () => {
    // Labor exports exist in our repo, so this should be generated
    assert.ok(exists, 'labor_summary.json should exist');
  });

  if (exists) {
    it('has expected structure', () => {
      const labor = readJSON('labor_summary.json');
      assert.ok('net_sales' in labor, 'labor_summary must have net_sales');
      assert.ok('labor_cost' in labor, 'labor_summary must have labor_cost');
      assert.ok(Array.isArray(labor.by_role), 'labor_summary must have by_role array');
    });

    it('by_role has entries', () => {
      const labor = readJSON('labor_summary.json');
      assert.ok(labor.by_role.length > 0, 'by_role should not be empty');
    });
  }
});
