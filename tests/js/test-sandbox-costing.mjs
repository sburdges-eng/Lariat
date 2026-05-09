#!/usr/bin/env node
// Sandbox costing — perf + behavior pin for `computeSandboxCost`.
//
// Audit reference: docs/audit/2026-05-08-codebase-audit.md §4 (Compute,
// MEDIUM): the previous implementation ran a SQLite
// `WHERE ingredient LIKE '%X%'` SELECT once per ingredient in the LLM
// action payload. With thousands of vendor_prices rows and a Kitchen
// Assistant that fires on every specials submission this was an O(N)
// scan per ingredient. After the fix the function pre-builds an
// in-memory list ONCE and uses an exact-lowercase Map for O(1) hits
// with an in-memory linear fallback for substring matches.
//
// These tests pin two things:
//   1. Behavior is unchanged — same inputs, same outputs, same partial
//      semantics, "newest row wins" still holds, substring fallback
//      still finds vendor rows whose ingredient column carries the
//      LLM-provided substring.
//   2. The per-iteration `vendorStmt.get(...)` SQL is gone — the source
//      no longer calls `db.prepare` inside a `for` loop over the
//      ingredient list. This is a structural assertion: a future
//      regression that reintroduces the LIKE scan would fail this test
//      even if behavior happens to stay correct.
//
// Run: node --experimental-strip-types --test tests/js/test-sandbox-costing.mjs

import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

register(new URL('./resolver.mjs', import.meta.url));

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-sandbox-costing-'));
const TMP_DB = path.join(TMP_DIR, 'lariat-test.db');

const dbMod = await import('../../lib/db.ts');
dbMod.setDbPathForTest(TMP_DB);
const testDb = dbMod.getDb();

const { computeSandboxCost } = await import(
  '../../lib/computeEngine/sandboxCosting.ts'
);

const LOC = 'default';

