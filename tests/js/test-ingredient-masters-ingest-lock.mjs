#!/usr/bin/env node
import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register(new URL('./resolver.mjs', import.meta.url));

const { getDb, setDbPathForTest } = await import('../../lib/db.ts');
setDbPathForTest(':memory:');
const db = getDb();
after(() => setDbPathForTest(null));

describe('ingredient_masters operator curation survives upsert', () => {
  it('preserves preferred_vendor and quality_locked on conflict update', () => {
    db.prepare(
      `INSERT INTO ingredient_masters (master_id, canonical_name, preferred_vendor, quality_locked, quality_lock_reason)
       VALUES ('chicken_breast', 'Chicken Breast', 'shamrock', 1, 'quality')`,
    ).run();

    db.prepare(`
      INSERT INTO ingredient_masters (master_id, canonical_name, category, preferred_vendor, last_reviewed)
      VALUES ('chicken_breast', 'Chicken Breast', NULL, 'sysco', datetime('now'))
      ON CONFLICT(master_id) DO UPDATE SET
        canonical_name   = excluded.canonical_name,
        category         = COALESCE(excluded.category, ingredient_masters.category),
        last_reviewed    = excluded.last_reviewed
    `).run();

    const row = db.prepare(
      `SELECT preferred_vendor, quality_locked, quality_lock_reason FROM ingredient_masters WHERE master_id = 'chicken_breast'`,
    ).get();
    assert.equal(row.preferred_vendor, 'shamrock');
    assert.equal(row.quality_locked, 1);
    assert.equal(row.quality_lock_reason, 'quality');
  });
});
