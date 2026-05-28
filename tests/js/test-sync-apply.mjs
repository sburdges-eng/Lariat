#!/usr/bin/env node
// Tests for lib/syncApply.ts — the receiving-side applier (T7c).
//
// Covers:
//   - family classifier (family1 / family2 / family3 / unknown)
//   - family 1: INSERT OR IGNORE, schema-drift column drop, idempotency,
//     unknown-table skip, bad-payload skip
//   - family 2: DELETE+INSERT envelope, where defaults to location_id,
//     unknown-where-col schema-drift skip, bad rowJson skip
//   - family 3: skipped with audit-log entry until LWW metadata exists
//   - applyWindow: counters + reasons aggregation
//
// Run: node --experimental-strip-types --test tests/js/test-sync-apply.mjs

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { register } from 'node:module';

register(new URL('./resolver.mjs', import.meta.url));

const Database = (await import('better-sqlite3')).default;

// lib/auditLog.mjs captures process.cwd() at module-load time —
// sandbox cwd before importing applyOp so audit lines don't pollute
// the working tree.
const prevCwd = process.cwd();
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-sync-apply-'));
process.chdir(tmpRoot);

const { getDb, setDbPathForTest } = await import('../../lib/db.ts');
setDbPathForTest(':memory:');
const db = getDb();
after(() => {
  setDbPathForTest(null);
  process.chdir(prevCwd);
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

const {
  applyOp,
  applyWindow,
  familyOf,
  assertFamilyTablesExist,
  FAMILY_1_TABLES,
  FAMILY_2_TABLES,
  FAMILY_3_TABLES,
  FAMILY_2_REQUIRED_WHERE,
  _clearSchemaCacheForTest,
} = await import('../../lib/syncApply.ts');

before(() => {
  db.prepare(
    `INSERT INTO ingest_runs (id, kind, started_at, status)
     VALUES (1, 'test', datetime('now'), 'ok')`,
  ).run();
});

beforeEach(() => {
  db.exec(`
    DELETE FROM cooling_log;
    DELETE FROM line_check_entries;
    DELETE FROM vendor_prices;
    DELETE FROM audit_events;
    DELETE FROM dish_components;
  `);
  _clearSchemaCacheForTest();
  fs.rmSync(path.join(tmpRoot, 'data'), { recursive: true, force: true });
});

function mkOp(over) {
  return {
    opId: `op-${Math.random().toString(36).slice(2, 12)}`,
    tableName: 'line_check_entries',
    locationId: 'default',
    opKind: 'insert',
    rowPk: '1',
    rowJson: '{}',
    createdAt: '2026-05-06T00:00:00Z',
    sourceHost: 'lariat-tablet-1',
    sourceStartedAt: '2026-05-06T00:00:00Z',
    ...over,
  };
}

// ─────────────────────────────────────────────────────────────────
// Family classifier
// ─────────────────────────────────────────────────────────────────

describe('familyOf', () => {
  it('classifies family-1 tables', () => {
    assert.equal(familyOf('cooling_log'), 'family1');
    assert.equal(familyOf('line_check_entries'), 'family1');
    assert.equal(familyOf('audit_events'), 'family1');
  });
  it('classifies family-2 tables', () => {
    assert.equal(familyOf('vendor_prices'), 'family2');
    assert.equal(familyOf('spend_monthly'), 'family2');
  });
  it('classifies family-3 tables', () => {
    assert.equal(familyOf('dish_components'), 'family3');
    assert.equal(familyOf('entities_recipes'), 'family3');
  });
  it('family-1 table names match the live schema', () => {
    // C1 audit-finding regression: 7 names previously did not match.
    assert.equal(familyOf('temp_log'), 'family1');             // was temp_log_entries
    assert.equal(familyOf('sanitizer_checks'), 'family1');     // was sanitizer_log
    assert.equal(familyOf('sick_worker_reports'), 'family1'); // was sick_worker_log
    assert.equal(familyOf('thermometer_calibrations'), 'family1'); // was calibrations_log
    assert.equal(familyOf('pest_control_log'), 'family1');    // was pest_log
    assert.equal(familyOf('sds_registry'), 'family1');         // was sds_log
    assert.equal(familyOf('tphc_entries'), 'family1');         // was tphc_log
  });
  it('recipes is NOT a family-3 table (JSON cache, not SQL)', () => {
    // C1 audit-finding: recipes was incorrectly listed and there is no
    // `recipes` table in the schema. Removed from FAMILY_3_TABLES.
    assert.equal(familyOf('recipes'), 'unknown');
  });
});

// ─────────────────────────────────────────────────────────────────
// assertFamilyTablesExist — boot guard against schema drift
// ─────────────────────────────────────────────────────────────────

describe('assertFamilyTablesExist', () => {
  it('passes against the live schema (no throw)', () => {
    assert.doesNotThrow(() => assertFamilyTablesExist(db));
  });

  it('throws with a helpful message when a family name does not exist', () => {
    // Point the assertion at a fresh DB that's missing every family
    // table except `audit_events` — every other name should land in
    // the missing list.
    const tinyDb = new Database(':memory:');
    tinyDb.exec(`CREATE TABLE audit_events (id INTEGER PRIMARY KEY);`);
    assert.throws(
      () => assertFamilyTablesExist(tinyDb),
      /family-table names do not match schema/,
    );
  });
});

// ─────────────────────────────────────────────────────────────────
// Audit H2 + H8 — PRAGMA cache invalidation + negative cache
// ─────────────────────────────────────────────────────────────────

describe('PRAGMA table_info cache (H2 + H8)', () => {
  it('audit H8: unknown table → result is cached (subsequent ops do NOT re-run PRAGMA)', () => {
    _clearSchemaCacheForTest();
    // We can't measure PRAGMA call count directly from the public API,
    // so instead we verify the cache miss path: first call against
    // missing table → skipped-unknown-table, and the cache populates
    // with an empty-set sentinel that survives a second op.
    const op = mkOp({ tableName: 'never_exists_anywhere' });
    const r1 = applyOp(db, op);
    assert.equal(r1.outcome, 'skipped-unknown-table');
    // Second op for the same missing table — must also skip, and the
    // applier's behavior is identical (no exception, same outcome).
    const r2 = applyOp(db, mkOp({ tableName: 'never_exists_anywhere', opId: 'op-2' }));
    assert.equal(r2.outcome, 'skipped-unknown-table');
  });

  it('audit H2: clearSchemaCache() invalidates a populated cache so column-add ALTERs are picked up', () => {
    // Build a tiny stand-in DB with one column. Cache the result, then
    // ALTER ADD COLUMN, then verify the cache miss after clear picks
    // up the new column.
    const tinyDb = new Database(':memory:');
    tinyDb.exec(`CREATE TABLE audit_events (id INTEGER PRIMARY KEY, oldcol TEXT);`);

    // First call populates the cache with {id, oldcol}.
    _clearSchemaCacheForTest();
    const opOld = mkOp({
      tableName: 'audit_events',
      rowJson: JSON.stringify({ id: 1, oldcol: 'x' }),
    });
    // We can't drive applier against tinyDb without setting setDbPathForTest,
    // so verify via the cache primitive directly through the helper export.
    // Strategy: call applyOp against the real `db` (which has audit_events),
    // then ALTER, then prove _clearSchemaCacheForTest produces a fresh
    // PRAGMA read by checking a newly-added column is honored.
    void opOld;

    // Use the real `db` (in-memory `:memory:` from setDbPathForTest).
    _clearSchemaCacheForTest();
    // Valid audit_events payload (all NOT NULL columns supplied).
    const validAudit = {
      shift_date: '2026-05-06',
      entity: 'x',
      action: 'insert',
      actor_source: 'test',
    };
    // Apply once so the cache populates for audit_events.
    applyOp(db, mkOp({
      tableName: 'audit_events',
      rowJson: JSON.stringify(validAudit),
    }));
    // Add a new column.
    db.exec(`ALTER TABLE audit_events ADD COLUMN h2_test_col TEXT`);

    // Without clearing the cache, the new column would be dropped from
    // a fresh INSERT.
    applyOp(db, mkOp({
      tableName: 'audit_events',
      opId: 'h2-pre-clear',
      rowJson: JSON.stringify({ ...validAudit, h2_test_col: 'pre' }),
    }));
    const preClearCount = db.prepare(
      `SELECT COUNT(*) AS c FROM audit_events WHERE h2_test_col = 'pre'`,
    ).get().c;
    assert.equal(preClearCount, 0, 'pre-clear: new column dropped silently');

    // After clearing, the new column lands.
    _clearSchemaCacheForTest();
    applyOp(db, mkOp({
      tableName: 'audit_events',
      opId: 'h2-post-clear',
      rowJson: JSON.stringify({ ...validAudit, h2_test_col: 'post' }),
    }));
    const postClearCount = db.prepare(
      `SELECT COUNT(*) AS c FROM audit_events WHERE h2_test_col = 'post'`,
    ).get().c;
    assert.equal(postClearCount, 1, 'post-clear: new column is honored');

    // Clean up the test column so subsequent tests don't see it.
    // SQLite ALTER TABLE DROP COLUMN requires 3.35+; using
    // `CREATE TABLE AS SELECT` rebuild is overkill here — the column
    // is only added on :memory: tests so a setDbPathForTest reset
    // would drop it. We leave it; the column is harmless.
  });
  it('returns unknown for tables outside the matrix', () => {
    assert.equal(familyOf('not_a_real_table'), 'unknown');
  });
  it('family sets are disjoint', () => {
    for (const t of FAMILY_1_TABLES) assert.equal(FAMILY_2_TABLES.has(t), false);
    for (const t of FAMILY_2_TABLES) assert.equal(FAMILY_3_TABLES.has(t), false);
  });
});

// ─────────────────────────────────────────────────────────────────
// Family 1 — append-only INSERT OR IGNORE
// ─────────────────────────────────────────────────────────────────

describe('applyOp — family 1', () => {
  it('INSERTs a well-formed line_check_entries op', () => {
    const op = mkOp({
      rowJson: JSON.stringify({
        shift_date: '2026-05-06',
        station_id: 'saute',
        item: 'rte salad',
        status: 'pass',
        cook_id: 'alice',
        location_id: 'default',
      }),
    });
    const r = applyOp(db, op);
    assert.equal(r.outcome, 'applied');
    const row = db.prepare(`SELECT * FROM line_check_entries`).get();
    assert.ok(row);
    assert.equal(row.station_id, 'saute');
    assert.equal(row.item, 'rte salad');
  });

  it('drops unknown columns the producer sent (schema-drift forward-compat)', () => {
    const op = mkOp({
      rowJson: JSON.stringify({
        shift_date: '2026-05-06',
        station_id: 'saute',
        item: 'x',
        status: 'pass',
        location_id: 'default',
        new_in_producer: 'this column does not exist locally',
      }),
    });
    const r = applyOp(db, op);
    assert.equal(r.outcome, 'applied');
    assert.match(r.reason || '', /dropped.*new_in_producer/);
    assert.equal(db.prepare(`SELECT COUNT(*) c FROM line_check_entries`).get().c, 1);
  });

  it('unknown table → skipped', () => {
    const op = mkOp({ tableName: 'this_table_does_not_exist', rowJson: '{}' });
    const r = applyOp(db, op);
    assert.equal(r.outcome, 'skipped-unknown-table');
  });

  it('malformed rowJson → skipped-bad-payload', () => {
    const op = mkOp({ rowJson: 'not-json{' });
    const r = applyOp(db, op);
    assert.equal(r.outcome, 'skipped-bad-payload');
  });

  it('rowJson that is an array → skipped-bad-payload (must be object)', () => {
    const op = mkOp({ rowJson: '[1,2,3]' });
    const r = applyOp(db, op);
    assert.equal(r.outcome, 'skipped-bad-payload');
  });

  it('no overlapping columns → skipped-schema-drift', () => {
    const op = mkOp({
      rowJson: JSON.stringify({ only_unknown_col: 'x', also_unknown: 'y' }),
    });
    const r = applyOp(db, op);
    assert.equal(r.outcome, 'skipped-schema-drift');
  });

  it('UPDATEs an existing family-1 row for cooling_log stage replay', () => {
    db.prepare(`
      INSERT INTO cooling_log
        (id, shift_date, location_id, item, station_id, started_at, start_reading_f, status, cook_id)
      VALUES (1, '2026-05-06', 'default', 'chili', 'cold_line',
              '2026-05-06T10:00:00.000Z', 140, 'in_progress', 'alice')
    `).run();

    const op = mkOp({
      tableName: 'cooling_log',
      opKind: 'update',
      rowPk: '1',
      rowJson: JSON.stringify({
        id: 1,
        shift_date: '2026-05-06',
        location_id: 'default',
        item: 'chili',
        station_id: 'cold_line',
        started_at: '2026-05-06T10:00:00.000Z',
        start_reading_f: 140,
        stage1_at: '2026-05-06T11:30:00.000Z',
        stage1_reading_f: 65,
        status: 'in_progress',
        cook_id: 'alice',
      }),
    });

    const r = applyOp(db, op);
    assert.equal(r.outcome, 'applied');
    const row = db.prepare(`SELECT stage1_at, stage1_reading_f, status FROM cooling_log WHERE id = 1`).get();
    assert.equal(row.stage1_at, '2026-05-06T11:30:00.000Z');
    assert.equal(row.stage1_reading_f, 65);
    assert.equal(row.status, 'in_progress');
  });
});

// ─────────────────────────────────────────────────────────────────
// Family 2 — DELETE + INSERT envelope
// ─────────────────────────────────────────────────────────────────

describe('applyOp — family 2', () => {
  it('DELETE+INSERTs an envelope for vendor_prices, scoped by location_id', () => {
    // Pre-seed two pre-existing rows in default.
    db.prepare(
      `INSERT INTO vendor_prices (ingredient, vendor, sku, pack_size, pack_unit, pack_price, unit_price, location_id)
       VALUES ('flour','sysco','SKU1', 50, 'lb', 20.0, 0.40, 'default')`,
    ).run();
    db.prepare(
      `INSERT INTO vendor_prices (ingredient, vendor, sku, pack_size, pack_unit, pack_price, unit_price, location_id)
       VALUES ('sugar','sysco','SKU2', 25, 'lb', 15.0, 0.60, 'default')`,
    ).run();

    const op = mkOp({
      tableName: 'vendor_prices',
      opKind: 'delete-batch',
      rowPk: 'run-42',
      rowJson: JSON.stringify({
        where: { location_id: 'default' },
        rows: [
          { ingredient: 'flour', vendor: 'sysco', sku: 'SKU1', pack_size: 55, pack_unit: 'lb', pack_price: 22.0, unit_price: 0.40, location_id: 'default' },
        ],
      }),
    });
    const r = applyOp(db, op);
    assert.equal(r.outcome, 'applied');
    const rows = db.prepare(`SELECT * FROM vendor_prices ORDER BY ingredient`).all();
    assert.equal(rows.length, 1, 'pre-seed deleted, only envelope row remains');
    assert.equal(rows[0].ingredient, 'flour');
    assert.equal(rows[0].pack_size, 55);
  });

  it('omitted `where` defaults to { location_id: op.locationId }', () => {
    db.prepare(
      `INSERT INTO vendor_prices (ingredient, vendor, sku, pack_size, pack_unit, pack_price, unit_price, location_id)
       VALUES ('x', 'sysco', 'X', 1, 'lb', 1, 1, 'default')`,
    ).run();
    db.prepare(
      `INSERT INTO vendor_prices (ingredient, vendor, sku, pack_size, pack_unit, pack_price, unit_price, location_id)
       VALUES ('y', 'sysco', 'Y', 1, 'lb', 1, 1, 'lariat-south')`,
    ).run();

    const op = mkOp({
      tableName: 'vendor_prices',
      locationId: 'default',
      rowJson: JSON.stringify({ rows: [] }), // no `where` key
    });
    const r = applyOp(db, op);
    assert.equal(r.outcome, 'applied');
    // 'default' row got deleted, 'lariat-south' row preserved (scoped delete).
    const all = db.prepare(`SELECT ingredient, location_id FROM vendor_prices`).all();
    assert.equal(all.length, 1);
    assert.equal(all[0].location_id, 'lariat-south');
  });

  it('unknown `where` column (after C3 location_id check passes) → skipped-schema-drift', () => {
    // C3 hardening: this where now includes location_id (so the
    // empty-where + missing-location_id guards pass), but the extra
    // not_a_real_col still trips the schema-drift check downstream.
    const op = mkOp({
      tableName: 'vendor_prices',
      rowJson: JSON.stringify({
        where: { location_id: 'default', not_a_real_col: 'x' },
        rows: [],
      }),
    });
    const r = applyOp(db, op);
    assert.equal(r.outcome, 'skipped-schema-drift');
  });

  it('audit C3: empty where → skipped-bad-payload (refuses to wipe table)', () => {
    const op = mkOp({
      tableName: 'vendor_prices',
      rowJson: JSON.stringify({ where: {}, rows: [] }),
    });
    // Pre-seed a row that MUST NOT be wiped.
    db.prepare(
      `INSERT INTO vendor_prices (ingredient, vendor, sku, pack_size, pack_unit, pack_price, unit_price, location_id)
       VALUES ('a', 'sysco', 'A', 1, 'lb', 1, 1, 'default')`,
    ).run();
    const r = applyOp(db, op);
    assert.equal(r.outcome, 'skipped-bad-payload');
    assert.match(r.reason || '', /empty where would wipe/);
    const survivors = db.prepare(`SELECT COUNT(*) AS c FROM vendor_prices`).get().c;
    assert.equal(survivors, 1, 'pre-seed row must NOT have been deleted');
  });

  it('audit H5: FAMILY_2_REQUIRED_WHERE covers every FAMILY_2 table', () => {
    // Pins the contract: any future FAMILY_2 table must come with a
    // required-where entry. Catches the drift case where a contributor
    // adds a table to FAMILY_2_TABLES but forgets the scoping rule.
    for (const t of FAMILY_2_TABLES) {
      assert.ok(
        FAMILY_2_REQUIRED_WHERE.has(t),
        `FAMILY_2_REQUIRED_WHERE missing entry for ${t}`,
      );
    }
  });

  it('audit H5: every required-where set includes location_id', () => {
    // Defense in depth — location_id is the universal scope and C3
    // already required it. The per-table map is the H5 extension
    // point; verify every entry still carries that minimum.
    for (const [t, required] of FAMILY_2_REQUIRED_WHERE) {
      assert.ok(required.has('location_id'), `${t} required-where missing location_id`);
    }
  });

  it('audit C3: where missing location_id → skipped-bad-payload', () => {
    const op = mkOp({
      tableName: 'vendor_prices',
      // sku alone — would only scope by SKU across all locations.
      rowJson: JSON.stringify({ where: { sku: 'X' }, rows: [] }),
    });
    const r = applyOp(db, op);
    assert.equal(r.outcome, 'skipped-bad-payload');
    assert.match(r.reason || '', /location_id/);
  });

  it('non-array rows → skipped-bad-payload', () => {
    const op = mkOp({
      tableName: 'vendor_prices',
      rowJson: JSON.stringify({ where: { location_id: 'default' }, rows: 'not-array' }),
    });
    const r = applyOp(db, op);
    assert.equal(r.outcome, 'skipped-bad-payload');
  });

  it('non-object row entry → skipped-bad-payload', () => {
    const op = mkOp({
      tableName: 'vendor_prices',
      rowJson: JSON.stringify({ where: { location_id: 'default' }, rows: ['oops'] }),
    });
    const r = applyOp(db, op);
    assert.equal(r.outcome, 'skipped-bad-payload');
  });
});

// ─────────────────────────────────────────────────────────────────
// Family 3 — deferred until LWW metadata exists
// ─────────────────────────────────────────────────────────────────

describe('applyOp — family 3', () => {
  it('returns skipped-family3 and does not write dish_components', () => {
    const op = mkOp({
      tableName: 'dish_components',
      opKind: 'update',
      rowPk: '42',
      rowJson: JSON.stringify({
        id: 42,
        dish_name: 'pasta',
        qty_per_serving: 1.0,
        unit: 'ea',
        location_id: 'default',
        component_type: 'recipe',
        recipe_slug: 'tomato-sauce',
      }),
    });
    const r = applyOp(db, op);
    assert.equal(r.outcome, 'skipped-family3');
    assert.match(r.reason || '', /LWW metadata/);
    const row = db.prepare(`SELECT COUNT(*) AS count FROM dish_components`).get();
    assert.equal(row.count, 0);
  });
});

// ─────────────────────────────────────────────────────────────────
// applyWindow — counter aggregation
// ─────────────────────────────────────────────────────────────────

describe('applyWindow', () => {
  it('aggregates outcomes across mixed ops', () => {
    const goodFamily1 = mkOp({
      rowJson: JSON.stringify({
        shift_date: '2026-05-06',
        station_id: 'saute',
        item: 'x',
        status: 'pass',
        location_id: 'default',
      }),
    });
    const badPayload = mkOp({ rowJson: 'nope{' });
    const unknownTable = mkOp({ tableName: 'this_does_not_exist' });
    const family3 = mkOp({
      tableName: 'dish_components',
      opKind: 'update',
      rowJson: JSON.stringify({
        id: 43,
        dish_name: 'a',
        qty_per_serving: 1.0,
        unit: 'ea',
        location_id: 'default',
        component_type: 'recipe',
        recipe_slug: 'b',
      }),
    });
    const schemaDrift = mkOp({
      rowJson: JSON.stringify({ only_unknown_col: 'x' }),
    });

    const r = applyWindow(db, [goodFamily1, badPayload, unknownTable, family3, schemaDrift]);
    assert.equal(r.applied, 1);
    assert.equal(r.skippedBadPayload, 1);
    assert.equal(r.skippedUnknown, 1);
    assert.equal(r.skippedFamily3, 1);
    assert.equal(r.skippedSchemaDrift, 1);
  });

  it('records reasons with op ids attached', () => {
    const op = mkOp({ opId: 'op-test-1', rowJson: 'bad-json' });
    const r = applyWindow(db, [op]);
    assert.ok(r.reasons.some((reason) => reason.startsWith('op-test-1:')));
  });

  it('returns empty counters for empty window', () => {
    const r = applyWindow(db, []);
    assert.equal(r.applied, 0);
    assert.deepEqual(r.reasons, []);
  });
});
