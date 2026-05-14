#!/usr/bin/env node
// Tests for lib/syncApply.ts — the receiving-side applier (T7c).
//
// Covers:
//   - family classifier (family1 / family2 / family3 / unknown)
//   - family 1: INSERT OR IGNORE, schema-drift column drop, idempotency,
//     unknown-table skip, bad-payload skip
//   - family 2: DELETE+INSERT envelope, where defaults to location_id,
//     unknown-where-col schema-drift skip, bad rowJson skip
//   - family 3: skipped with audit-log entry
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
    DELETE FROM line_check_entries;
    DELETE FROM vendor_prices;
    DELETE FROM audit_events;
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
// Family 3 — deferred to v2
// ─────────────────────────────────────────────────────────────────

describe('applyOp — family 3', () => {
  it('returns skipped-family3', () => {
    const op = mkOp({
      tableName: 'dish_components',
      opKind: 'update',
      rowPk: 'pasta:tomato',
      rowJson: JSON.stringify({ dish_name: 'pasta', ingredient: 'tomato' }),
    });
    const r = applyOp(db, op);
    assert.equal(r.outcome, 'skipped-family3');
    assert.match(r.reason || '', /family 3 deferred/);
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
      rowJson: JSON.stringify({ dish_name: 'a', ingredient: 'b' }),
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
