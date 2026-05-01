#!/usr/bin/env node
// Integration tests for /api/cleaning (FDA §4-602.11 / §4-602.13).
//
// Distinct from test-cleaning-schedule-api.mjs, which covers
// /api/cleaning-schedule (the schedule definition surface). This file
// covers POST/GET on `cleaning_log` — task-completion records.
//
// Pure validator is covered by test-cleaning-rules.mjs. Here we
// exercise route-level behavior: POST happy path, validator 400, GET.
//
// Run: node --experimental-strip-types --test tests/js/test-cleaning-api.mjs

import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

register(new URL('./resolver.mjs', import.meta.url));

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-cleaning-api-'));
const TMP_DB = path.join(TMP_DIR, 'lariat-test.db');

const db = await import('../../lib/db.ts');
const route = await import('../../app/api/cleaning/route.ts');

db.setDbPathForTest(TMP_DB);
const testDb = db.getDb();

const { POST, GET } = route;

after(() => {
  db.setDbPathForTest(null);
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

beforeEach(() => {
  testDb.exec('DELETE FROM cleaning_log; DELETE FROM audit_events;');
});

function postReq(body) {
  return new Request('http://localhost/api/cleaning', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
function getReq(qs = '') {
  return new Request(`http://localhost/api/cleaning${qs}`);
}
function countLogs() {
  return testDb.prepare('SELECT COUNT(*) AS c FROM cleaning_log').get().c;
}
function countAudit(entity) {
  return testDb.prepare('SELECT COUNT(*) AS c FROM audit_events WHERE entity=?').get(entity).c;
}

describe('POST /api/cleaning — happy path', () => {
  it('records a completed task; row + audit written', async () => {
    const res = await POST(postReq({
      area: 'Line',
      task: 'Sanitize cutting boards',
      completed_at: '2026-04-20T15:00:00.000Z',
      cook_id: 'alice',
    }));
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.ok, true);
    assert.strictEqual(body.entry.task, 'Sanitize cutting boards');
    assert.strictEqual(body.entry.area, 'Line');
    assert.strictEqual(countLogs(), 1);
    assert.strictEqual(countAudit('cleaning_log'), 1);
    const audit = testDb
      .prepare(`SELECT * FROM audit_events WHERE entity='cleaning_log'`).get();
    assert.strictEqual(audit.action, 'insert');
    assert.strictEqual(audit.actor_cook_id, 'alice');
  });

  it('accepts `item` as legacy alias for `task`', async () => {
    const res = await POST(postReq({
      area: 'Dish pit',
      item: 'Run sanitizer cycle',
      cook_id: 'bob',
    }));
    assert.strictEqual(res.status, 200);
    const row = testDb.prepare('SELECT * FROM cleaning_log').get();
    assert.strictEqual(row.task, 'Run sanitizer cycle');
  });
});

describe('POST /api/cleaning — validation', () => {
  it('400 when neither item nor task is provided', async () => {
    const res = await POST(postReq({ area: 'Line' }));
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /item or task is required/);
    assert.strictEqual(countLogs(), 0);
  });

  it('400 when completed_at is not a valid ISO timestamp', async () => {
    const res = await POST(postReq({
      task: 'Sanitize boards',
      completed_at: 'yesterday',
    }));
    assert.strictEqual(res.status, 400);
    assert.strictEqual(countLogs(), 0);
  });

  it('400 when shift_date is not YYYY-MM-DD', async () => {
    const res = await POST(postReq({
      task: 'Sanitize boards',
      shift_date: '04/20/2026',
    }));
    assert.strictEqual(res.status, 400);
  });
});

describe('GET /api/cleaning', () => {
  it('lists today\'s rows scoped by location', async () => {
    await POST(postReq({ task: 'Sanitize boards', area: 'Line' }));
    await POST(postReq({ task: 'Mop floor', area: 'Dish pit' }));
    const res = await GET(getReq());
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.rows.length, 2);
    assert.ok(body.location_id);
  });
});
