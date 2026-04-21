#!/usr/bin/env node
// T6 acceptance — pack-size substitution detection.
//
// Spec (docs/MAPPING_ENGINE_GAPS.md):
//   - Before the DELETE+INSERT sweep in vendor_prices, diff incoming
//     pack_size / pack_unit against the latest prior row per (vendor, sku).
//   - On mismatch: log a pack_size_changes row, flag the new vendor_prices
//     row map_status='PACK_CHANGED', surface in the attention queue until
//     acknowledged.
//   - Test fixture: two successive ingest runs for SKU SYSCO-12345 —
//     run 1 = 6×#10 @ $42, run 2 = 4×#10 @ $36. Expect one row in
//     pack_size_changes with acknowledged=0.
//   - Acceptance: zero false positives on same-pack price-only changes.
//
// Run: node --experimental-strip-types --test tests/js/test-pack-size-detect.mjs

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';

import { initSchema } from '../../lib/db.ts';
import { ingestCosting } from '../../scripts/ingest-costing.mjs';

const LOC = 'default';

function makeDb() {
  const db = new Database(':memory:');
  initSchema(db);
  return db;
}

function vpPayload(rows) {
  return {
    vendor_prices: rows,
    recipe_costs: [],
    bom_lines: [],
    ingredient_maps: [],
    order_guide: [],
  };
}

describe('T6 — spec fixture: 6×#10 → 4×#10 swap logs one row', () => {
  it('run 1 ingests cleanly, run 2 detects the pack swap', () => {
    const db = makeDb();

    // Run 1 — establish the baseline.
    const s1 = ingestCosting(db, vpPayload([
      { ingredient: 'Tomato Sauce', vendor: 'sysco', sku: 'SYSCO-12345',
        pack_size: 6, pack_unit: '#10', pack_price: 42.0, unit_price: 7.0 },
    ]), LOC);
    assert.strictEqual(s1.pack_size_changes, 0, 'first-ever ingest should not log a change');
    assert.strictEqual(
      db.prepare('SELECT COUNT(*) AS c FROM pack_size_changes').get().c,
      0,
      'pack_size_changes must be empty after baseline run',
    );
    const vpAfter1 = db.prepare(
      `SELECT map_status FROM vendor_prices WHERE vendor='sysco' AND sku='SYSCO-12345' AND location_id=?`,
    ).get(LOC);
    assert.strictEqual(vpAfter1.map_status, null,
      'baseline row should have NULL map_status — no prior pack to diff against');

    // Run 2 — same SKU but the pack_size drops from 6 to 4 and price drops.
    const s2 = ingestCosting(db, vpPayload([
      { ingredient: 'Tomato Sauce', vendor: 'sysco', sku: 'SYSCO-12345',
        pack_size: 4, pack_unit: '#10', pack_price: 36.0, unit_price: 9.0 },
    ]), LOC);

    assert.strictEqual(s2.pack_size_changes, 1,
      'summary.pack_size_changes must surface one detection');

    const rows = db.prepare(
      `SELECT vendor, sku, prev_pack, new_pack, prev_price, new_price, acknowledged
         FROM pack_size_changes
        WHERE vendor='sysco' AND sku='SYSCO-12345'
        ORDER BY id DESC`,
    ).all();
    assert.strictEqual(rows.length, 1, 'exactly one pack_size_changes row expected');
    const [row] = rows;
    assert.strictEqual(row.vendor, 'sysco');
    assert.strictEqual(row.sku, 'SYSCO-12345');
    assert.strictEqual(row.prev_pack, '6x#10');
    assert.strictEqual(row.new_pack, '4x#10');
    assert.strictEqual(row.prev_price, 42.0);
    assert.strictEqual(row.new_price, 36.0);
    assert.strictEqual(row.acknowledged, 0,
      'acknowledged defaults to 0 — operator has not yet reviewed the swap');

    // New vendor_prices row must carry the PACK_CHANGED flag.
    const vpAfter2 = db.prepare(
      `SELECT pack_size, pack_unit, map_status
         FROM vendor_prices WHERE vendor='sysco' AND sku='SYSCO-12345' AND location_id=?`,
    ).get(LOC);
    assert.strictEqual(vpAfter2.pack_size, 4);
    assert.strictEqual(vpAfter2.pack_unit, '#10');
    assert.strictEqual(vpAfter2.map_status, 'PACK_CHANGED');
    db.close();
  });
});

