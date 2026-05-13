#!/usr/bin/env node
// T9 acceptance — B1 variance, B2 unmapped queue, B3 ingest instrumentation.
// Run: node --experimental-strip-types --test tests/js/test-t9-benchmarks.mjs
//
// Exercises:
//   - ingest_runs table schema (PRAGMA) + index presence
//   - running → ok UPDATE flow for a single ingest
//   - ingestCosting() success path: an ok row with finished_at non-NULL
//   - ingestCosting() failure path: a failed row re-thrown to caller
//   - B1 variance metric: drift case → variance > 0
//   - B1 variance metric: zero-drift → variance == 0 byte-exact
//   - B1 aggregates (max, mean, recipes_over_5pct)
//   - B1/D6: drop-the-BOM-fallback — unmatched lines excluded from math,
//     recipes above threshold entirely excluded from aggregate
//   - B2 unmapped: union-of-4-reasons fixture lands 4/10 unmapped
//   - B2 unmapped: zero-unmapped fixture yields empty list + pct=0
//   - B2 unmapped: cap-at-50 bound
//   - B2 unmapped: each reason value is one of the four known strings
//   - B2/T6 extension: vendor_prices PACK_CHANGED rows surface with
//     kind='vendor_pack_change'; pack_size_changes.acknowledged=0 count
//     surfaced on the summary.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';

import { initSchema } from '../../lib/db.ts';
import { normalizeIngredientKey } from '../../lib/ingredientKey.ts';
import { ingestCosting } from '../../scripts/ingest-costing.mjs';
import {
  computeCostVariance,
  computeUnmapped,
  DEFAULT_UNMATCHED_THRESHOLD,
} from '../../lib/costingBenchmarks.mjs';

const LOC = 'default';

function freshDb() {
  const db = new Database(':memory:');
  initSchema(db);
  return db;
}

// ── B3 schema ───────────────────────────────────────────────────────
describe('T9 / B3 — ingest_runs schema', () => {
  it('ingest_runs table exists with the spec columns', () => {
    const db = freshDb();
    const cols = db.prepare('PRAGMA table_info(ingest_runs)').all().map((c) => c.name);
    assert.deepStrictEqual(
      cols,
      ['id', 'kind', 'started_at', 'finished_at', 'rows_in', 'rows_out', 'status'],
      `unexpected column list: ${cols.join(',')}`,
    );
    const info = db.prepare('PRAGMA table_info(ingest_runs)').all();
    const kind = info.find((c) => c.name === 'kind');
    const startedAt = info.find((c) => c.name === 'started_at');
    assert.strictEqual(kind.notnull, 1, 'kind must be NOT NULL');
    assert.strictEqual(startedAt.notnull, 1, 'started_at must be NOT NULL');
    db.close();
  });

  it('idx_ingest_runs_kind_started index exists', () => {
    const db = freshDb();
    const row = db
      .prepare(
        `SELECT name FROM sqlite_master
          WHERE type='index' AND name='idx_ingest_runs_kind_started'`,
      )
      .get();
    assert.ok(row, 'idx_ingest_runs_kind_started index missing');
    db.close();
  });

  it('inserting a row with status=ok persists started_at and finished_at', () => {
    const db = freshDb();
    const id = Number(
      db
        .prepare(
          `INSERT INTO ingest_runs (kind, started_at, status, rows_in, rows_out, finished_at)
           VALUES ('costing', datetime('now','subsec'), 'ok', 10, 10, datetime('now','subsec'))`,
        )
        .run().lastInsertRowid,
    );
    const row = db.prepare('SELECT * FROM ingest_runs WHERE id = ?').get(id);
    assert.strictEqual(row.status, 'ok');
    assert.ok(row.started_at && row.started_at.length >= 10, 'started_at not populated');
    assert.ok(row.finished_at && row.finished_at.length >= 10, 'finished_at not populated');
    db.close();
  });

  it('running → ok flow keeps the same row id and updates finished_at', () => {
    const db = freshDb();
    const ins = db.prepare(
      `INSERT INTO ingest_runs (kind, started_at, status) VALUES ('costing', datetime('now','subsec'), 'running')`,
    );
    const id = Number(ins.run().lastInsertRowid);
    const pre = db.prepare('SELECT status, finished_at FROM ingest_runs WHERE id=?').get(id);
    assert.strictEqual(pre.status, 'running');
    assert.strictEqual(pre.finished_at, null);

    db.prepare(
      `UPDATE ingest_runs SET status='ok', finished_at=datetime('now','subsec'), rows_out=0 WHERE id=?`,
    ).run(id);
    const post = db.prepare('SELECT status, finished_at FROM ingest_runs WHERE id=?').get(id);
    assert.strictEqual(post.status, 'ok');
    assert.ok(post.finished_at && post.finished_at.length >= 10);
    db.close();
  });
});