after(() => {
  dbMod.setDbPathForTest(null);
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

function resetTables() {
  testDb.exec(`
    DELETE FROM vendor_prices;
    DELETE FROM ingredient_densities;
  `);
}

function seedVendorPrice(ingredient, pack_price, pack_size, pack_unit, importedAt, vendor = 'Sysco') {
  testDb.prepare(`
    INSERT INTO vendor_prices (ingredient, vendor, pack_price, pack_size, pack_unit,
                               yield_pct, location_id, imported_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(ingredient, vendor, pack_price, pack_size, pack_unit, 1.0, LOC, importedAt);
}

// ─────────────────────────────────────────────────────────────────
// 1. Behavior unchanged — simple match
// ─────────────────────────────────────────────────────────────────

describe('computeSandboxCost · simple match', () => {
  beforeEach(resetTables);

  it('costs an ingredient by exact lowercase ingredient match', () => {
    seedVendorPrice('beef', 10.0, 1.0, 'lb', '2026-04-10T00:00:00Z');
    const result = computeSandboxCost(LOC, [
      { item: 'beef', qty: 1, unit: 'lb' },
    ]);
    assert.equal(result.partial, false);
    assert.equal(result.breakdown.length, 1);
    const line = result.breakdown[0];
    assert.equal(line.match, 'beef');
    assert.equal(line.cost, 10.0);
    assert.equal(result.totalCost, 10.0);
  });
});

// ─────────────────────────────────────────────────────────────────
// 2. Behavior unchanged — substring fuzzy match
// ─────────────────────────────────────────────────────────────────

describe('computeSandboxCost · substring fuzzy match', () => {
  beforeEach(resetTables);

  it('LLM "Beef Tenderloin" matches vendor "Sysco Beef Tenderloin Steak"', () => {
    seedVendorPrice(
      'Sysco Beef Tenderloin Steak',
      40.0,
      2.0,
      'lb',
      '2026-04-10T00:00:00Z',
    );
    const result = computeSandboxCost(LOC, [
      { item: 'Beef Tenderloin', qty: 1, unit: 'lb' },
    ]);
    assert.equal(result.partial, false);
    const line = result.breakdown[0];
    assert.equal(line.match, 'Sysco Beef Tenderloin Steak');
    // 1 lb / 2 lb pack × $40 / yield 1.0 = $20
    assert.equal(Math.round(line.cost * 1000) / 1000, 20);
  });

  it('case-insensitive substring match — "OLIVE OIL" finds "olive oil 5gal"', () => {
    seedVendorPrice('olive oil 5gal', 50.0, 5.0, 'gal', '2026-04-10T00:00:00Z');
    const result = computeSandboxCost(LOC, [
      { item: 'OLIVE OIL', qty: 1, unit: 'gal' },
    ]);
    assert.equal(result.partial, false);
    assert.equal(result.breakdown[0].match, 'olive oil 5gal');
  });
});

// ─────────────────────────────────────────────────────────────────
// 3. Behavior unchanged — no match → cost null + partial=true
// ─────────────────────────────────────────────────────────────────

describe('computeSandboxCost · no vendor match', () => {
  beforeEach(resetTables);

  it('unknown ingredient produces cost=null with partial=true', () => {
    seedVendorPrice('beef', 10.0, 1.0, 'lb', '2026-04-10T00:00:00Z');
    const result = computeSandboxCost(LOC, [
      { item: 'truffle', qty: 1, unit: 'oz' },
    ]);
    assert.equal(result.partial, true);
    assert.equal(result.totalCost, 0);
    assert.equal(result.breakdown[0].cost, null);
    assert.match(result.breakdown[0].note, /no vendor match/i);
  });

  it('mixed payload — one match, one miss — partial=true and only matched cost contributes', () => {
    seedVendorPrice('beef', 10.0, 1.0, 'lb', '2026-04-10T00:00:00Z');
    const result = computeSandboxCost(LOC, [
      { item: 'beef', qty: 1, unit: 'lb' },
      { item: 'unicorn horn', qty: 1, unit: 'oz' },
    ]);
    assert.equal(result.partial, true);
    assert.equal(result.totalCost, 10.0);
    assert.equal(result.breakdown[0].cost, 10.0);
    assert.equal(result.breakdown[1].cost, null);
  });
});

// ─────────────────────────────────────────────────────────────────
// 4. Behavior unchanged — newest row wins (ORDER BY imported_at DESC, id DESC)
// ─────────────────────────────────────────────────────────────────

describe('computeSandboxCost · newest vendor row wins', () => {
  beforeEach(resetTables);

  it('two rows for same ingredient → later imported_at price is used', () => {
    seedVendorPrice('beef', 8.0, 1.0, 'lb', '2026-03-01T00:00:00Z', 'OldVendor');
    seedVendorPrice('beef', 12.0, 1.0, 'lb', '2026-04-10T00:00:00Z', 'NewVendor');
    const result = computeSandboxCost(LOC, [
      { item: 'beef', qty: 1, unit: 'lb' },
    ]);
    assert.equal(result.breakdown[0].cost, 12.0);
    assert.equal(result.breakdown[0].pack_price, 12.0);
  });

  it('substring match also picks the newest row by imported_at', () => {
    seedVendorPrice('Sysco Chicken Breast', 6.0, 1.0, 'lb', '2026-03-01T00:00:00Z');
    seedVendorPrice('Tyson Chicken Breast', 9.0, 1.0, 'lb', '2026-04-10T00:00:00Z');
    const result = computeSandboxCost(LOC, [
      { item: 'Chicken Breast', qty: 1, unit: 'lb' },
    ]);
    // Newer row wins on substring lookup.
    assert.equal(result.breakdown[0].match, 'Tyson Chicken Breast');
    assert.equal(result.breakdown[0].cost, 9.0);
  });

  it('equal imported_at → larger id (later insert) wins', () => {
    seedVendorPrice('beef', 8.0, 1.0, 'lb', '2026-04-10T00:00:00Z', 'A');
    seedVendorPrice('beef', 11.0, 1.0, 'lb', '2026-04-10T00:00:00Z', 'B');
    const result = computeSandboxCost(LOC, [
      { item: 'beef', qty: 1, unit: 'lb' },
    ]);
    assert.equal(result.breakdown[0].cost, 11.0);
  });
});

// ─────────────────────────────────────────────────────────────────
// 5. Location scoping unchanged
// ─────────────────────────────────────────────────────────────────

describe('computeSandboxCost · location scoping', () => {
  beforeEach(resetTables);

  it('rows from a different location do not leak into the lookup', () => {
    testDb.prepare(`
      INSERT INTO vendor_prices (ingredient, vendor, pack_price, pack_size, pack_unit,
                                 yield_pct, location_id, imported_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run('beef', 'OtherSite', 99.0, 1.0, 'lb', 1.0, 'lariat-south',
            '2026-04-10T00:00:00Z');
    const result = computeSandboxCost(LOC, [
      { item: 'beef', qty: 1, unit: 'lb' },
    ]);
    // No row at LOC → partial=true, cost null.
    assert.equal(result.partial, true);
    assert.equal(result.breakdown[0].cost, null);
  });
});

// ─────────────────────────────────────────────────────────────────
// 6. Structural perf assertion — per-iteration LIKE SELECT is gone
// ─────────────────────────────────────────────────────────────────
//
// Source-grep is deliberate: a unit-level prepare-counter would require
// monkeypatching better-sqlite3 (brittle). Instead we pin the shape we
// want — no `LIKE` substring scan in a per-iteration prepare in this
// file.

describe('computeSandboxCost · structural perf invariant (audit §4 MEDIUM)', () => {
  it('source no longer issues a per-call LIKE substring scan', () => {
    const src = fs.readFileSync(
      new URL('../../lib/computeEngine/sandboxCosting.ts', import.meta.url),
      'utf8',
    );
    // The pre-fix code prepared `WHERE ingredient LIKE ?` and called
    // `.get(locationId, '%${ing.item}%')` once per ingredient. After
    // the fix neither of those patterns should appear.
    assert.ok(
      !/ingredient\s+LIKE\s+\?/i.test(src),
      'sandboxCosting.ts must not run a LIKE-substring SELECT against vendor_prices',
    );
    assert.ok(
      !/`%\$\{ing\.item\}%`/.test(src),
      'sandboxCosting.ts must not bind a `%${ing.item}%` parameter — that is the per-call LIKE scan we removed',
    );
  });

  it('source pre-builds the vendor list once before iterating ingredients', () => {
    const src = fs.readFileSync(
      new URL('../../lib/computeEngine/sandboxCosting.ts', import.meta.url),
      'utf8',
    );
    // The new shape selects all vendor_prices rows for the location
    // upfront with `.all(locationId)` (newest first). Pin that pattern
    // so a refactor can't silently regress to per-call SELECTs.
    assert.match(
      src,
      /FROM\s+vendor_prices[\s\S]*ORDER\s+BY\s+imported_at\s+DESC/i,
      'sandboxCosting.ts should fetch vendor_prices ordered by imported_at DESC',
    );
    assert.match(
      src,
      /\.all\(locationId\)/,
      'sandboxCosting.ts should pull the whole location-scoped vendor_prices list with .all(locationId)',
    );
  });
});

// ─────────────────────────────────────────────────────────────────
// 7. Cross-dim semantics still hold (regression guard for R2-C5)
// ─────────────────────────────────────────────────────────────────

describe('computeSandboxCost · cross-dim density semantics preserved', () => {
  beforeEach(resetTables);

  it('cross-dim with no density → cost null + partial=true', () => {
    seedVendorPrice('flour', 10.0, 1.0, 'lb', '2026-04-10T00:00:00Z');
    const result = computeSandboxCost(LOC, [
      { item: 'flour', qty: 1, unit: 'cup' },
    ]);
    assert.equal(result.breakdown[0].cost, null);
    assert.equal(result.partial, true);
    assert.match(result.breakdown[0].note, /density|cross-dim/i);
  });

  it('cross-dim with density present → succeeds', () => {
    seedVendorPrice('flour', 10.0, 1.0, 'lb', '2026-04-10T00:00:00Z');
    testDb.prepare(
      `INSERT INTO ingredient_densities (ingredient_key, g_per_ml, source)
       VALUES (?, ?, 'seed')`,
    ).run('flour', 0.53);
    const result = computeSandboxCost(LOC, [
      { item: 'flour', qty: 1, unit: 'cup' },
    ]);
    assert.notEqual(result.breakdown[0].cost, null);
    assert.equal(result.partial, false);
  });
});