describe('T6 — same-pack price-only change is NOT a false positive', () => {
  it('identical pack_size + pack_unit across runs does not log', () => {
    const db = makeDb();

    ingestCosting(db, vpPayload([
      { ingredient: 'Tomato Sauce', vendor: 'sysco', sku: 'SYSCO-12345',
        pack_size: 6, pack_unit: '#10', pack_price: 42.0, unit_price: 7.0 },
    ]), LOC);

    // Run 2 — price changed, pack identical.
    const s2 = ingestCosting(db, vpPayload([
      { ingredient: 'Tomato Sauce', vendor: 'sysco', sku: 'SYSCO-12345',
        pack_size: 6, pack_unit: '#10', pack_price: 47.5, unit_price: 7.92 },
    ]), LOC);

    assert.strictEqual(s2.pack_size_changes, 0,
      'price-only delta must not trigger T6 detection');
    const count = db.prepare('SELECT COUNT(*) AS c FROM pack_size_changes').get().c;
    assert.strictEqual(count, 0, 'no pack_size_changes row expected on price-only move');

    const vp = db.prepare(
      `SELECT map_status FROM vendor_prices WHERE vendor='sysco' AND sku='SYSCO-12345' AND location_id=?`,
    ).get(LOC);
    assert.strictEqual(vp.map_status, null,
      'map_status must stay NULL on price-only changes');
    db.close();
  });
});

describe('T6 — first-ever ingest of a SKU does NOT log', () => {
  it('no prior row means nothing to diff against', () => {
    const db = makeDb();
    const s = ingestCosting(db, vpPayload([
      { ingredient: 'Fresh SKU', vendor: 'sysco', sku: 'BRAND-NEW',
        pack_size: 12, pack_unit: 'ea', pack_price: 24.0, unit_price: 2.0 },
      { ingredient: 'Another', vendor: 'shamrock', sku: 'SHAM-42',
        pack_size: 1, pack_unit: 'cs', pack_price: 100.0, unit_price: 100.0 },
    ]), LOC);
    assert.strictEqual(s.pack_size_changes, 0);
    const count = db.prepare('SELECT COUNT(*) AS c FROM pack_size_changes').get().c;
    assert.strictEqual(count, 0);

    // Both rows get NULL map_status on first ingest.
    const rows = db.prepare(
      `SELECT sku, map_status FROM vendor_prices WHERE location_id=? ORDER BY sku`,
    ).all(LOC);
    assert.deepStrictEqual(
      rows.map((r) => [r.sku, r.map_status]),
      [['BRAND-NEW', null], ['SHAM-42', null]],
    );
    db.close();
  });
});

describe('T6 — unit normalization prevents false positives from case/synonym drift', () => {
  it('"CS" ↔ "cs" and "pound" ↔ "lb" are not logged as changes', () => {
    const db = makeDb();

    ingestCosting(db, vpPayload([
      { ingredient: 'Ribeye', vendor: 'sysco', sku: 'RIB-1',
        pack_size: 10, pack_unit: 'LB', pack_price: 150.0, unit_price: 15.0 },
      { ingredient: 'Cheese', vendor: 'sysco', sku: 'CHZ-1',
        pack_size: 1, pack_unit: 'CS', pack_price: 60.0, unit_price: 60.0 },
    ]), LOC);

    // Run 2: same numeric size, unit tokens differ in case / spelling only.
    const s2 = ingestCosting(db, vpPayload([
      { ingredient: 'Ribeye', vendor: 'sysco', sku: 'RIB-1',
        pack_size: 10, pack_unit: 'lb', pack_price: 151.0, unit_price: 15.1 },
      { ingredient: 'Cheese', vendor: 'sysco', sku: 'CHZ-1',
        pack_size: 1, pack_unit: 'cs', pack_price: 61.0, unit_price: 61.0 },
    ]), LOC);

    assert.strictEqual(s2.pack_size_changes, 0,
      'normalized unit equivalence must not produce false positives');
    db.close();
  });
});

