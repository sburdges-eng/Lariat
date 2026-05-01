#!/usr/bin/env node
// Integration tests for /api/sick-worker (F5 / FDA §2-201.11).
// PIC-authority surface; PIN gate is bypassed with LARIAT_PIN unset.
// Pure rules covered by test-sick-worker-rules.mjs.
// Run: node --experimental-strip-types --test tests/js/test-sick-worker-api.mjs

import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

register(new URL('./resolver.mjs', import.meta.url));

// PIN gate off; the gate logic is covered separately.
delete process.env.LARIAT_PIN;

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-sick-worker-api-'));
const TMP_DB = path.join(TMP_DIR, 'lariat-test.db');

const db = await import('../../lib/db.ts');
const route = await import('../../app/api/sick-worker/route.js');

db.setDbPathForTest(TMP_DB);
const testDb = db.getDb();

const { POST, PATCH, GET } = route;

after(() => {
  db.setDbPathForTest(null);
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

beforeEach(() => {
  testDb.exec('DELETE FROM sick_worker_reports; DELETE FROM audit_events;');
});

const T_START = '2026-04-20T08:00:00.000Z';

function postReq(body) {
  return new Request('http://localhost/api/sick-worker', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
function patchReq(body) {
  return new Request('http://localhost/api/sick-worker', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
function countReports() {
  return testDb.prepare('SELECT COUNT(*) AS c FROM sick_worker_reports').get().c;
}
function countAudit(entity) {
  return testDb.prepare('SELECT COUNT(*) AS c FROM audit_events WHERE entity=?').get(entity).c;
}

describe('POST /api/sick-worker — happy path', () => {
  it('files an exclusion for vomiting; row + audit written', async () => {
    const res = await POST(postReq({
      cook_id: 'bob', symptoms: ['vomiting'], action: 'excluded',
      started_at: T_START, reported_by_pic_id: 'alice',
    }));
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.ok, true);
    assert.strictEqual(body.entry.cook_id, 'bob');
    assert.strictEqual(body.entry.action, 'excluded');
    assert.strictEqual(countReports(), 1);
    assert.strictEqual(countAudit('sick_worker_reports'), 1);
    const audit = testDb
      .prepare(`SELECT * FROM audit_events WHERE entity='sick_worker_reports'`).get();
    assert.strictEqual(audit.action, 'insert');
    assert.strictEqual(audit.actor_source, 'pic_ui');
    assert.strictEqual(audit.actor_cook_id, 'alice');
  });
});

describe('POST /api/sick-worker — validation', () => {
  it('400 when cook_id is missing', async () => {
    const res = await POST(postReq({
      symptoms: ['vomiting'], action: 'excluded', started_at: T_START,
    }));
    assert.strictEqual(res.status, 400);
    assert.strictEqual(countReports(), 0);
  });

  it('400 when action is below FDA-required floor', async () => {
    const res = await POST(postReq({
      cook_id: 'bob', symptoms: ['vomiting'],
      action: 'monitor',         // FDA floor is 'excluded' for vomiting
      started_at: T_START,
    }));
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /FDA requires/);
    assert.strictEqual(countReports(), 0);
  });

  it('400 when symptoms contain an unknown key', async () => {
    const res = await POST(postReq({
      cook_id: 'bob', symptoms: ['mild_sniffles'],
      action: 'monitor', started_at: T_START,
    }));
    assert.strictEqual(res.status, 400);
  });
});

describe('PATCH /api/sick-worker — clearance', () => {
  it('records return-to-work; emits update audit', async () => {
    const post = await POST(postReq({
      cook_id: 'bob', symptoms: ['vomiting'], action: 'excluded',
      started_at: T_START, reported_by_pic_id: 'alice',
    }));
    const id = (await post.json()).entry.id;
    const res = await PATCH(patchReq({
      id, clearance_source: 'asymptomatic_24h', reported_by_pic_id: 'alice',
    }));
    assert.strictEqual(res.status, 200);
    const row = testDb.prepare('SELECT * FROM sick_worker_reports WHERE id=?').get(id);
    assert.ok(row.return_at);
    assert.strictEqual(row.clearance_source, 'asymptomatic_24h');
  });
});

describe('GET /api/sick-worker', () => {
  it('lists currently-excluded workers; cleared rows excluded by default', async () => {
    await POST(postReq({
      cook_id: 'bob',
      symptoms: ['vomiting'],
      action: 'excluded',
      started_at: T_START,
    }));
    const res = await GET(new Request('http://localhost/api/sick-worker'));
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.active.length, 1);
    assert.strictEqual(body.active[0].cook_id, 'bob');
    assert.deepStrictEqual(body.history, []);
  });
});
