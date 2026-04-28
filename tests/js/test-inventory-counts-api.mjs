#!/usr/bin/env node
// Integration tests for /api/inventory/counts and /api/inventory/counts/[id]/lines.
//
// Covers:
//   - Open a count (POST /api/inventory/counts) — header row + audit event
//   - Add and update a line (POST .../counts/:id/lines) — UNIQUE upsert path
//   - Reject lines on a closed count (PATCH close → 409 on subsequent line POST)
//   - PATCH close + reopen flow
//   - Location scoping: a count opened at 'kitchen-a' is hidden from 'kitchen-b'
//
// Run: node --test tests/js/test-inventory-counts-api.mjs

import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

register(new URL('./resolver.mjs', import.meta.url));

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-inv-counts-api-'));
const TMP_DB = path.join(TMP_DIR, 'lariat-test.db');

const db = await import('../../lib/db.ts');
const countsRoute = await import('../../app/api/inventory/counts/route.js');
const countByIdRoute = await import('../../app/api/inventory/counts/[id]/route.js');
const linesRoute = await import('../../app/api/inventory/counts/[id]/lines/route.js');

db.setDbPathForTest(TMP_DB);
const testDb = db.getDb();

after(() => {
  db.setDbPathForTest(null);
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

beforeEach(() => {
  testDb.exec(
    'DELETE FROM inventory_count_lines; DELETE FROM inventory_counts;',
  );
});

function createLegacyNullableSkuCountLinesTable(dbConn) {
  dbConn.exec(`
    DROP TABLE IF EXISTS inventory_count_lines;
    CREATE TABLE inventory_count_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      count_id INTEGER NOT NULL REFERENCES inventory_counts(id) ON DELETE CASCADE,
      vendor TEXT,
      ingredient TEXT NOT NULL,
      sku TEXT,
      on_hand_qty REAL,
      unit TEXT,
      par_qty REAL,
      par_unit TEXT,
      note TEXT,
      counted_by TEXT,
      counted_at TEXT DEFAULT (datetime('now')),
      location_id TEXT NOT NULL DEFAULT 'default',
      UNIQUE(count_id, ingredient, sku)
    );
  `);
}

function postCounts(body) {
  return countsRoute.POST(new Request('http://localhost/api/inventory/counts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }));
}

function getCounts(qs = '') {
  return countsRoute.GET(new Request(`http://localhost/api/inventory/counts${qs}`));
}

function postLine(countId, body) {
  return linesRoute.POST(
    new Request(`http://localhost/api/inventory/counts/${countId}/lines`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: { id: String(countId) } },
  );
}

function patchCount(countId, body) {
  return countByIdRoute.PATCH(
    new Request(`http://localhost/api/inventory/counts/${countId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: { id: String(countId) } },
  );
}

function getCount(countId) {
  return countByIdRoute.GET(
    new Request(`http://localhost/api/inventory/counts/${countId}`),
    { params: { id: String(countId) } },
  );
}

describe('POST /api/inventory/counts', () => {
  it('opens a count and persists header row', async () => {
    const res = await postCounts({ label: 'Weekly walk-in', cook_id: 'alice' });
    assert.strictEqual(res.status, 200);
    const json = await res.json();
    assert.strictEqual(json.ok, true);
    assert.ok(json.id > 0);

    const row = testDb.prepare('SELECT * FROM inventory_counts WHERE id = ?').get(json.id);
    assert.ok(row);
    assert.strictEqual(row.label, 'Weekly walk-in');
    assert.strictEqual(row.cook_id, 'alice');
    assert.strictEqual(row.closed_at, null);
    assert.strictEqual(row.location_id, 'default');
  });

  it('writes an audit event for the open action', async () => {
    const res = await postCounts({ label: 'EOM' });
    const { id } = await res.json();
    const audit = testDb
      .prepare(
        `SELECT * FROM audit_events
          WHERE entity = 'inventory_counts' AND entity_id = ? AND action = 'insert'`,
      )
      .get(id);
    assert.ok(audit, 'expected an audit row for the count open');
  });
});

describe('POST /api/inventory/counts/:id/lines', () => {
  it('inserts a line and upserts on second post for same ingredient/sku', async () => {
    const open = await postCounts({ label: 'walk-in' });
    const { id: countId } = await open.json();

    const r1 = await postLine(countId, {
      ingredient: 'TOMATO, ROMA',
      sku: 'TOM01',
      on_hand_qty: 12,
      unit: 'lb',
    });
    assert.strictEqual(r1.status, 200);
    const j1 = await r1.json();
    assert.ok(j1.id > 0);

    const r2 = await postLine(countId, {
      ingredient: 'TOMATO, ROMA',
      sku: 'TOM01',
      on_hand_qty: 18,
      unit: 'lb',
    });
    assert.strictEqual(r2.status, 200);
    const j2 = await r2.json();
    // UNIQUE(count_id, ingredient, sku) → ON CONFLICT updates the same row.
    assert.strictEqual(j2.id, j1.id);

    const lines = testDb
      .prepare('SELECT * FROM inventory_count_lines WHERE count_id = ?')
      .all(countId);
    assert.strictEqual(lines.length, 1);
    assert.strictEqual(lines[0].on_hand_qty, 18);
    assert.strictEqual(lines[0].unit, 'lb');
  });

  it('upserts no-SKU produce lines by using the empty string as the SKU key', async () => {
    const open = await postCounts({ label: 'produce count' });
    const { id: countId } = await open.json();

    const r1 = await postLine(countId, {
      ingredient: 'ROMA TOMATO',
      on_hand_qty: 12,
      unit: 'lb',
    });
    assert.strictEqual(r1.status, 200);
    const j1 = await r1.json();

    const r2 = await postLine(countId, {
      ingredient: 'ROMA TOMATO',
      sku: '   ',
      on_hand_qty: 18,
      unit: 'lb',
    });
    assert.strictEqual(r2.status, 200);
    const j2 = await r2.json();
    assert.strictEqual(j2.id, j1.id);

    const lines = testDb
      .prepare('SELECT sku, on_hand_qty FROM inventory_count_lines WHERE count_id = ?')
      .all(countId);
    assert.strictEqual(lines.length, 1);
    assert.strictEqual(lines[0].sku, '');
    assert.strictEqual(lines[0].on_hand_qty, 18);
  });

  it('400 when ingredient is missing', async () => {
    const open = await postCounts({});
    const { id: countId } = await open.json();
    const r = await postLine(countId, { on_hand_qty: 4 });
    assert.strictEqual(r.status, 400);
  });

  it('404 when count does not exist', async () => {
    const r = await postLine(99999, { ingredient: 'X' });
    assert.strictEqual(r.status, 404);
  });

  it('409 when the count is already closed', async () => {
    const open = await postCounts({});
    const { id: countId } = await open.json();
    await postLine(countId, { ingredient: 'X', on_hand_qty: 1 });
    const close = await patchCount(countId, { close: true });
    assert.strictEqual(close.status, 200);
    const r = await postLine(countId, { ingredient: 'Y', on_hand_qty: 1 });
    assert.strictEqual(r.status, 409);
  });
});

describe('PATCH /api/inventory/counts/:id', () => {
  it('close then reopen toggles closed_at and writes audit events', async () => {
    const open = await postCounts({ label: 'r' });
    const { id } = await open.json();

    const closeRes = await patchCount(id, { close: true, cook_id: 'bo' });
    assert.strictEqual(closeRes.status, 200);
    const afterClose = testDb.prepare('SELECT closed_at FROM inventory_counts WHERE id=?').get(id);
    assert.ok(afterClose.closed_at, 'closed_at should be set');

    // Closing again should 409.
    const second = await patchCount(id, { close: true });
    assert.strictEqual(second.status, 409);

    const reopen = await patchCount(id, { reopen: true });
    assert.strictEqual(reopen.status, 200);
    const afterReopen = testDb.prepare('SELECT closed_at FROM inventory_counts WHERE id=?').get(id);
    assert.strictEqual(afterReopen.closed_at, null);

    const auditCount = testDb
      .prepare(
        `SELECT COUNT(*) AS c FROM audit_events
          WHERE entity = 'inventory_counts' AND entity_id = ?`,
      )
      .get(id).c;
    // 1 insert + 1 close + 1 reopen.
    assert.strictEqual(auditCount, 3);
  });
});

describe('GET /api/inventory/counts — location scoping', () => {
  it('returns only rows for the requesting location', async () => {
    await postCounts({ label: 'A', location_id: 'kitchen-a' });
    await postCounts({ label: 'B', location_id: 'kitchen-b' });

    const aRes = await getCounts('?location=kitchen-a');
    const aJson = await aRes.json();
    assert.strictEqual(aJson.rows.length, 1);
    assert.strictEqual(aJson.rows[0].label, 'A');

    const bRes = await getCounts('?location=kitchen-b');
    const bJson = await bRes.json();
    assert.strictEqual(bJson.rows.length, 1);
    assert.strictEqual(bJson.rows[0].label, 'B');
  });
});

describe('GET /api/inventory/counts/:id', () => {
  it('returns the count + its lines, ordered by ingredient', async () => {
    const open = await postCounts({ label: 'detail' });
    const { id } = await open.json();
    await postLine(id, { ingredient: 'ZUCCHINI', on_hand_qty: 4 });
    await postLine(id, { ingredient: 'AVOCADO', on_hand_qty: 6 });

    const r = await getCount(id);
    assert.strictEqual(r.status, 200);
    const j = await r.json();
    assert.strictEqual(j.count.id, id);
    assert.strictEqual(j.lines.length, 2);
    assert.strictEqual(j.lines[0].ingredient, 'AVOCADO');
    assert.strictEqual(j.lines[1].ingredient, 'ZUCCHINI');
  });
});

describe('inventory_count_lines schema migration', () => {
  it('rebuilds nullable sku rows into the non-null upsert key and keeps latest duplicates', async () => {
    const legacyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-inv-counts-legacy-'));
    const legacyDbPath = path.join(legacyDir, 'legacy.db');
    const legacyDb = new Database(legacyDbPath);
    try {
      legacyDb.pragma('foreign_keys = ON');
      legacyDb.exec(`
        CREATE TABLE inventory_counts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          count_date TEXT NOT NULL,
          label TEXT,
          opened_at TEXT DEFAULT (datetime('now')),
          closed_at TEXT,
          cook_id TEXT,
          location_id TEXT NOT NULL DEFAULT 'default'
        );
        CREATE TABLE inventory_count_lines (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          count_id INTEGER NOT NULL REFERENCES inventory_counts(id) ON DELETE CASCADE,
          vendor TEXT,
          ingredient TEXT NOT NULL,
          sku TEXT,
          on_hand_qty REAL,
          unit TEXT,
          par_qty REAL,
          par_unit TEXT,
          note TEXT,
          counted_by TEXT,
          counted_at TEXT DEFAULT (datetime('now')),
          location_id TEXT NOT NULL DEFAULT 'default',
          UNIQUE(count_id, ingredient, sku)
        );
      `);
      legacyDb.prepare(
        `INSERT INTO inventory_counts (id, count_date, location_id) VALUES (1, '2026-04-28', 'default')`,
      ).run();
      legacyDb.prepare(
        `INSERT INTO inventory_count_lines
           (id, count_id, ingredient, sku, on_hand_qty, unit, counted_at, location_id)
         VALUES (?, 1, 'ROMA TOMATO', NULL, ?, 'lb', ?, 'default')`,
      ).run(1, 12, '2026-04-28 08:00:00');
      legacyDb.prepare(
        `INSERT INTO inventory_count_lines
           (id, count_id, ingredient, sku, on_hand_qty, unit, counted_at, location_id)
         VALUES (?, 1, 'ROMA TOMATO', NULL, ?, 'lb', ?, 'default')`,
      ).run(2, 18, '2026-04-28 09:00:00');

      db.initSchema(legacyDb);
      const skuInfo = legacyDb
        .prepare(`PRAGMA table_info(inventory_count_lines)`)
        .all()
        .find((c) => c.name === 'sku');
      assert.strictEqual(skuInfo.notnull, 1);
      const rows = legacyDb
        .prepare(`SELECT id, sku, on_hand_qty FROM inventory_count_lines ORDER BY id`)
        .all();
      assert.deepStrictEqual(rows, [{ id: 2, sku: '', on_hand_qty: 18 }]);
    } finally {
      legacyDb.close();
      try { fs.rmSync(legacyDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });
});