// ── B3 instrumentation path through ingestCosting() ────────────────
describe('T9 / B3 — ingestCosting() records an ingest_runs row', () => {
  it('success path lands a single status=ok row with rows_out populated', () => {
    const db = freshDb();
    const data = {
      recipe_costs: [{ recipe_id: 'r1', recipe_name: 'r1', batch_cost: 1.0, yield: 1, yield_unit: 'each' }],
      bom_lines: [{ recipe_id: 'r1', ingredient: 'water', qty: 1, unit: 'lb', pack_price: 1, pack_size: 1 }],
      vendor_prices: [{ ingredient: 'water', vendor: 'sysco', pack_size: 1, pack_unit: 'lb', pack_price: 1, unit_price: 1 }],
    };
    assert.doesNotThrow(() => ingestCosting(db, data, LOC));
    const rows = db.prepare(`SELECT kind, status, rows_in, rows_out FROM ingest_runs`).all();
    assert.strictEqual(rows.length, 1, 'expected exactly one ingest_runs row');
    assert.strictEqual(rows[0].kind, 'costing');
    assert.strictEqual(rows[0].status, 'ok');
    assert.ok(rows[0].rows_out >= 3, 'rows_out must reflect bom+vp+rc totals');
    assert.strictEqual(rows[0].rows_in, 3, 'rows_in must equal |bom|+|vp|+|rc| input arrays');
    const finished = db.prepare(`SELECT finished_at FROM ingest_runs`).get().finished_at;
    assert.ok(finished, 'finished_at must be non-NULL on success');
    db.close();
  });

  it('failure path leaves a status=failed row and re-throws to caller', () => {
    const db = freshDb();
    // Malformed payload — recipe_costs with recipe_id drops the NOT NULL on
    // insertion? Instead, inject a bom_line whose recipe_id triggers a NOT NULL
    // violation. Easier: poison the prepared statement by passing a BOM with
    // recipe_id=null; the transaction will throw and the outer wrapper must
    // catch+flag.
    const badData = {
      bom_lines: [null], // iterating over null.recipe_id triggers a TypeError
    };
    assert.throws(() => ingestCosting(db, badData, LOC));
    const rows = db.prepare(`SELECT status, finished_at FROM ingest_runs`).all();
    assert.strictEqual(rows.length, 1, 'failed ingest must still leave one ingest_runs row');
    assert.strictEqual(rows[0].status, 'failed');
    assert.ok(rows[0].finished_at, 'finished_at must be populated on failure');
    db.close();
  });
});

