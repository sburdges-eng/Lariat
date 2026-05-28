#!/usr/bin/env node
// Integration tests for /api/prep-tasks.
//
// Run: node --experimental-strip-types --test tests/js/test-prep-tasks-api.mjs

import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

register(new URL('./resolver.mjs', import.meta.url));

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-prep-tasks-api-'));
const TMP_DB = path.join(TMP_DIR, 'lariat-test.db');

const db = await import('../../lib/db.ts');
const prepRoute = await import('../../app/api/prep-tasks/route.js');
const prepIdRoute = await import('../../app/api/prep-tasks/[id]/route.js');

db.setDbPathForTest(TMP_DB);
const testDb = db.getDb();

after(() => {
  db.setDbPathForTest(null);
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

beforeEach(() => {
  testDb.exec('DELETE FROM prep_tasks; DELETE FROM audit_events; DELETE FROM idempotency_keys;');
});

function req(url, method, body, headers = {}) {
  return new Request(url, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function postTask(body, headers = {}) {
  return prepRoute.POST(req('http://localhost/api/prep-tasks', 'POST', body, headers));
}

function patchTask(id, body, headers = {}) {
  return prepIdRoute.PATCH(
    req(`http://localhost/api/prep-tasks/${id}`, 'PATCH', body, headers),
    { params: Promise.resolve({ id: String(id) }) },
  );
}

function deleteTask(id, qs = '', headers = {}) {
  return prepIdRoute.DELETE(
    new Request(`http://localhost/api/prep-tasks/${id}${qs}`, {
      method: 'DELETE',
      headers,
    }),
    { params: Promise.resolve({ id: String(id) }) },
  );
}

function countAudit(action) {
  return testDb
    .prepare(`SELECT COUNT(*) AS c FROM audit_events WHERE entity = 'prep_tasks' AND action = ?`)
    .get(action).c;
}

describe('POST /api/prep-tasks', () => {
  it('creates a task and writes an audit row', async () => {
    const res = await postTask({
      shift_date: '2099-05-28',
      location_id: 'default',
      station_id: 'prep',
      task: 'Dice tomatoes',
      qty: '2 qt',
      assigned_cook_id: 'maria',
      priority: 1,
      notes: 'for salsa',
      source: 'manual',
    });

    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.ok, true);
    assert.ok(json.task.id > 0);

    const row = testDb.prepare('SELECT * FROM prep_tasks WHERE id = ?').get(json.task.id);
    assert.equal(row.task, 'Dice tomatoes');
    assert.equal(row.qty, '2 qt');
    assert.equal(row.assigned_cook_id, 'maria');
    assert.equal(row.status, 'todo');
    assert.equal(row.priority, 1);
    assert.equal(countAudit('insert'), 1);
  });

  it('rejects a blank task', async () => {
    const res = await postTask({ shift_date: '2099-05-28', task: '   ' });
    assert.equal(res.status, 400);
  });

  it('dedupes service-worker replays with idempotency-key', async () => {
    const body = {
      shift_date: '2099-05-28',
      task: 'Slice onions',
      location_id: 'default',
    };
    const headers = { 'idempotency-key': 'prepTaskReplayKey0001' };
    const r1 = await postTask(body, headers);
    const r2 = await postTask(body, headers);

    assert.equal(r1.status, 200);
    assert.equal(r2.status, 200);
    const rows = testDb.prepare('SELECT * FROM prep_tasks WHERE task = ?').all('Slice onions');
    assert.equal(rows.length, 1);
    assert.equal(countAudit('insert'), 1);
  });
});

describe('PATCH /api/prep-tasks/:id', () => {
  it('claims, starts, and completes a task in place', async () => {
    const created = await (await postTask({ shift_date: '2099-05-28', task: 'Make ranch' })).json();
    const id = created.task.id;

    const claim = await patchTask(id, { location_id: 'default', claim: true, cook_id: 'ana' });
    assert.equal(claim.status, 200);
    let row = testDb.prepare('SELECT * FROM prep_tasks WHERE id = ?').get(id);
    assert.equal(row.assigned_cook_id, 'ana');
    assert.equal(row.status, 'todo');

    const start = await patchTask(id, { location_id: 'default', status: 'in_progress', cook_id: 'ana' });
    assert.equal(start.status, 200);
    row = testDb.prepare('SELECT * FROM prep_tasks WHERE id = ?').get(id);
    assert.equal(row.status, 'in_progress');
    assert.ok(row.started_at);

    const done = await patchTask(id, { location_id: 'default', status: 'done', cook_id: 'ana' });
    assert.equal(done.status, 200);
    row = testDb.prepare('SELECT * FROM prep_tasks WHERE id = ?').get(id);
    assert.equal(row.status, 'done');
    assert.equal(row.done_by, 'ana');
    assert.ok(row.done_at);
    assert.equal(countAudit('update'), 3);
  });

  it('404s across locations', async () => {
    const created = await (await postTask({
      shift_date: '2099-05-28',
      task: 'Cut limes',
      location_id: 'bar',
    })).json();

    const res = await patchTask(created.task.id, {
      location_id: 'kitchen',
      status: 'done',
      cook_id: 'ana',
    });

    assert.equal(res.status, 404);
    const row = testDb.prepare('SELECT * FROM prep_tasks WHERE id = ?').get(created.task.id);
    assert.equal(row.status, 'todo');
  });
});

describe('DELETE /api/prep-tasks/:id', () => {
  it('deletes a task in the requested location and audits it', async () => {
    const created = await (await postTask({
      shift_date: '2099-05-28',
      task: 'Portion sauce',
      location_id: 'default',
    })).json();

    const res = await deleteTask(created.task.id, '?location=default&cook_id=km');
    assert.equal(res.status, 200);
    const row = testDb.prepare('SELECT * FROM prep_tasks WHERE id = ?').get(created.task.id);
    assert.equal(row, undefined);
    assert.equal(countAudit('delete'), 1);
  });
});