describe('T6 — multiple simultaneous substitutions surface independently', () => {
  it('two different SKUs both changing pack in the same run = 2 rows', () => {
    const db = makeDb();

    ingestCosting(db, vpPayload([
      { ingredient: 'A', vendor: 'sysco', sku: 'S1',
        pack_size: 6, pack_unit: '#10', pack_price: 42.0, unit_price: 7.0 },
      { ingredient: 'B', vendor: 'sysco', sku: 'S2',
        pack_size: 24, pack_unit: 'ea', pack_price: 50.0, unit_price: 2.08 },
      { ingredient: 'C', vendor: 'shamrock', sku: 'S3',
        pack_size: 10, pack_unit: 'lb', pack_price: 30.0, unit_price: 3.0 },
    ]), LOC);

    const s2 = ingestCosting(db, vpPayload([
      { ingredient: 'A', vendor: 'sysco', sku: 'S1',
        pack_size: 4, pack_unit: '#10', pack_price: 36.0, unit_price: 9.0 }, // changed
      { ingredient: 'B', vendor: 'sysco', sku: 'S2',
        pack_size: 24, pack_unit: 'ea', pack_price: 55.0, unit_price: 2.29 }, // price only
      { ingredient: 'C', vendor: 'shamrock', sku: 'S3',
        pack_size: 10, pack_unit: 'kg', pack_price: 33.0, unit_price: 3.3 }, // unit changed
    ]), LOC);

    assert.strictEqual(s2.pack_size_changes, 2,
      'two SKUs changed pack; one was price-only');
    const rows = db.prepare(
      `SELECT vendor, sku, prev_pack, new_pack FROM pack_size_changes ORDER BY sku`,
    ).all();
    assert.deepStrictEqual(rows, [
      { vendor: 'sysco',    sku: 'S1', prev_pack: '6x#10',  new_pack: '4x#10' },
      { vendor: 'shamrock', sku: 'S3', prev_pack: '10xlb',  new_pack: '10xkg' },
    ]);

    const flaggedCount = db.prepare(
      `SELECT COUNT(*) AS c FROM vendor_prices
        WHERE map_status='PACK_CHANGED' AND location_id=?`,
    ).get(LOC).c;
    assert.strictEqual(flaggedCount, 2);
    db.close();
  });
});

describe('T6 — blank / missing vendor or sku does not trigger detection', () => {
  it('empty vendor or sku on incoming row is skipped entirely', () => {
    const db = makeDb();

    // Baseline with a real row + a blank-sku row.
    ingestCosting(db, vpPayload([
      { ingredient: 'Real', vendor: 'sysco', sku: 'REAL',
        pack_size: 1, pack_unit: 'cs', pack_price: 10.0 },
      { ingredient: 'No Sku', vendor: 'sysco', sku: '',
        pack_size: 2, pack_unit: 'cs', pack_price: 20.0 },
    ]), LOC);

    // Run 2: blank-sku row changes pack — must NOT be logged (no key).
    const s2 = ingestCosting(db, vpPayload([
      { ingredient: 'Real', vendor: 'sysco', sku: 'REAL',
        pack_size: 1, pack_unit: 'cs', pack_price: 11.0 },
      { ingredient: 'No Sku', vendor: 'sysco', sku: '',
        pack_size: 5, pack_unit: 'cs', pack_price: 50.0 },
    ]), LOC);

    assert.strictEqual(s2.pack_size_changes, 0,
      'blank-sku rows cannot be reliably keyed, skip detection');
    db.close();
  });
});
