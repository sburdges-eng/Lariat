#!/usr/bin/env node
// Tests for app/api/costing/pack-changes/route.js — GET (list) +
// POST (acknowledge). Companion of test-pack-changes-repo.mjs.
//
// Run: node --experimental-strip-types --test tests/js/test-pack-changes-route.mjs

import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

register(new URL('./resolver.mjs', import.meta.url));

// IMPORTANT: lib/auditLog.mjs captures process.cwd() at module-load
// time into AUDIT_LOG_DIR. We must chdir to a temp dir BEFORE importing
// the route (which transitively imports auditLog.mjs) so the JSONL file
// lands in our throwaway sandbox instead of polluting data/audit/.
const prevCwd = process.cwd();
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-pc-route-'));
process.chdir(tmpRoot);

const { getDb, setDbPathForTest } = await import('../../lib/db.ts');
const route = await import('../../app/api/costing/pack-changes/route.js');
const { GET, POST } = route;

setDbPathForTest(':memory:');
const db = getDb();
after(() => {
  setDbPathForTest(null);
  process.chdir(prevCwd);
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

const auditFile = path.join(tmpRoot, 'data', 'audit', 'management-actions.jsonl');

beforeEach(() => {
  db.exec(`
    DELETE FROM pack_size_changes;
    DELETE FROM vendor_prices;
  `);
  fs.rmSync(path.join(tmpRoot, 'data'), { recursive: true, force: true });
});

function seedChange({ id = null, vendor = 'sysco', sku, acknowledged = 0 } = {}) {
  const info = db.prepare(
    `INSERT INTO pack_size_changes
       (id, vendor, sku, prev_pack, new_pack, prev_price, new_price, acknowledged)
     VALUES (?, ?, ?, '6×#10', '4×#10', 42.0, 36.0, ?)`,
  ).run(id, vendor, sku, acknowledged);
  return Number(info.lastInsertRowid);
}

function getReq(qs = '') {
  return new Request(`http://localhost/api/costing/pack-changes${qs}`);
}

function postReq(body) {
  return new Request('http://localhost/api/costing/pack-changes', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('GET /api/costing/pack-changes', () => {
  it('returns empty queue when no changes', async () => {
    const res = await GET(getReq());
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.total, 0);
    assert.equal(body.unacknowledged, 0);
    assert.deepEqual(body.changes, []);
  });

  it('lists open changes by default', async () => {
    seedChange({ sku: 'OPEN-1' });
    seedChange({ sku: 'CLOSED-1', acknowledged: 1 });
    const res = await GET(getReq());
    const body = await res.json();
    assert.equal(body.total, 1);
    assert.equal(body.unacknowledged, 1);
    assert.equal(body.changes[0].sku, 'OPEN-1');
  });

  it('filter=all returns both', async () => {
    seedChange({ sku: 'OPEN-1' });
    seedChange({ sku: 'CLOSED-1', acknowledged: 1 });
    const res = await GET(getReq('?filter=all'));
    const body = await res.json();
    assert.equal(body.total, 2);
    assert.equal(body.unacknowledged, 1);
  });

  it('rejects unknown filter by falling back to open', async () => {
    seedChange({ sku: 'OPEN-1' });
    seedChange({ sku: 'CLOSED-1', acknowledged: 1 });
    const res = await GET(getReq('?filter=garbage'));
    const body = await res.json();
    assert.equal(body.filter, 'open');
    assert.equal(body.total, 1);
  });

  it('respects vendor filter', async () => {
    seedChange({ vendor: 'sysco', sku: 'A' });
    seedChange({ vendor: 'shamrock', sku: 'B' });
    const res = await GET(getReq('?vendor=shamrock'));
    const body = await res.json();
    assert.equal(body.total, 1);
    assert.equal(body.changes[0].vendor, 'shamrock');
  });
});

describe('POST /api/costing/pack-changes (acknowledge)', () => {
  it('returns 400 when body is not JSON', async () => {
    const req = new Request('http://localhost/api/costing/pack-changes', {
      method: 'POST',
      body: 'not-json',
      headers: { 'content-type': 'application/json' },
    });
    const res = await POST(req);
    assert.equal(res.status, 400);
  });

  it('returns 400 when id is missing or not a positive integer', async () => {
    const r1 = await POST(postReq({}));
    assert.equal(r1.status, 400);
    const r2 = await POST(postReq({ id: 0 }));
    assert.equal(r2.status, 400);
    const r3 = await POST(postReq({ id: -5 }));
    assert.equal(r3.status, 400);
    const r4 = await POST(postReq({ id: 'foo' }));
    assert.equal(r4.status, 400);
  });

  it('returns 404 when id does not exist', async () => {
    const res = await POST(postReq({ id: 999 }));
    assert.equal(res.status, 404);
  });

  it('flips an open row to acknowledged and records the management audit', async () => {
    const id = seedChange({ sku: 'A' });
    const res = await POST(postReq({ id, note: 'Confirmed pack swap with Sysco rep' }));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.id, id);
    assert.equal(body.acknowledged, 1);
    assert.equal(body.was_already_acknowledged, false);

    const persisted = db.prepare(
      'SELECT acknowledged FROM pack_size_changes WHERE id = ?',
    ).get(id);
    assert.equal(persisted.acknowledged, 1);

    assert.ok(fs.existsSync(auditFile), 'audit file should exist');
    const lines = fs.readFileSync(auditFile, 'utf-8').trim().split('\n');
    assert.equal(lines.length, 1);
    const entry = JSON.parse(lines[0]);
    assert.equal(entry.action, 'pack_size_change_acknowledged');
    assert.equal(entry.pack_size_changes_id, id);
    assert.equal(entry.note, 'Confirmed pack swap with Sysco rep');
  });

  it('does not acknowledge the row when management audit logging fails', async () => {
    const id = seedChange({ sku: 'A' });
    fs.writeFileSync(path.join(tmpRoot, 'data'), 'not a directory');

    const originalError = console.error;
    console.error = () => {};
    let res;
    try {
      res = await POST(postReq({ id, note: 'audit path blocked' }));
    } finally {
      console.error = originalError;
    }
    assert.equal(res.status, 500);

    const persisted = db.prepare(
      'SELECT acknowledged FROM pack_size_changes WHERE id = ?',
    ).get(id);
    assert.equal(persisted.acknowledged, 0);
    assert.equal(fs.existsSync(auditFile), false);
  });

  it('idempotent — second acknowledge does not double-audit', async () => {
    const id = seedChange({ sku: 'A' });
    await POST(postReq({ id }));
    const res2 = await POST(postReq({ id }));
    assert.equal(res2.status, 200);
    const body = await res2.json();
    assert.equal(body.was_already_acknowledged, true);

    const lines = fs.readFileSync(auditFile, 'utf-8').trim().split('\n');
    assert.equal(lines.length, 1, 'idempotent ack should not duplicate audit row');
  });
});