// ── B1 variance metric ─────────────────────────────────────────────
describe('T9 / B1 — variance metric', () => {
  function seedVariance(db, { recipeBatch, recipeYield, bom, vendor }) {
    db.prepare(
      `INSERT INTO recipe_costs (recipe_id, recipe_name, batch_cost, cost_per_yield_unit, yield, yield_unit, location_id)
       VALUES (?, ?, ?, ?, ?, 'each', ?)`,
    ).run('r1', 'R1', recipeBatch, recipeBatch / recipeYield, recipeYield, LOC);
    for (const line of bom) {
      db.prepare(
        `INSERT INTO bom_lines (recipe_id, ingredient, qty, unit, pack_price, pack_size, yield_pct, loss_factor, location_id)
         VALUES (?, ?, ?, 'lb', ?, ?, ?, ?, ?)`,
      ).run(
        'r1',
        line.ingredient,
        line.qty,
        line.pack_price,
        line.pack_size,
        line.yield_pct ?? null,
        line.loss_factor ?? null,
        LOC,
      );
    }
    for (const v of vendor) {
      db.prepare(
        `INSERT INTO vendor_prices (ingredient, vendor, pack_size, pack_unit, pack_price, unit_price, location_id)
         VALUES (?, 'sysco', ?, 'lb', ?, ?, ?)`,
      ).run(v.ingredient, v.pack_size, v.pack_price, v.pack_price / v.pack_size, LOC);
    }
  }

  it('drift case: vendor_prices pack_price higher than bom_lines → variance > 0', () => {
    const db = freshDb();
    // BOM row at pack_price=50 / size=50, recipe theoretical = 1.0 per yield unit.
    // Vendor price drifts up to $60 for the same pack_size. Actual = 60/50 × 1 qty = 1.2.
    seedVariance(db, {
      recipeBatch: 1.0,
      recipeYield: 1,
      bom: [{ ingredient: 'onion', qty: 1, pack_price: 50, pack_size: 50 }],
      vendor: [{ ingredient: 'onion', pack_size: 50, pack_price: 60 }],
    });
    const result = computeCostVariance(db, LOC);
    assert.strictEqual(result.rows.length, 1);
    assert.ok(result.rows[0].variance_pct > 0, `expected variance > 0, got ${result.rows[0].variance_pct}`);
    // Expected: |1.2 - 1.0| / 1.0 × 100 = 20%.
    assert.ok(Math.abs(result.rows[0].variance_pct - 20) < 0.01);
    assert.strictEqual(result.max_variance_pct, result.rows[0].variance_pct);
    db.close();
  });

  it('zero-drift case: vendor pack_price == bom pack_price → variance is exactly 0', () => {
    const db = freshDb();
    seedVariance(db, {
      recipeBatch: 1.0,
      recipeYield: 1,
      bom: [{ ingredient: 'onion', qty: 1, pack_price: 50, pack_size: 50 }],
      vendor: [{ ingredient: 'onion', pack_size: 50, pack_price: 50 }],
    });
    const result = computeCostVariance(db, LOC);
    assert.strictEqual(result.rows.length, 1);
    assert.strictEqual(result.rows[0].variance_pct, 0);
    assert.strictEqual(result.max_variance_pct, 0);
    assert.strictEqual(result.mean_variance_pct, 0);
    assert.strictEqual(result.recipes_over_5pct, 0);
    db.close();
  });

  it('aggregates: max / mean / recipes_over_5pct match per-recipe values', () => {
    const db = freshDb();
    // Three recipes at 0%, 3%, and 10% drift.
    const inserts = [
      { recipe: 'r_zero', bomPrice: 50, vPrice: 50 },   // 0%
      { recipe: 'r_mid',  bomPrice: 50, vPrice: 51.5 }, // 3%
      { recipe: 'r_hi',   bomPrice: 50, vPrice: 55 },   // 10%
    ];
    for (const i of inserts) {
      db.prepare(
        `INSERT INTO recipe_costs (recipe_id, recipe_name, batch_cost, cost_per_yield_unit, yield, yield_unit, location_id)
         VALUES (?, ?, 1.0, 1.0, 1, 'each', ?)`,
      ).run(i.recipe, i.recipe, LOC);
      db.prepare(
        `INSERT INTO bom_lines (recipe_id, ingredient, qty, unit, pack_price, pack_size, location_id)
         VALUES (?, ?, 1, 'lb', ?, 50, ?)`,
      ).run(i.recipe, `ing_${i.recipe}`, i.bomPrice, LOC);
      db.prepare(
        `INSERT INTO vendor_prices (ingredient, vendor, pack_size, pack_unit, pack_price, unit_price, location_id)
         VALUES (?, 'sysco', 50, 'lb', ?, ?, ?)`,
      ).run(`ing_${i.recipe}`, i.vPrice, i.vPrice / 50, LOC);
    }
    const r = computeCostVariance(db, LOC);
    assert.strictEqual(r.rows.length, 3);
    const byId = Object.fromEntries(r.rows.map((row) => [row.recipe_id, row.variance_pct]));
    assert.strictEqual(byId.r_zero, 0);
    assert.ok(Math.abs(byId.r_mid - 3) < 0.01);
    assert.ok(Math.abs(byId.r_hi - 10) < 0.01);
    assert.ok(Math.abs(r.max_variance_pct - 10) < 0.01);
    // mean of {0, 3, 10} = 4.33…
    assert.ok(Math.abs(r.mean_variance_pct - (0 + 3 + 10) / 3) < 0.02);
    // recipes_over_5pct: only r_hi at 10.
    assert.strictEqual(r.recipes_over_5pct, 1);
    db.close();
  });
});

