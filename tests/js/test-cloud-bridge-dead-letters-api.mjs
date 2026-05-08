#!/usr/bin/env node
// Integration tests for the cloud-bridge dead-letter triage API:
//   - GET  /api/cloud-bridge/dead-letters
//   - POST /api/cloud-bridge/dead-letters/[id]/requeue
//   - POST /api/cloud-bridge/dead-letters/[id]/drop
//
// Pattern mirrors test-cloud-bridge-stub.mjs (sibling status route):
// import handlers, build a Request, call directly. PIN gate keys off
// LARIAT_PIN; we toggle it per-block to exercise both paths.
//
// Audit-emission check: lib/auditLog.mjs writes JSONL to
// `${process.cwd()}/data/audit/management-actions.jsonl`. We honor the
// LARIAT_AUDIT_PATH env override so the file lands inside our tmp dir
// without process.chdir().
//
// Run: node --experimental-strip-types --test tests/js/test-cloud-bridge-dead-letters-api.mjs

import { describe, it, after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

register(new URL('./resolver.mjs', import.meta.url));

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-cb-dlq-api-'));
const TMP_DB = path.join(TMP_DIR, 'lariat-test.db');
const TMP_AUDIT = path.join(TMP_DIR, 'management-actions.jsonl');

// Force the unconfigured bridge path so the route's `configured` flag is
// deterministic regardless of host env.
const SAVED_BRIDGE_SECRET = process.env.LARIAT_CLOUD_BRIDGE_SECRET;
const SAVED_BRIDGE_URL = process.env.LARIAT_CLOUD_BRIDGE_URL;
delete process.env.LARIAT_CLOUD_BRIDGE_SECRET;
delete process.env.LARIAT_CLOUD_BRIDGE_URL;

const SAVED_AUDIT_PATH = process.env.LARIAT_AUDIT_PATH;
process.env.LARIAT_AUDIT_PATH = TMP_AUDIT;

const db = await import('../../lib/db.ts');
db.setDbPathForTest(TMP_DB);
const testDb = db.getDb();

const queue = await import('../../lib/cloudBridgeQueue.ts');
const { enqueue, claim, nack } = queue;

const listRoute = await import('../../app/api/cloud-bridge/dead-letters/route.js');
const requeueRoute = await import('../../app/api/cloud-bridge/dead-letters/[id]/requeue/route.js');
const dropRoute = await import('../../app/api/cloud-bridge/dead-letters/[id]/drop/route.js');

const { GET: listGET } = listRoute;
const { POST: requeuePOST } = requeueRoute;
const { POST: dropPOST } = dropRoute;

after(() => {
  db.setDbPathForTest(null);
  if (SAVED_BRIDGE_SECRET !== undefined) process.env.LARIAT_CLOUD_BRIDGE_SECRET = SAVED_BRIDGE_SECRET;
  if (SAVED_BRIDGE_URL !== undefined) process.env.LARIAT_CLOUD_BRIDGE_URL = SAVED_BRIDGE_URL;
  if (SAVED_AUDIT_PATH === undefined) delete process.env.LARIAT_AUDIT_PATH;
  else process.env.LARIAT_AUDIT_PATH = SAVED_AUDIT_PATH;
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

beforeEach(() => {
  testDb.exec(`DELETE FROM cloud_bridge_outbox`);
  if (fs.existsSync(TMP_AUDIT)) fs.unlinkSync(TMP_AUDIT);
});

const TABLE = 'settlement_summaries';

function deadLetterBatch(rows, opts = {}) {
  const id = enqueue(opts.table ?? TABLE, rows, {
    locationId: opts.locationId ?? 'default',
  });
  for (let i = 0; i < 5; i++) {
    const [c] = claim(1);
    nack(c.id, opts.lastError ?? `transient ${i + 1}`);
  }
  return id;
}

function readAuditEntries() {
  if (!fs.existsSync(TMP_AUDIT)) return [];
  return fs
    .readFileSync(TMP_AUDIT, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

// ─────────────────────────────────────────────────────────────────
// PIN gate — toggled on for one block; off for the happy-path blocks.
// ─────────────────────────────────────────────────────────────────

describe('PIN gate (LARIAT_PIN set)', () => {
  let prevPin;
  before(() => {
    prevPin = process.env.LARIAT_PIN;
    process.env.LARIAT_PIN = '0000';
    delete process.env.LARIAT_PIN_SECRET;
  });
  after(() => {
    if (prevPin === undefined) delete process.env.LARIAT_PIN;
    else process.env.LARIAT_PIN = prevPin;
  });

  it('GET /dead-letters → 401 with no cookie', async () => {
    const res = await listGET(
      new Request('http://localhost/api/cloud-bridge/dead-letters'),
    );
    assert.equal(res.status, 401);
  });

  it('POST /dead-letters/[id]/requeue → 401 with no cookie', async () => {
    const res = await requeuePOST(
      new Request('http://localhost/api/cloud-bridge/dead-letters/1/requeue', {
        method: 'POST',
      }),
      { params: { id: '1' } },
    );
    assert.equal(res.status, 401);
  });

  it('POST /dead-letters/[id]/drop → 401 with no cookie', async () => {
    const res = await dropPOST(
      new Request('http://localhost/api/cloud-bridge/dead-letters/1/drop', {
        method: 'POST',
      }),
      { params: { id: '1' } },
    );
    assert.equal(res.status, 401);
  });

  it('GET /dead-letters → 200 with the legacy unsigned cookie when PIN_SECRET is unset', async () => {
    const res = await listGET(
      new Request('http://localhost/api/cloud-bridge/dead-letters', {
        headers: { cookie: 'lariat_pin_ok=1' },
      }),
    );
    assert.equal(res.status, 200);
  });
});

// ─────────────────────────────────────────────────────────────────
// Happy-path blocks — LARIAT_PIN unset so the gate auto-passes.
// ─────────────────────────────────────────────────────────────────

describe('GET /api/cloud-bridge/dead-letters — happy path', () => {
  let prevPin;
  before(() => {
    prevPin = process.env.LARIAT_PIN;
    delete process.env.LARIAT_PIN;
  });
  after(() => {
    if (prevPin !== undefined) process.env.LARIAT_PIN = prevPin;
  });

  it('returns empty list + queue status on a clean queue', async () => {
    const res = await listGET(
      new Request('http://localhost/api/cloud-bridge/dead-letters'),
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.configured, false, 'bridge env vars are unset for these tests');
    assert.equal(body.location, 'default');
    assert.equal(body.queued_depth, 0);
    assert.equal(body.dead_letter_depth_total, 0);
    assert.deepStrictEqual(body.dead_letters, []);
  });

  it('reports queued depth alongside dead-letters', async () => {
    // Dead-letter first, then add a queued row. Reverse order would have
    // claim(1) inside deadLetterBatch repeatedly pick up the FIFO-oldest
    // queued row (i.e. the one we just enqueued), so dlqId wouldn't match
    // what actually ended up dead-lettered.
    const dlqId = deadLetterBatch([{ shift_date: '2026-05-01', total: 1 }]);
    enqueue(TABLE, [{ shift_date: '2026-05-04', total: 9 }], { locationId: 'default' });

    const res = await listGET(
      new Request('http://localhost/api/cloud-bridge/dead-letters'),
    );
    const body = await res.json();
    assert.equal(body.queued_depth, 1);
    assert.equal(body.dead_letter_depth_total, 1);
    assert.equal(body.dead_letters.length, 1);
    assert.equal(body.dead_letters[0].id, dlqId);
    assert.equal(body.dead_letters[0].table, TABLE);
    assert.equal(body.dead_letters[0].locationId, 'default');
    assert.equal(body.dead_letters[0].attempts, 5);
    assert.deepStrictEqual(body.dead_letters[0].rows, [
      { shift_date: '2026-05-01', total: 1 },
    ]);
  });

  it('scopes dead-letters by ?location=', async () => {
    deadLetterBatch([{ shift_date: '2026-05-01', total: 1 }], { locationId: 'site-a' });
    deadLetterBatch([{ shift_date: '2026-05-02', total: 2 }], { locationId: 'site-b' });

    const resA = await listGET(
      new Request('http://localhost/api/cloud-bridge/dead-letters?location=site-a'),
    );
    const bodyA = await resA.json();
    assert.equal(bodyA.location, 'site-a');
    assert.equal(bodyA.dead_letters.length, 1);
    assert.equal(bodyA.dead_letters[0].locationId, 'site-a');

    // Total count crosses sites — that's intentional, the manager sees
    // the global pressure even when the table is scoped to one site.
    assert.equal(bodyA.dead_letter_depth_total, 2);
  });
});

describe('POST /api/cloud-bridge/dead-letters/[id]/requeue — happy path', () => {
  let prevPin;
  before(() => {
    prevPin = process.env.LARIAT_PIN;
    delete process.env.LARIAT_PIN;
  });
  after(() => {
    if (prevPin !== undefined) process.env.LARIAT_PIN = prevPin;
  });

  it('400 on a non-numeric id', async () => {
    const res = await requeuePOST(
      new Request('http://localhost/api/cloud-bridge/dead-letters/abc/requeue', {
        method: 'POST',
      }),
      { params: { id: 'abc' } },
    );
    assert.equal(res.status, 400);
  });

  it('404 when the id is unknown', async () => {
    const res = await requeuePOST(
      new Request('http://localhost/api/cloud-bridge/dead-letters/9999/requeue', {
        method: 'POST',
      }),
      { params: { id: '9999' } },
    );
    assert.equal(res.status, 404);
  });

  it('404 when the id is alive (not dead-lettered)', async () => {
    const id = enqueue(TABLE, [{ shift_date: '2026-05-01', total: 1 }], { locationId: 'default' });
    const res = await requeuePOST(
      new Request(`http://localhost/api/cloud-bridge/dead-letters/${id}/requeue`, {
        method: 'POST',
      }),
      { params: { id: String(id) } },
    );
    assert.equal(res.status, 404);
  });

  it('200 + audit entry on success', async () => {
    const id = deadLetterBatch([{ shift_date: '2026-05-01', total: 1 }]);

    const res = await requeuePOST(
      new Request(`http://localhost/api/cloud-bridge/dead-letters/${id}/requeue`, {
        method: 'POST',
      }),
      { params: { id: String(id) } },
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.batch_id, id);
    assert.equal(body.table, TABLE);
    assert.equal(body.location_id, 'default');

    // Row is back in the active queue.
    const row = testDb
      .prepare('SELECT dead_letter, attempts, last_error FROM cloud_bridge_outbox WHERE id = ?')
      .get(id);
    assert.equal(row.dead_letter, 0);
    assert.equal(row.attempts, 0);
    assert.equal(row.last_error, null);

    // Audit captured the action with prior state.
    const audits = readAuditEntries();
    assert.equal(audits.length, 1);
    assert.equal(audits[0].action, 'cloud_bridge_dead_letter_requeued');
    assert.equal(audits[0].changes.batch_id, id);
    assert.equal(audits[0].changes.table, TABLE);
    assert.equal(audits[0].changes.location_id, 'default');
    assert.equal(audits[0].changes.prior_attempts, 5);
    assert.match(audits[0].changes.prior_error ?? '', /transient 5/);
  });
});

describe('POST /api/cloud-bridge/dead-letters/[id]/drop — happy path', () => {
  let prevPin;
  before(() => {
    prevPin = process.env.LARIAT_PIN;
    delete process.env.LARIAT_PIN;
  });
  after(() => {
    if (prevPin !== undefined) process.env.LARIAT_PIN = prevPin;
  });

  it('400 on a non-numeric id', async () => {
    const res = await dropPOST(
      new Request('http://localhost/api/cloud-bridge/dead-letters/abc/drop', {
        method: 'POST',
      }),
      { params: { id: 'abc' } },
    );
    assert.equal(res.status, 400);
  });

  it('404 when the id is unknown', async () => {
    const res = await dropPOST(
      new Request('http://localhost/api/cloud-bridge/dead-letters/9999/drop', {
        method: 'POST',
      }),
      { params: { id: '9999' } },
    );
    assert.equal(res.status, 404);
  });

  it('404 when the id is alive (not dead-lettered)', async () => {
    const id = enqueue(TABLE, [{ shift_date: '2026-05-01', total: 1 }], { locationId: 'default' });
    const res = await dropPOST(
      new Request(`http://localhost/api/cloud-bridge/dead-letters/${id}/drop`, {
        method: 'POST',
      }),
      { params: { id: String(id) } },
    );
    assert.equal(res.status, 404);

    // And the alive row is untouched.
    const row = testDb.prepare('SELECT id FROM cloud_bridge_outbox WHERE id = ?').get(id);
    assert.ok(row);
  });

  it('200 + audit entry on success; row is gone', async () => {
    const rows = [{ shift_date: '2026-05-01', total: 1 }, { shift_date: '2026-05-01', total: 2 }];
    const id = deadLetterBatch(rows);

    const res = await dropPOST(
      new Request(`http://localhost/api/cloud-bridge/dead-letters/${id}/drop`, {
        method: 'POST',
      }),
      { params: { id: String(id) } },
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.batch_id, id);
    assert.equal(body.table, TABLE);

    const row = testDb.prepare('SELECT id FROM cloud_bridge_outbox WHERE id = ?').get(id);
    assert.equal(row, undefined);

    const audits = readAuditEntries();
    assert.equal(audits.length, 1);
    assert.equal(audits[0].action, 'cloud_bridge_dead_letter_dropped');
    assert.equal(audits[0].changes.batch_id, id);
    assert.equal(audits[0].changes.table, TABLE);
    assert.equal(audits[0].changes.location_id, 'default');
    assert.equal(audits[0].changes.attempts, 5);
    assert.equal(audits[0].changes.rows_count, rows.length);
  });
});
