#!/usr/bin/env node
// Integration tests for /api/prep-tasks (POST/GET) and /api/prep-tasks/[id]
// (PATCH/DELETE).
//
// Covers:
//   - POST creates a row with audit
//   - GET returns rows ordered by priority desc, sort_order asc, id asc
//   - PATCH claim → in_progress + assignee + started_at
//   - PATCH release → todo + null assignee
//   - PATCH status='done' → done + done_at + done_by
//   - PATCH status='todo' (reset) clears done/started
//   - PATCH status validation (bad string → 400)
//   - PATCH location scoping (other location returns 404)
//   - DELETE removes the row + audit event
//
// Run: node --test tests/js/test-prep-tasks-api.mjs

import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

register(new URL('./resolver.mjs', import.meta.url));

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-prep-api-'));
const TMP_DB = path.join(TMP_DIR, 'lariat-test.db');

const db = await import('../../lib/db.ts');
const route = await import('../../app/api/prep-tasks/route.js');
const idRoute = await import('../../app/api/prep-tasks/[id]/route.js');

db.setDbPathForTest(TMP_DB);
const testDb = db.getDb();

after(() => {
  db.setDbPathForTest(null);
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

beforeEach(() => {
  testDb.exec('DELETE FROM prep_tasks;');
});

function postReq(body) {
  return new Request('http://localhost/api/prep-tasks', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function getReq(qs = '') {
  return new Request(`http://localhost/api/prep-tasks${qs}`);
}

function patchReq(id, body) {
  return idRoute.PATCH(
    new Request(`http://localhost/api/prep-tasks/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: { id: String(id) } },
  );
}

function delReq(id, qs = '') {
  return idRoute.DELETE(
    new Request(`http://localhost/api/prep-tasks/${id}${qs}`, { method: 'DELETE' }),
    { params: { id: String(id) } },
  );
}

async function createTask(overrides = {}) {
  const body = {
    shift_date: '2026-04-25',
    station_id: 'grill_saute',
    task: 'Prep aji verde',
    qty: '2 qt',
    priority: 0,
    ...overrides,
  };
  const res = await route.POST(postReq(body));
  assert.strictEqual(res.status, 200, `expected 200, got ${res.status}`);
  const j = await res.json();
  assert.ok(j.id > 0);
  return j.id;
}

describe('POST /api/prep-tasks', () => {
  it('creates a row with audit event', async () => {
    const id = await createTask({ task: 'dice tomato', priority: 1 });
    const row = testDb.prepare('SELECT * FROM prep_tasks WHERE id=?').get(id);
    assert.ok(row);
    assert.strictEqual(row.task, 'dice tomato');
    assert.strictEqual(row.priority, 1);
    assert.strictEqual(row.status, 'todo');
    const a = testDb
      .prepare(`SELECT * FROM audit_events WHERE entity='prep_tasks' AND entity_id=?`)
      .get(id);
    assert.ok(a, 'expected audit event');
  });

  it('400 when task missing', async () => {
    const res = await route.POST(postReq({ shift_date: '2026-04-25' }));
    assert.strictEqual(res.status, 400);
  });

  it('priority outside 0/1/2 collapses to 0', async () => {
    const id = await createTask({ priority: 99 });
    const row = testDb.prepare('SELECT * FROM prep_tasks WHERE id=?').get(id);
    assert.strictEqual(row.priority, 0);
  });
});

describe('GET /api/prep-tasks', () => {
  it('orders by priority desc, then sort_order asc, then id asc', async () => {
    const a = await createTask({ task: 'A', priority: 0, sort_order: 5 });
    const b = await createTask({ task: 'B', priority: 2, sort_order: 0 });
    const c = await createTask({ task: 'C', priority: 0, sort_order: 1 });

    const res = await route.GET(getReq('?date=2026-04-25'));
    const j = await res.json();
    const ids = j.rows.map((r) => r.id);
    assert.deepStrictEqual(ids, [b, c, a]);
  });

  it('filters by date', async () => {
    await createTask({ shift_date: '2026-04-24' });
    await createTask({ shift_date: '2026-04-25' });
    const res = await route.GET(getReq('?date=2026-04-25'));
    const j = await res.json();
    assert.strictEqual(j.rows.length, 1);
  });
});

describe('PATCH /api/prep-tasks/:id', () => {
  it('claim → in_progress, assignee set, started_at populated', async () => {
    const id = await createTask();
    const res = await patchReq(id, { claim: true, cook_id: 'alice' });
    assert.strictEqual(res.status, 200);
    const row = testDb.prepare('SELECT * FROM prep_tasks WHERE id=?').get(id);
    assert.strictEqual(row.status, 'in_progress');
    assert.strictEqual(row.assigned_cook_id, 'alice');
    assert.ok(row.started_at, 'started_at should be set');
  });

  it('release → todo, assignee null, started_at preserved', async () => {
    const id = await createTask();
    await patchReq(id, { claim: true, cook_id: 'alice' });
    const beforeRow = testDb.prepare('SELECT started_at FROM prep_tasks WHERE id=?').get(id);
    const res = await patchReq(id, { release: true, cook_id: 'alice' });
    assert.strictEqual(res.status, 200);
    const row = testDb.prepare('SELECT * FROM prep_tasks WHERE id=?').get(id);
    assert.strictEqual(row.status, 'todo');
    assert.strictEqual(row.assigned_cook_id, null);
    assert.strictEqual(row.started_at, beforeRow.started_at);
  });

  it('status=done sets done_at and done_by', async () => {
    const id = await createTask();
    await patchReq(id, { claim: true, cook_id: 'alice' });
    const res = await patchReq(id, { status: 'done', cook_id: 'alice' });
    assert.strictEqual(res.status, 200);
    const row = testDb.prepare('SELECT * FROM prep_tasks WHERE id=?').get(id);
    assert.strictEqual(row.status, 'done');
    assert.ok(row.done_at);
    assert.strictEqual(row.done_by, 'alice');
  });

  it('status=todo resets done/started/assignee', async () => {
    const id = await createTask();
    await patchReq(id, { claim: true, cook_id: 'alice' });
    await patchReq(id, { status: 'done', cook_id: 'alice' });
    const reset = await patchReq(id, { status: 'todo' });
    assert.strictEqual(reset.status, 200);
    const row = testDb.prepare('SELECT * FROM prep_tasks WHERE id=?').get(id);
    assert.strictEqual(row.status, 'todo');
    assert.strictEqual(row.assigned_cook_id, null);
    assert.strictEqual(row.started_at, null);
    assert.strictEqual(row.done_at, null);
    assert.strictEqual(row.done_by, null);
  });

  it('400 on unknown status string', async () => {
    const id = await createTask();
    const res = await patchReq(id, { status: 'frobbed' });
    assert.strictEqual(res.status, 400);
  });

  it('400 when no fields change', async () => {
    const id = await createTask();
    const res = await patchReq(id, { cook_id: 'alice' });
    assert.strictEqual(res.status, 400);
  });

  it('404 when row is in a different location', async () => {
    const id = await createTask({ location_id: 'kitchen-a' });
    const res = await patchReq(id, { status: 'done', cook_id: 'alice', location_id: 'kitchen-b' });
    assert.strictEqual(res.status, 404);
  });

  it('field edit (notes) succeeds', async () => {
    const id = await createTask();
    const res = await patchReq(id, { notes: 'subbed scallions' });
    assert.strictEqual(res.status, 200);
    const row = testDb.prepare('SELECT * FROM prep_tasks WHERE id=?').get(id);
    assert.strictEqual(row.notes, 'subbed scallions');
  });
});

describe('DELETE /api/prep-tasks/:id', () => {
  it('removes the row and writes a delete audit event', async () => {
    const id = await createTask();
    const res = await delReq(id);
    assert.strictEqual(res.status, 200);
    const row = testDb.prepare('SELECT * FROM prep_tasks WHERE id=?').get(id);
    assert.strictEqual(row, undefined);
    const a = testDb
      .prepare(
        `SELECT * FROM audit_events
          WHERE entity='prep_tasks' AND entity_id=? AND action='delete'`,
      )
      .get(id);
    assert.ok(a);
  });

  it('404 when row already gone', async () => {
    const res = await delReq(99999);
    assert.strictEqual(res.status, 404);
  });
});