// ── B2 unmapped queue ──────────────────────────────────────────────
describe('T9 / B2 — unmapped queue', () => {
  function seedBom(db, lines) {
    const ins = db.prepare(
      `INSERT INTO bom_lines (recipe_id, ingredient, qty, unit, pack_price, pack_size, yield_pct, loss_factor, map_status, location_id)
       VALUES (?, ?, 1, 'lb', ?, ?, ?, ?, ?, ?)`,
    );
    // NOTE: pick() uses 'key in l' rather than ?? so an explicit `null` in the
    // fixture is preserved (testing null-handling is half the point of the
    // unmapped-reason priority logic).
    const pick = (l, key, fallback) => (key in l ? l[key] : fallback);
    for (const l of lines) {
      ins.run(
        pick(l, 'recipe_id', 'r1'),
        l.ingredient,
        pick(l, 'pack_price', 10),
        pick(l, 'pack_size', 1),
        pick(l, 'yield_pct', null),
        pick(l, 'loss_factor', null),
        pick(l, 'map_status', 'mapped'),
        LOC,
      );
    }
  }

  it('union fixture: 2/10 NULL map_status + 1/10 no price + 1/10 no yield → 4/10 unmapped', () => {
    const db = freshDb();
    // Seed a yield ingredient_yields row so "seeded but ingest didn't run yet"
    // does NOT count as no_yield. The line that should be no_yield references
    // an ingredient whose key is NOT in ingredient_yields.
    db.prepare(
      `INSERT INTO ingredient_yields (ingredient_key, yield_pct, source) VALUES (?, ?, 'seed')`,
    ).run(normalizeIngredientKey('salt'), 1.0);
    seedBom(db, [
      { ingredient: 'salt', yield_pct: 1.0, map_status: 'mapped' },             // mapped
      { ingredient: 'water', yield_pct: 1.0, map_status: 'mapped' },            // mapped (yield_pct set)
      { ingredient: 'a_mapped', yield_pct: 1.0, map_status: 'confirmed' },      // confirmed
      { ingredient: 'b_mapped', yield_pct: 1.0, map_status: 'mapped' },         // mapped
      { ingredient: 'c_mapped', yield_pct: 1.0, map_status: 'auto_mapped' },    // auto_mapped
      { ingredient: 'd_mapped', yield_pct: 1.0, map_status: 'mapped' },         // mapped
      { ingredient: 'unk_status_a', yield_pct: 1.0, map_status: null },         // NULL status
      { ingredient: 'unk_status_b', yield_pct: 1.0, map_status: null },         // NULL status
      { ingredient: 'no_price_ing', yield_pct: 1.0, pack_price: null, map_status: 'mapped' }, // no price
      { ingredient: 'novel_ingredient', yield_pct: null, map_status: 'mapped' }, // no yield (not seeded)
    ]);
    const r = computeUnmapped(db, LOC);
    assert.strictEqual(r.total_items, 10);
    assert.strictEqual(r.unmapped_count, 4, `expected 4 unmapped, got ${r.unmapped_count}`);
    assert.strictEqual(r.unmapped_pct, 40.0);
    db.close();
  });

  it('all-mapped fixture: unmapped_count == 0, pct == 0, rows == []', () => {
    const db = freshDb();
    seedBom(db, [
      { ingredient: 'a', yield_pct: 1.0, map_status: 'mapped' },
      { ingredient: 'b', yield_pct: 1.0, map_status: 'confirmed' },
      { ingredient: 'c', yield_pct: 1.0, map_status: 'auto_mapped' },
    ]);
    const r = computeUnmapped(db, LOC);
    assert.strictEqual(r.total_items, 3);
    assert.strictEqual(r.unmapped_count, 0);
    assert.strictEqual(r.unmapped_pct, 0);
    assert.deepStrictEqual(r.rows, []);
    db.close();
  });

  it('no_cost_utility rows are excluded from totalItems and never flagged unmapped', () => {
    // Tap water and other policy-zero ingredients carry map_status='no_cost_utility'.
    // They have no vendor pack_size/pack_price by design; the unmapped queue must
    // treat them as out-of-scope rather than as a coverage gap.
    const db = freshDb();
    seedBom(db, [
      { ingredient: 'a', yield_pct: 1.0, map_status: 'mapped' },
      { ingredient: 'b', yield_pct: 1.0, map_status: 'mapped' },
      // 3 water rows with NULL pack_size + NULL pack_price + NULL yield_pct —
      // every per-row check would normally fail. Status must short-circuit them.
      {
        ingredient: 'water',
        pack_size: null,
        pack_price: null,
        yield_pct: null,
        map_status: 'no_cost_utility',
      },
      {
        ingredient: 'water',
        pack_size: null,
        pack_price: null,
        yield_pct: null,
        map_status: 'no_cost_utility',
      },
      {
        ingredient: 'water',
        pack_size: null,
        pack_price: null,
        yield_pct: null,
        map_status: 'no_cost_utility',
      },
    ]);
    const r = computeUnmapped(db, LOC);
    // Denominator excludes the 3 water rows; only the 2 mapped rows count.
    assert.strictEqual(r.total_items, 2, 'no_cost_utility rows must not inflate totalItems');
    assert.strictEqual(r.unmapped_count, 0, 'no_cost_utility rows must not appear unmapped');
    assert.strictEqual(r.unmapped_pct, 0);
    assert.deepStrictEqual(r.rows, []);
    db.close();
  });

  it('no_cost_utility coexists with real unmapped rows without distorting the ratio', () => {
    const db = freshDb();
    seedBom(db, [
      { ingredient: 'a', yield_pct: 1.0, map_status: 'mapped' },
      { ingredient: 'b', yield_pct: 1.0, map_status: 'mapped' },
      { ingredient: 'c', yield_pct: 1.0, map_status: 'mapped' },
      { ingredient: 'd', yield_pct: 1.0, map_status: null }, // 1 real unmapped
      // Water — out of scope, should not affect denominator
      {
        ingredient: 'water',
        pack_size: null,
        pack_price: null,
        yield_pct: null,
        map_status: 'no_cost_utility',
      },
      {
        ingredient: 'water',
        pack_size: null,
        pack_price: null,
        yield_pct: null,
        map_status: 'no_cost_utility',
      },
    ]);
    const r = computeUnmapped(db, LOC);
    // 4 accounted (a,b,c,d) — 1 unmapped (d) → 25%, not 1/6=16.67%
    assert.strictEqual(r.total_items, 4);
    assert.strictEqual(r.unmapped_count, 1);
    assert.strictEqual(r.unmapped_pct, 25.0);
    assert.strictEqual(r.rows.length, 1);
    assert.strictEqual(r.rows[0].reason, 'unmapped_status');
    db.close();
  });

  it('each row has a reason from the known set and rows cap at 50', () => {
    const db = freshDb();
    // Build 60 guaranteed-unmapped rows so we hit both the reason-set check
    // and the 50-row cap in one fixture.
    const lines = [];
    for (let i = 0; i < 60; i++) {
      lines.push({
        recipe_id: `r${i}`,
        ingredient: `ing_${i}`,
        yield_pct: null,              // no seeded key either — no_yield
        map_status: null,             // would also be unmapped_status
      });
    }
    seedBom(db, lines);
    const r = computeUnmapped(db, LOC);
    assert.strictEqual(r.total_items, 60);
    assert.strictEqual(r.unmapped_count, 60);
    assert.strictEqual(r.rows.length, 50, 'rows must be capped at 50');
    const allowed = new Set(['no_pack_size', 'no_price', 'no_yield', 'unmapped_status']);
    for (const row of r.rows) {
      assert.ok(allowed.has(row.reason), `unexpected reason: ${row.reason}`);
    }
    db.close();
  });

  it('single BOM row with multiple failures counts once (no double-counting)', () => {
    const db = freshDb();
    // This row is simultaneously: no_price, no_yield, unmapped_status.
    // Priority order means it should surface as no_price (reason #2 after
    // no_pack_size which doesn't apply here).
    seedBom(db, [
      {
        ingredient: 'triple_fail',
        pack_price: null,           // triggers no_price
        pack_size: 1,               // avoids no_pack_size
        yield_pct: null,            // triggers no_yield
        map_status: 'UNMAPPED',     // triggers unmapped_status
      },
      {
        ingredient: 'ok_row',
        pack_price: 10,
        pack_size: 1,
        yield_pct: 1.0,
        map_status: 'mapped',
      },
    ]);
    const r = computeUnmapped(db, LOC);
    assert.strictEqual(r.total_items, 2);
    assert.strictEqual(r.unmapped_count, 1, 'multi-failure row must dedupe to 1');
    assert.strictEqual(r.rows[0].reason, 'no_price');
    db.close();
  });
});

