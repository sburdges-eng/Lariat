#!/usr/bin/env node
// Repo-level tests for lib/ingredientMastersRepo.ts.
//
// Run: node --experimental-strip-types --test tests/js/test-ingredient-masters-repo.mjs

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register(new URL('./resolver.mjs', import.meta.url));

const { getDb, setDbPathForTest } = await import('../../lib/db.ts');
setDbPathForTest(':memory:');
const db = getDb();
after(() => setDbPathForTest(null));

const { listMasters, getMaster, updateMaster } = await import(
  '../../lib/ingredientMastersRepo.ts'
);

before(() => {
  // Seed ingest_runs (foreign keys downstream want a value).
  db.prepare(
    `INSERT INTO ingest_runs (id, kind, started_at, status) VALUES (1, 'test', datetime('now'), 'ok')`,
  ).run();
});

beforeEach(() => {
  db.exec(`DELETE FROM ingredient_masters; DELETE FROM vendor_prices; DELETE FROM bom_lines; DELETE FROM audit_events;`);
});

function seedMaster(id, canonical, opts = {}) {
  db.prepare(
    `INSERT INTO ingredient_masters
       (master_id, canonical_name, category, preferred_vendor, last_reviewed)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(
    id,
    canonical,
    opts.category ?? null,
    opts.preferred_vendor ?? null,
    opts.last_reviewed ?? null,
  );
}

function seedVendorPrice(masterId, vendor = 'sysco') {
  db.prepare(
    `INSERT INTO vendor_prices
       (ingredient, vendor, sku, pack_size, pack_unit, pack_price, unit_price, location_id, master_id)
     VALUES (?, ?, ?, 1, 'ea', 1.0, 1.0, 'default', ?)`,
  ).run('thing', vendor, `sku-${Math.random().toString(36).slice(2, 8)}`, masterId);
}

function seedBomLine(masterId) {
  db.prepare(
    `INSERT INTO bom_lines
       (recipe_id, ingredient, qty, unit, location_id, master_id)
     VALUES ('recipe-a', 'thing', 1.0, 'ea', 'default', ?)`,
  ).run(masterId);
}

describe('listMasters', () => {
  it('returns empty list when table empty', () => {
    assert.deepEqual(listMasters(db), []);
  });

  it('returns row with zero counts when nothing maps to it', () => {
    seedMaster('ketchup_heinz_1gal', 'Ketchup — Heinz 1gal');
    const rows = listMasters(db);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].master_id, 'ketchup_heinz_1gal');
    assert.equal(rows[0].vendor_price_count, 0);
    assert.equal(rows[0].bom_line_count, 0);
  });

  it('counts vendor_prices and bom_lines per master', () => {
    seedMaster('a', 'A');
    seedVendorPrice('a');
    seedVendorPrice('a');
    seedVendorPrice('a');
    seedBomLine('a');
    seedBomLine('a');
    const rows = listMasters(db);
    assert.equal(rows[0].vendor_price_count, 3);
    assert.equal(rows[0].bom_line_count, 2);
  });

  it('sorts needs-review masters first', () => {
    seedMaster('reviewed', 'B', { last_reviewed: '2099-01-01T00:00:00Z' });
    seedMaster('unreviewed', 'A');
    const ids = listMasters(db).map((r) => r.master_id);
    assert.deepEqual(ids, ['unreviewed', 'reviewed']);
  });

  it('within needs-review tier, sorts by vendor_price_count DESC', () => {
    seedMaster('low', 'L');
    seedMaster('high', 'H');
    seedVendorPrice('high');
    seedVendorPrice('high');
    seedVendorPrice('low');
    const ids = listMasters(db).map((r) => r.master_id);
    assert.deepEqual(ids, ['high', 'low']);
  });

  it('filter=needs_review excludes recently-reviewed rows', () => {
    seedMaster('reviewed', 'B', { last_reviewed: new Date().toISOString() });
    seedMaster('unreviewed', 'A');
    const ids = listMasters(db, { filter: 'needs_review' }).map((r) => r.master_id);
    assert.deepEqual(ids, ['unreviewed']);
  });

  it('filter=reviewed excludes unreviewed and stale rows', () => {
    seedMaster('fresh', 'F', { last_reviewed: new Date().toISOString() });
    seedMaster('stale', 'S', { last_reviewed: '2020-01-01T00:00:00Z' });
    seedMaster('null', 'N');
    const ids = listMasters(db, { filter: 'reviewed' }).map((r) => r.master_id);
    assert.deepEqual(ids, ['fresh']);
  });

  it('q matches master_id and canonical_name case-insensitively', () => {
    seedMaster('ketchup_heinz_1gal', 'Ketchup — Heinz 1gal');
    seedMaster('mayo_kraft_1gal', 'Mayonnaise — Kraft 1gal');
    assert.equal(listMasters(db, { q: 'ketch' }).length, 1);
    assert.equal(listMasters(db, { q: 'KETCH' }).length, 1);
    assert.equal(listMasters(db, { q: 'heinz' }).length, 1);
    assert.equal(listMasters(db, { q: 'xyz' }).length, 0);
  });

  it('limit clamps to [1, 1000]', () => {
    seedMaster('a', 'A');
    seedMaster('b', 'B');
    seedMaster('c', 'C');
    assert.equal(listMasters(db, { limit: 1 }).length, 1);
    assert.equal(listMasters(db, { limit: 0 }).length, 1, 'limit < 1 clamps to 1');
    assert.equal(listMasters(db, { limit: 999999 }).length, 3, 'limit > 1000 still returns all three');
  });
});

describe('getMaster', () => {
  it('returns null for unknown id', () => {
    assert.equal(getMaster(db, 'missing'), null);
  });

  it('returns the row with counts', () => {
    seedMaster('a', 'A', { category: 'sauce' });
    seedVendorPrice('a');
    const r = getMaster(db, 'a');
    assert.ok(r);
    assert.equal(r.canonical_name, 'A');
    assert.equal(r.category, 'sauce');
    assert.equal(r.vendor_price_count, 1);
    assert.equal(r.bom_line_count, 0);
  });
});

describe('updateMaster', () => {
  it('reports not-found and skips any writes for missing id', () => {
    const r = updateMaster(db, 'missing', { category: 'sauce' }, 'cook-x');
    assert.equal(r.found, false);
    assert.equal(r.changed, false);
    const auditCount = db.prepare(`SELECT COUNT(*) c FROM audit_events`).get().c;
    assert.equal(auditCount, 0);
  });

  it('empty updates returns changed=false with no audit row', () => {
    seedMaster('a', 'A');
    const r = updateMaster(db, 'a', {}, 'cook-x');
    assert.equal(r.found, true);
    assert.equal(r.changed, false);
    const auditCount = db.prepare(`SELECT COUNT(*) c FROM audit_events`).get().c;
    assert.equal(auditCount, 0);
  });

  it('writes only the named fields and posts one audit row', () => {
    seedMaster('a', 'A', { category: 'sauce', preferred_vendor: 'sysco' });
    const r = updateMaster(db, 'a', { category: 'condiment' }, 'cook-x');
    assert.equal(r.found, true);
    assert.equal(r.changed, true);
    assert.equal(r.after.category, 'condiment');
    assert.equal(r.after.preferred_vendor, 'sysco', 'unspecified fields preserved');
    const audit = db.prepare(`SELECT * FROM audit_events WHERE entity='ingredient_masters'`).get();
    assert.ok(audit);
    assert.equal(audit.action, 'correction');
    assert.equal(audit.actor_cook_id, 'cook-x');
    const payload = JSON.parse(audit.payload_json);
    assert.equal(payload.master_id, 'a');
    assert.deepEqual(payload.updates, { category: 'condiment' });
  });

  it("last_reviewed: 'now' stamps datetime('now')", () => {
    seedMaster('a', 'A');
    const before = new Date();
    updateMaster(db, 'a', { last_reviewed: 'now' }, 'cook-x');
    const after = getMaster(db, 'a');
    assert.ok(after.last_reviewed);
    const stamped = new Date(after.last_reviewed + 'Z');
    // Within 5 seconds — datetime('now') uses UTC.
    assert.ok(Math.abs(stamped.getTime() - before.getTime()) < 5000, `stamped within 5s: ${stamped.toISOString()} vs ${before.toISOString()}`);
  });

  it("last_reviewed: null clears the field", () => {
    seedMaster('a', 'A', { last_reviewed: '2024-01-01T00:00:00Z' });
    updateMaster(db, 'a', { last_reviewed: null }, 'cook-x');
    assert.equal(getMaster(db, 'a').last_reviewed, null);
  });

  it('multi-field update writes both + one audit row', () => {
    seedMaster('a', 'A');
    updateMaster(
      db,
      'a',
      { canonical_name: 'Better Name', category: 'sauce', preferred_vendor: 'shamrock' },
      'cook-x',
    );
    const after = getMaster(db, 'a');
    assert.equal(after.canonical_name, 'Better Name');
    assert.equal(after.category, 'sauce');
    assert.equal(after.preferred_vendor, 'shamrock');
    const auditCount = db.prepare(`SELECT COUNT(*) c FROM audit_events`).get().c;
    assert.equal(auditCount, 1, 'one audit row per call');
  });
});
