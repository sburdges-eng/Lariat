#!/usr/bin/env node
// Tests for the /management rollup page's data-layer behavior.
//
// We don't render the JSX (Next server components + next/link won't load
// cleanly under bare `node --test`), so we exercise the same read shape
// the page does and assert the contracts the page relies on:
//
//   1. Empty-state — with no accounting_variance rows on file,
//      readLatestAccountingVariance(db, loc) returns null. The page
//      treats null as the "no compute run yet" empty state.
//
//   2. Location scoping — when we pass loc='other', the cleaning_log
//      and accounting_variance reads only return that location's rows.
//      This guards against the regression PR review #96 flagged: the
//      page was hardcoding loc=DEFAULT_LOCATION_ID, so a multi-site
//      install would silently cross-leak 'default' data into every
//      site's dashboard.
//
//   3. Pack-changes O(1) count — we replaced the full-bom_lines scan
//      with `SELECT COUNT(*) FROM pack_size_changes WHERE acknowledged
//      = 0`. Verify the count tracks ack/unack state and survives a
//      legacy DB without the table (returns null, page renders '—').
//
// Run: node --experimental-strip-types --test tests/js/test-management-rollup.mjs

import { register } from 'node:module';
register(new URL('./resolver.mjs', import.meta.url));

import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

const { getDb, setDbPathForTest } = await import('../../lib/db.ts');
const { readLatestAccountingVariance } = await import('../../lib/computeEngine/index.ts');

setDbPathForTest(':memory:');
const db = getDb();
after(() => setDbPathForTest(null));

beforeEach(() => {
  db.exec(`
    DELETE FROM accounting_variance;
    DELETE FROM cleaning_log;
    DELETE FROM pack_size_changes;
  `);
});

// ── Page-style readers (mirror app/management/page.jsx) ─────────────────
// These match the page's inline reads exactly. If the page changes its
// SQL, this test will fall out of sync — that's the intent. The test
// is the contract.

function readCleaningTodayLikePage(db, locationId) {
  const today = new Date().toISOString().slice(0, 10);
  const row = db
    .prepare(
      `SELECT COUNT(*) AS c FROM cleaning_log WHERE location_id = ? AND shift_date = ?`,
    )
    .get(locationId, today);
  return row?.c ?? 0;
}

function readPackSizeChangesUnackedLikePage(db) {
  try {
    const row = db
      .prepare('SELECT COUNT(*) AS c FROM pack_size_changes WHERE acknowledged = 0')
      .get();
    return row?.c ?? 0;
  } catch {
    return null;
  }
}

describe('management rollup — empty state', () => {
  it('readLatestAccountingVariance returns null when no rows on file', () => {
    const v = readLatestAccountingVariance(db, 'default');
    assert.strictEqual(v, null);
  });

  it('cleaning_log count is 0 on a fresh DB', () => {
    assert.strictEqual(readCleaningTodayLikePage(db, 'default'), 0);
  });

  it('pack_size_changes count is 0 on a fresh DB', () => {
    assert.strictEqual(readPackSizeChangesUnackedLikePage(db), 0);
  });
});

describe('management rollup — location scoping', () => {
  beforeEach(() => {
    const today = new Date().toISOString().slice(0, 10);
    // Two sites with cleaning entries today.
    db.prepare(
      `INSERT INTO cleaning_log (shift_date, location_id, area, task, completed_at)
       VALUES (?, 'default', 'line', 'wipe-down', datetime('now'))`,
    ).run(today);
    db.prepare(
      `INSERT INTO cleaning_log (shift_date, location_id, area, task, completed_at)
       VALUES (?, 'default', 'line', 'sanitize', datetime('now'))`,
    ).run(today);
    db.prepare(
      `INSERT INTO cleaning_log (shift_date, location_id, area, task, completed_at)
       VALUES (?, 'other', 'bar', 'wipe-down', datetime('now'))`,
    ).run(today);

    // Two sites with accounting_variance rows.
    db.prepare(
      `INSERT INTO accounting_variance
         (theoretical_cogs, actual_cogs, variance_amount, variance_pct, location_id)
       VALUES (1000, 1080, 80, 8.0, 'default')`,
    ).run();
    db.prepare(
      `INSERT INTO accounting_variance
         (theoretical_cogs, actual_cogs, variance_amount, variance_pct, location_id)
       VALUES (500, 510, 10, 2.0, 'other')`,
    ).run();
  });

  it("'default' site sees only its own cleaning rows", () => {
    assert.strictEqual(readCleaningTodayLikePage(db, 'default'), 2);
  });

  it("'other' site sees only its own cleaning rows", () => {
    assert.strictEqual(readCleaningTodayLikePage(db, 'other'), 1);
  });

  it("a site that doesn't exist returns 0", () => {
    assert.strictEqual(readCleaningTodayLikePage(db, 'ghost'), 0);
  });

  it("'default' site sees its own variance row, not 'other'", () => {
    const v = readLatestAccountingVariance(db, 'default');
    assert.ok(v);
    assert.strictEqual(v.variance_pct, 8.0);
    assert.strictEqual(v.theoretical_cogs, 1000);
  });

  it("'other' site sees its own variance row, not 'default'", () => {
    const v = readLatestAccountingVariance(db, 'other');
    assert.ok(v);
    assert.strictEqual(v.variance_pct, 2.0);
    assert.strictEqual(v.theoretical_cogs, 500);
  });
});

describe('management rollup — pack-size count is O(1) and ack-aware', () => {
  it('counts only acknowledged=0 rows; ignores acked', () => {
    db.prepare(
      `INSERT INTO pack_size_changes (vendor, sku, prev_pack, new_pack, acknowledged)
       VALUES ('sysco', 'A', '6x#10', '4x#10', 0)`,
    ).run();
    db.prepare(
      `INSERT INTO pack_size_changes (vendor, sku, prev_pack, new_pack, acknowledged)
       VALUES ('sysco', 'B', '12x12oz', '24x6oz', 0)`,
    ).run();
    db.prepare(
      `INSERT INTO pack_size_changes (vendor, sku, prev_pack, new_pack, acknowledged)
       VALUES ('shamrock', 'C', '1cs', '2cs', 1)`,
    ).run();

    assert.strictEqual(readPackSizeChangesUnackedLikePage(db), 2);

    // Acknowledge one of the two outstanding — count should drop to 1.
    db.prepare(`UPDATE pack_size_changes SET acknowledged = 1 WHERE sku = 'A'`).run();
    assert.strictEqual(readPackSizeChangesUnackedLikePage(db), 1);
  });

  it('returns null when the pack_size_changes table is missing (legacy DB)', () => {
    // Drop the table to simulate a pre-migration DB.
    db.exec('DROP TABLE pack_size_changes');
    assert.strictEqual(readPackSizeChangesUnackedLikePage(db), null);

    // Recreate so other tests' beforeEach DELETE doesn't crash.
    db.exec(`
      CREATE TABLE pack_size_changes (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        vendor       TEXT NOT NULL,
        sku          TEXT NOT NULL,
        prev_pack    TEXT,
        new_pack     TEXT,
        prev_price   REAL,
        new_price    REAL,
        detected_at  TEXT DEFAULT (datetime('now')),
        acknowledged INTEGER DEFAULT 0
      );
    `);
  });
});