// ── D6 — drop the B1 variance fallback; surface unmatched_lines ────
describe('T9 / B1 / D6 — unmatched_lines counter + high-ratio exclusion', () => {
  // Shared seed for D6 cases: varies (bom_lines, vendor_prices) coverage.
  // Each "line" is an independently-keyed ingredient with its own optional
  // vendor_prices row. qty=1, pack_price=50, pack_size=50 by convention so
  // a missing vendor row flipped to a matching vendor row is byte-exact
  // zero-drift (same math as the existing zero-drift baseline case).
  function seedRecipeWithCoverage(db, {
    recipeId = 'r1',
    recipeBatch = 1.0,
    recipeYield = 1,
    // lines: [{ ingredient, hasVendor: bool, vendorPrice?: number }]
    lines,
  }) {
    db.prepare(
      `INSERT INTO recipe_costs (recipe_id, recipe_name, batch_cost, cost_per_yield_unit, yield, yield_unit, location_id)
       VALUES (?, ?, ?, ?, ?, 'each', ?)`,
    ).run(recipeId, recipeId, recipeBatch, recipeBatch / recipeYield, recipeYield, LOC);
    for (const [i, line] of lines.entries()) {
      const ing = line.ingredient ?? `ing_${recipeId}_${i}`;
      db.prepare(
        `INSERT INTO bom_lines (recipe_id, ingredient, qty, unit, pack_price, pack_size, yield_pct, loss_factor, location_id)
         VALUES (?, ?, ?, 'lb', ?, ?, ?, ?, ?)`,
      ).run(
        recipeId,
        ing,
        line.qty ?? (1 / lines.length), // split contribution so Σ qty×price/size = recipeBatch
        line.bomPackPrice ?? 50,
        line.bomPackSize ?? 50,
        line.yield_pct ?? 1.0,
        line.loss_factor ?? 0.0,
        LOC,
      );
      if (line.hasVendor) {
        db.prepare(
          `INSERT INTO vendor_prices (ingredient, vendor, pack_size, pack_unit, pack_price, unit_price, location_id)
           VALUES (?, 'sysco', ?, 'lb', ?, ?, ?)`,
        ).run(
          ing,
          line.vendorPackSize ?? 50,
          line.vendorPrice ?? 50,
          (line.vendorPrice ?? 50) / (line.vendorPackSize ?? 50),
          LOC,
        );
      }
    }
  }

  it('100% matched: contributes to aggregate with unmatched_lines=0', () => {
    const db = freshDb();
    seedRecipeWithCoverage(db, {
      lines: [
        { ingredient: 'a', hasVendor: true, vendorPrice: 50, qty: 0.5 },
        { ingredient: 'b', hasVendor: true, vendorPrice: 50, qty: 0.5 },
      ],
    });
    const r = computeCostVariance(db, LOC);
    assert.strictEqual(r.rows.length, 1);
    assert.strictEqual(r.rows[0].total_lines, 2);
    assert.strictEqual(r.rows[0].unmatched_lines, 0);
    assert.strictEqual(r.rows[0].excluded, false);
    assert.strictEqual(r.rows[0].variance_pct, 0);
    assert.strictEqual(r.summary.healthy, 1);
    assert.strictEqual(r.summary.excluded_high_unmatched, 0);
    db.close();
  });

  it('50% unmatched at default threshold 30%: EXCLUDED with reason=high_unmatched_ratio', () => {
    const db = freshDb();
    // 4 lines total; 2 matched, 2 unmatched → 50% > 30% → excluded.
    seedRecipeWithCoverage(db, {
      lines: [
        { ingredient: 'a', hasVendor: true, vendorPrice: 50, qty: 0.25 },
        { ingredient: 'b', hasVendor: true, vendorPrice: 50, qty: 0.25 },
        { ingredient: 'c', hasVendor: false,                  qty: 0.25 },
        { ingredient: 'd', hasVendor: false,                  qty: 0.25 },
      ],
    });
    const r = computeCostVariance(db, LOC);
    assert.strictEqual(r.rows.length, 1);
    const row = r.rows[0];
    assert.strictEqual(row.excluded, true);
    assert.strictEqual(row.exclusion_reason, 'high_unmatched_ratio');
    assert.strictEqual(row.total_lines, 4);
    assert.strictEqual(row.unmatched_lines, 2);
    assert.strictEqual(row.actual, null);
    assert.strictEqual(row.variance_pct, null);
    // Excluded recipe must NOT inflate the aggregate.
    assert.strictEqual(r.max_variance_pct, 0);
    assert.strictEqual(r.mean_variance_pct, 0);
    assert.strictEqual(r.recipes_over_5pct, 0);
    assert.strictEqual(r.summary.excluded_high_unmatched, 1);
    assert.strictEqual(r.summary.healthy, 0);
    db.close();
  });

  it('20% unmatched (below threshold): contributes with unmatched_lines>0', () => {
    const db = freshDb();
    // 5 lines; 4 matched, 1 unmatched → 20% ≤ 30% → contributes.
    seedRecipeWithCoverage(db, {
      lines: [
        { ingredient: 'a', hasVendor: true, vendorPrice: 50, qty: 0.2 },
        { ingredient: 'b', hasVendor: true, vendorPrice: 50, qty: 0.2 },
        { ingredient: 'c', hasVendor: true, vendorPrice: 50, qty: 0.2 },
        { ingredient: 'd', hasVendor: true, vendorPrice: 50, qty: 0.2 },
        { ingredient: 'e', hasVendor: false,                  qty: 0.2 },
      ],
    });
    const r = computeCostVariance(db, LOC);
    assert.strictEqual(r.rows.length, 1);
    const row = r.rows[0];
    assert.strictEqual(row.excluded, false);
    assert.strictEqual(row.exclusion_reason, null);
    assert.strictEqual(row.total_lines, 5);
    assert.strictEqual(row.unmatched_lines, 1);
    // 4 lines × qty=0.2 × price=50/50 = 0.8; theoretical = 1.0 (recipeBatch=1 / yield=1).
    // variance = |0.8 - 1.0| / 1.0 × 100 = 20% — but that's the math the UI shows;
    // what we really want to pin here is "unmatched_lines > 0 AND row not excluded".
    assert.ok(row.variance_pct != null, 'variance should still be computed');
    assert.strictEqual(r.summary.excluded_high_unmatched, 0);
    db.close();
  });

  it('default threshold can be overridden via opts.unmatchedThreshold', () => {
    const db = freshDb();
    // 20% unmatched — at default (30%) would contribute; at 0.10 threshold
    // flips to excluded.
    seedRecipeWithCoverage(db, {
      lines: [
        { ingredient: 'a', hasVendor: true, vendorPrice: 50, qty: 0.2 },
        { ingredient: 'b', hasVendor: true, vendorPrice: 50, qty: 0.2 },
        { ingredient: 'c', hasVendor: true, vendorPrice: 50, qty: 0.2 },
        { ingredient: 'd', hasVendor: true, vendorPrice: 50, qty: 0.2 },
        { ingredient: 'e', hasVendor: false,                  qty: 0.2 },
      ],
    });
    const rDefault = computeCostVariance(db, LOC);
    assert.strictEqual(rDefault.rows[0].excluded, false,
      'sanity check: at default 30% threshold this recipe is not excluded');

    const rStrict = computeCostVariance(db, LOC, { unmatchedThreshold: 0.10 });
    assert.strictEqual(rStrict.rows[0].excluded, true);
    assert.strictEqual(rStrict.rows[0].exclusion_reason, 'high_unmatched_ratio');
    assert.strictEqual(rStrict.summary.excluded_high_unmatched, 1);
    db.close();
  });

  it('DEFAULT_UNMATCHED_THRESHOLD is exported and is 0.30', () => {
    assert.strictEqual(DEFAULT_UNMATCHED_THRESHOLD, 0.30);
  });

  it('pre-D6 fallback is gone: recipe with NO vendor matches is excluded, not healthy', () => {
    const db = freshDb();
    // This is the exact case D6 called out: BOM row has pack_price/pack_size,
    // zero vendor_prices match. Pre-D6 this would produce variance=0
    // byte-exact (silent fallback). Post-D6 it's entirely unmatched → excluded.
    seedRecipeWithCoverage(db, {
      lines: [
        { ingredient: 'a', hasVendor: false, qty: 0.5 },
        { ingredient: 'b', hasVendor: false, qty: 0.5 },
      ],
    });
    const r = computeCostVariance(db, LOC);
    assert.strictEqual(r.rows.length, 1);
    assert.strictEqual(r.rows[0].excluded, true);
    assert.strictEqual(r.rows[0].exclusion_reason, 'high_unmatched_ratio');
    assert.strictEqual(r.rows[0].unmatched_lines, 2);
    assert.strictEqual(r.rows[0].total_lines, 2);
    assert.strictEqual(r.max_variance_pct, 0,
      'no recipe contributes to aggregate → max is 0, not fabricated');
    assert.strictEqual(r.summary.excluded_high_unmatched, 1);
    db.close();
  });

  it('mixed recipes: included and excluded coexist, summary reflects both', () => {
    const db = freshDb();
    // Recipe 1: all matched → healthy (variance 0).
    seedRecipeWithCoverage(db, {
      recipeId: 'healthy',
      lines: [{ ingredient: 'h_a', hasVendor: true, vendorPrice: 50, qty: 1 }],
    });
    // Recipe 2: all unmatched → excluded.
    seedRecipeWithCoverage(db, {
      recipeId: 'excluded',
      lines: [{ ingredient: 'e_a', hasVendor: false, qty: 1 }],
    });
    const r = computeCostVariance(db, LOC);
    assert.strictEqual(r.rows.length, 2);
    // Excluded row sorts to the end.
    assert.strictEqual(r.rows[0].recipe_id, 'healthy');
    assert.strictEqual(r.rows[0].excluded, false);
    assert.strictEqual(r.rows[1].recipe_id, 'excluded');
    assert.strictEqual(r.rows[1].excluded, true);
    assert.strictEqual(r.summary.healthy, 1);
    assert.strictEqual(r.summary.excluded_high_unmatched, 1);
    db.close();
  });
});

