#!/usr/bin/env node
// Tests for price-shock impact joins used by /costing/price-shocks.
//
// Run: node --experimental-strip-types --test tests/js/test-price-shock-impact.mjs

import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

register(new URL('./resolver.mjs', import.meta.url));

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-price-shock-impact-'));
const TMP_DB = path.join(TMP_DIR, 'lariat-test.db');

const dbMod = await import('../../lib/db.ts');
const { affectedRecipes } = await import('../../lib/priceShockImpact.js');

dbMod.setDbPathForTest(TMP_DB);
const db = dbMod.getDb();

after(() => {
  dbMod.setDbPathForTest(null);
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

beforeEach(() => {
  db.exec('DELETE FROM bom_lines;');
});

describe('affectedRecipes', () => {
  it('scopes fallback recipe impact to the selected location', () => {
    db.prepare(
      `INSERT INTO bom_lines
         (recipe_id, ingredient, vendor_ingredient, qty, unit, location_id)
       VALUES (?, 'avocado prep', 'Avocado', 1, 'lb', ?)`,
    ).run('guac_a', 'kitchen-a');
    db.prepare(
      `INSERT INTO bom_lines
         (recipe_id, ingredient, vendor_ingredient, qty, unit, location_id)
       VALUES (?, 'avocado prep', 'Avocado', 1, 'lb', ?)`,
    ).run('guac_b', 'kitchen-b');

    const recipes = affectedRecipes(db, 'kitchen-a', ['Avocado']);

    assert.deepStrictEqual(recipes.get('Avocado'), ['guac_a']);
  });
});
