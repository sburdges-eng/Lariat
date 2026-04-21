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

describe('T6 — quiet re-ingest after PACK_CHANGED: log persists, map_status resets to NULL', () => {
  // Documents the intentional run-scoped behavior of
  // vendor_prices.map_status — see the JSDoc on VendorPrice.map_status
  // and the block comment in scripts/ingest-costing.mjs.
  // Walkthrough:
  //   Run 1 — 6×#10 $42 baseline, no prior → no log, map_status NULL.
  //   Run 2 — 4×#10 $36, diff against 6×#10 → one log row, map_status='PACK_CHANGED'.
  //   Run 3 — 4×#10 $36, identical to run 2 → no diff, no new log. The
  //           DELETE+INSERT sweep wipes vendor_prices and re-inserts with
  //           map_status=NULL. The pack_size_changes row from run 2
  //           persists (never DELETEd) and its acknowledged flag is
  //           unchanged, so the durable attention queue stays correct.
  it('quiet re-ingest preserves pack_size_changes and resets map_status', () => {
    const db = makeDb();

    ingestCosting(db, vpPayload([
      { ingredient: 'Tomato Sauce', vendor: 'sysco', sku: 'SYSCO-12345',
        pack_size: 6, pack_unit: '#10', pack_price: 42.0, unit_price: 7.0 },
    ]), LOC);
    ingestCosting(db, vpPayload([
      { ingredient: 'Tomato Sauce', vendor: 'sysco', sku: 'SYSCO-12345',
        pack_size: 4, pack_unit: '#10', pack_price: 36.0, unit_price: 9.0 },
    ]), LOC);
    // After run 2: one log row, PACK_CHANGED on vendor_prices.
    const vp2 = db.prepare(
      `SELECT map_status FROM vendor_prices WHERE vendor='sysco' AND sku='SYSCO-12345' AND location_id=?`,
    ).get(LOC);
    assert.strictEqual(vp2.map_status, 'PACK_CHANGED');
    assert.strictEqual(
      db.prepare('SELECT COUNT(*) AS c FROM pack_size_changes').get().c, 1);

    // Run 3 — identical to run 2. No diff should fire.
    const s3 = ingestCosting(db, vpPayload([
      { ingredient: 'Tomato Sauce', vendor: 'sysco', sku: 'SYSCO-12345',
        pack_size: 4, pack_unit: '#10', pack_price: 36.0, unit_price: 9.0 },
    ]), LOC);
    assert.strictEqual(s3.pack_size_changes, 0,
      'identical re-ingest must not re-log a pack change');

    // pack_size_changes: still exactly 1 row, acknowledged still 0.
    const logRows = db.prepare(
      `SELECT acknowledged FROM pack_size_changes
        WHERE vendor='sysco' AND sku='SYSCO-12345'`,
    ).all();
    assert.strictEqual(logRows.length, 1,
      'pack_size_changes must not gain or lose rows on a quiet re-ingest');
    assert.strictEqual(logRows[0].acknowledged, 0,
      'acknowledged flag must remain 0 — ingest must not touch durable queue state');

    // vendor_prices.map_status resets to NULL — intentional run-scoped
    // behavior. The durable attention-queue signal is the
    // pack_size_changes row above; map_status is a one-shot "this run
    // detected a change" marker.
    const vp3 = db.prepare(
      `SELECT map_status FROM vendor_prices WHERE vendor='sysco' AND sku='SYSCO-12345' AND location_id=?`,
    ).get(LOC);
    assert.strictEqual(vp3.map_status, null,
      'map_status is run-scoped — a quiet re-ingest produces no diff, so it lands NULL');
    db.close();
  });
});

describe('T6 — NULL-to-value transitions fire a log (pack_size / pack_unit)', () => {
  it('pack_size transitions from NULL to 6 logs a change', () => {
    const db = makeDb();

    ingestCosting(db, vpPayload([
      { ingredient: 'Tomato Sauce', vendor: 'sysco', sku: 'NS-1',
        pack_size: null, pack_unit: '#10', pack_price: 42.0, unit_price: 7.0 },
    ]), LOC);

    const s2 = ingestCosting(db, vpPayload([
      { ingredient: 'Tomato Sauce', vendor: 'sysco', sku: 'NS-1',
        pack_size: 6, pack_unit: '#10', pack_price: 42.0, unit_price: 7.0 },
    ]), LOC);
    assert.strictEqual(s2.pack_size_changes, 1,
      'pack_size null→6 is a real substitution, must log');
    const row = db.prepare(
      `SELECT prev_pack, new_pack FROM pack_size_changes WHERE sku='NS-1'`,
    ).get();
    // prev_pack null because prior pack_size was null (formatPack returns null
    // when either side is null); new_pack is the populated "6x#10".
    assert.strictEqual(row.prev_pack, null);
    assert.strictEqual(row.new_pack, '6x#10');
    db.close();
  });

  it('pack_unit transitions from NULL to "lb" logs a change', () => {
    const db = makeDb();

    ingestCosting(db, vpPayload([
      { ingredient: 'Ribeye', vendor: 'sysco', sku: 'NU-1',
        pack_size: 10, pack_unit: null, pack_price: 150.0, unit_price: 15.0 },
    ]), LOC);

    const s2 = ingestCosting(db, vpPayload([
      { ingredient: 'Ribeye', vendor: 'sysco', sku: 'NU-1',
        pack_size: 10, pack_unit: 'lb', pack_price: 150.0, unit_price: 15.0 },
    ]), LOC);
    assert.strictEqual(s2.pack_size_changes, 1,
      'pack_unit null→lb is a real substitution, must log');
    const row = db.prepare(
      `SELECT prev_pack, new_pack FROM pack_size_changes WHERE sku='NU-1'`,
    ).get();
    assert.strictEqual(row.prev_pack, null);
    assert.strictEqual(row.new_pack, '10xlb');
    db.close();
  });
});

describe('T6 — pack_size int vs float tolerance (6 vs 6.0 does NOT fire)', () => {
  it('Number(6) === Number(6.0) so REAL round-trip is not a false positive', () => {
    const db = makeDb();

    ingestCosting(db, vpPayload([
      { ingredient: 'Tomato Sauce', vendor: 'sysco', sku: 'FLOAT-1',
        pack_size: 6, pack_unit: '#10', pack_price: 42.0, unit_price: 7.0 },
    ]), LOC);

    const s2 = ingestCosting(db, vpPayload([
      { ingredient: 'Tomato Sauce', vendor: 'sysco', sku: 'FLOAT-1',
        pack_size: 6.0, pack_unit: '#10', pack_price: 42.0, unit_price: 7.0 },
    ]), LOC);
    assert.strictEqual(s2.pack_size_changes, 0,
      '6 vs 6.0 must not fire — SQLite REAL↔INT storage is transparent');
    const count = db.prepare('SELECT COUNT(*) AS c FROM pack_size_changes').get().c;
    assert.strictEqual(count, 0);
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