// ── T6 / B2 queue extension — PACK_CHANGED surfaces; unacked count ─
describe('T9 / B2 — T6 extension: PACK_CHANGED + pack_size_changes summary', () => {
  it('vendor_prices.map_status=PACK_CHANGED shows as kind=vendor_pack_change', () => {
    const db = freshDb();
    // Seed one clean bom_line + one PACK_CHANGED vendor_prices row. The
    // bom_line is 'mapped' with full coverage so it does NOT land in the
    // bom-side unmapped queue; only the vendor row should surface.
    db.prepare(
      `INSERT INTO bom_lines (recipe_id, ingredient, qty, unit, pack_price, pack_size, yield_pct, loss_factor, map_status, location_id)
       VALUES ('r1', 'clean', 1, 'lb', 10, 1, 1.0, 0, 'mapped', ?)`,
    ).run(LOC);
    db.prepare(
      `INSERT INTO vendor_prices (ingredient, vendor, sku, pack_size, pack_unit, pack_price, unit_price, map_status, location_id)
       VALUES ('tomato sauce', 'sysco', 'SYSCO-12345', 4, '#10', 36.0, 9.0, 'PACK_CHANGED', ?)`,
    ).run(LOC);
    const r = computeUnmapped(db, LOC);
    assert.strictEqual(r.total_items, 1, 'total_items counts bom_lines only');
    assert.strictEqual(r.unmapped_count, 0,
      'vendor_pack_change rows do not inflate unmapped_count');
    assert.strictEqual(r.rows.length, 1);
    const row = r.rows[0];
    assert.strictEqual(row.kind, 'vendor_pack_change');
    assert.strictEqual(row.reason, 'pack_changed');
    assert.strictEqual(row.vendor, 'sysco');
    assert.strictEqual(row.sku, 'SYSCO-12345');
    assert.strictEqual(row.ingredient, 'tomato sauce');
    assert.strictEqual(row.recipe_id, null);
    db.close();
  });

  it('bom_line unmapped rows carry kind=bom_line for back-compat', () => {
    const db = freshDb();
    db.prepare(
      `INSERT INTO bom_lines (recipe_id, ingredient, qty, unit, pack_price, pack_size, yield_pct, loss_factor, map_status, location_id)
       VALUES ('r1', 'pending', 1, 'lb', 10, 1, 1.0, 0, NULL, ?)`,
    ).run(LOC);
    const r = computeUnmapped(db, LOC);
    assert.strictEqual(r.rows.length, 1);
    assert.strictEqual(r.rows[0].kind, 'bom_line');
    assert.strictEqual(r.rows[0].reason, 'unmapped_status');
    db.close();
  });

  it('pack_size_changes_unacknowledged count is surfaced in summary', () => {
    const db = freshDb();
    // Three change rows: two unacked, one acknowledged. Summary reports 2.
    db.prepare(
      `INSERT INTO pack_size_changes (vendor, sku, prev_pack, new_pack, prev_price, new_price, acknowledged)
       VALUES ('sysco','S1','6x#10','4x#10',42,36,0),
              ('sysco','S2','12xea','24xea',50,55,0),
              ('shamrock','S3','10xlb','5xlb',30,20,1)`,
    ).run();
    const r = computeUnmapped(db, LOC);
    assert.strictEqual(r.pack_size_changes_unacknowledged, 2);
    db.close();
  });

  it('missing pack_size_changes / PACK_CHANGED rows → count=0, no crash', () => {
    const db = freshDb();
    const r = computeUnmapped(db, LOC);
    assert.strictEqual(r.pack_size_changes_unacknowledged, 0);
    assert.strictEqual(r.unmapped_count, 0);
    assert.deepStrictEqual(r.rows, []);
    db.close();
  });

  it('bom_line unmapped AND vendor pack_change coexist — no double-count on same ingredient', () => {
    const db = freshDb();
    // Both a bom_line (via NULL map_status) and a vendor pack-change on
    // the same ingredient name. The keys are independent tables — one
    // row each should surface with different kinds, no key collision.
    db.prepare(
      `INSERT INTO bom_lines (recipe_id, ingredient, qty, unit, pack_price, pack_size, yield_pct, loss_factor, map_status, location_id)
       VALUES ('r1', 'tomato sauce', 1, 'cs', 40, 1, 1.0, 0, NULL, ?)`,
    ).run(LOC);
    db.prepare(
      `INSERT INTO vendor_prices (ingredient, vendor, sku, pack_size, pack_unit, pack_price, unit_price, map_status, location_id)
       VALUES ('tomato sauce', 'sysco', 'SYSCO-42', 4, '#10', 36.0, 9.0, 'PACK_CHANGED', ?)`,
    ).run(LOC);
    const r = computeUnmapped(db, LOC);
    assert.strictEqual(r.total_items, 1, 'total_items = bom_lines only');
    assert.strictEqual(r.unmapped_count, 1, 'only bom_line counts toward unmapped_count');
    const kinds = r.rows.map((x) => x.kind).sort();
    assert.deepStrictEqual(kinds, ['bom_line', 'vendor_pack_change']);
    db.close();
  });

  it('end-to-end via ingestCosting: PACK_CHANGED surfaces through computeUnmapped', () => {
    // Integration: drive the real T6 code path (ingest run 2 after a
    // baseline run 1), then call computeUnmapped. Confirms the queue
    // extension sees live flag, not just hand-written fixture rows.
    const db = freshDb();
    const payload = (vpRows) => ({
      vendor_prices: vpRows, recipe_costs: [], bom_lines: [],
      ingredient_maps: [], order_guide: [],
    });
    ingestCosting(db, payload([
      { ingredient: 'Tomato Sauce', vendor: 'sysco', sku: 'SYSCO-42',
        pack_size: 6, pack_unit: '#10', pack_price: 42.0, unit_price: 7.0 },
    ]), LOC);
    ingestCosting(db, payload([
      { ingredient: 'Tomato Sauce', vendor: 'sysco', sku: 'SYSCO-42',
        pack_size: 4, pack_unit: '#10', pack_price: 36.0, unit_price: 9.0 },
    ]), LOC);
    const r = computeUnmapped(db, LOC);
    const packChanged = r.rows.filter((row) => row.kind === 'vendor_pack_change');
    assert.strictEqual(packChanged.length, 1);
    assert.strictEqual(packChanged[0].sku, 'SYSCO-42');
    assert.strictEqual(r.pack_size_changes_unacknowledged, 1,
      'ingest persisted a pack_size_changes row with acknowledged=0');
    db.close();
  });
});
