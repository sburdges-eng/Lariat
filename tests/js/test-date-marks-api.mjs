#!/usr/bin/env node
// Integration tests for /api/date-marks (F2 / FDA §3-501.17).
// 7-day RTE TCS holding window. The route POSTs new marks and PATCHes
// to record discards.
//
// Pure rule module is covered by test-date-mark-rules.mjs. Here we
// exercise route-level behavior: POST happy path, validator 400, GET.
//
// Run: node --experimental-strip-types --test tests/js/test-date-marks-api.mjs

import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

register(new URL('./resolver.mjs', import.meta.url));

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-date-marks-api-'));
const TMP_DB = path.join(TMP_DIR, 'lariat-test.db');

const db = await import('../../lib/db.ts');
const route = await import('../../app/api/date-marks/route.js');

db.setDbPathForTest(TMP_DB);
const testDb = db.getDb();

const { POST, PATCH, GET } = route;

after(() => {
  db.setDbPathForTest(null);
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

beforeEach(() => {
  testDb.exec('DELETE FROM date_marks; DELETE FROM audit_events;');
});

function postReq(body) {
  return new Request('http://localhost/api/date-marks', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
function patchReq(body) {
  return new Request('http://localhost/api/date-marks', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
function getReq(qs = '') {
  return new Request(`http://localhost/api/date-marks${qs}`);
}
function countMarks() {
  return testDb.prepare('SELECT COUNT(*) AS c FROM date_marks').get().c;
}
function countAudit(entity) {
  return testDb.prepare('SELECT COUNT(*) AS c FROM audit_events WHERE entity=?').get(entity).c;
}

describe('POST /api/date-marks — happy path', () => {
  it('inserts row, computes discard_on = prepared_on + 6d, audits insert', async () => {
    const res = await POST(postReq({
      item: 'pulled pork',
      prepared_on: '2026-04-20',
      cook_id: 'alice',
    }));
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.ok, true);
    assert.strictEqual(body.entry.prepared_on, '2026-04-20');
    assert.strictEqual(body.entry.discard_on, '2026-04-26');
    assert.strictEqual(countMarks(), 1);
    assert.strictEqual(countAudit('date_marks'), 1);
    const audit = testDb
      .prepare(`SELECT * FROM audit_events WHERE entity='date_marks'`).get();
    assert.strictEqual(audit.action, 'insert');
    assert.strictEqual(audit.actor_cook_id, 'alice');
  });
});

describe('POST /api/date-marks — validation', () => {
  it('400 when item is missing', async () => {
    const res = await POST(postReq({ prepared_on: '2026-04-20' }));
    assert.strictEqual(res.status, 400);
    assert.strictEqual(countMarks(), 0);
  });

  it('400 when prepared_on is not YYYY-MM-DD', async () => {
    const res = await POST(postReq({ item: 'pulled pork', prepared_on: '04/20/2026' }));
    assert.strictEqual(res.status, 400);
    assert.strictEqual(countMarks(), 0);
  });

  it('400 when prepared_on is a non-existent date', async () => {
    const res = await POST(postReq({ item: 'pulled pork', prepared_on: '2026-02-30' }));
    assert.strictEqual(res.status, 400);
  });
});

describe('PATCH /api/date-marks — discard flow', () => {
  it('records discard, sets discarded_at, emits update audit', async () => {
    const post = await POST(postReq({ item: 'soup', prepared_on: '2026-04-20' }));
    const id = (await post.json()).entry.id;

    const res = await PATCH(patchReq({ id, discard_reason: 'expired', cook_id: 'alice' }));
    assert.strictEqual(res.status, 200);
    const row = testDb.prepare('SELECT * FROM date_marks WHERE id=?').get(id);
    assert.strictEqual(row.discard_reason, 'expired');
    assert.ok(row.discarded_at);
    const updates = testDb
      .prepare(`SELECT COUNT(*) AS c FROM audit_events WHERE entity='date_marks' AND action='update'`)
      .get().c;
    assert.strictEqual(updates, 1);
  });
});

describe('GET /api/date-marks', () => {
  it('lists active rows; scan classifies status against today', async () => {
    await POST(postReq({ item: 'soup', prepared_on: '2026-04-20' }));
    const res = await GET(getReq('?today=2026-04-26'));
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.active.length, 1);
    assert.strictEqual(body.active[0].item, 'soup');
    const scan = body.scan.find((x) => x.item === 'soup');
    assert.strictEqual(scan.status, 'due_today');
    assert.strictEqual(scan.days_until_discard, 0);
  });
});
