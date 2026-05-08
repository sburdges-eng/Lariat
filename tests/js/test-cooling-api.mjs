#!/usr/bin/env node
// Integration tests for /api/cooling (F1 / FDA §3-501.14).
// Pure rules covered by test-cooling-rules.mjs; this exercises POST
// (open batch + audit), PATCH (422 needs_corrective_action), GET.
// Run: node --experimental-strip-types --test tests/js/test-cooling-api.mjs

import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

register(new URL('./resolver.mjs', import.meta.url));

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-cooling-api-'));
const TMP_DB = path.join(TMP_DIR, 'lariat-test.db');

const db = await import('../../lib/db.ts');
const route = await import('../../app/api/cooling/route.js');

db.setDbPathForTest(TMP_DB);
const testDb = db.getDb();

const { POST, PATCH, GET } = route;

after(() => {
  db.setDbPathForTest(null);
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

beforeEach(() => {
  testDb.exec('DELETE FROM cooling_log; DELETE FROM audit_events;');
});

const T_START = '2026-04-20T10:00:00.000Z';
const T_STAGE1_OK = '2026-04-20T11:30:00.000Z';        // +90m, ≤ 70°F
const T_STAGE1_LATE = '2026-04-20T12:30:00.000Z';      // +150m → over 2h budget

function postReq(body) {
  return new Request('http://localhost/api/cooling', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
function patchReq(body) {
  return new Request('http://localhost/api/cooling', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
function countCooling() {
  return testDb.prepare('SELECT COUNT(*) AS c FROM cooling_log').get().c;
}
function countAudit(entity) {
  return testDb.prepare('SELECT COUNT(*) AS c FROM audit_events WHERE entity=?').get(entity).c;
}

describe('POST /api/cooling — happy path', () => {
  it('opens a batch, persists row, emits one audit event', async () => {
    const res = await POST(postReq({
      item: 'pulled pork',
      started_at: T_START,
      start_reading_f: 165,
      cook_id: 'alice',
    }));
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.ok, true);
    assert.strictEqual(body.entry.item, 'pulled pork');
    assert.strictEqual(body.entry.status, 'in_progress');
    assert.strictEqual(countCooling(), 1);
    assert.strictEqual(countAudit('cooling_log'), 1);
    const audit = testDb
      .prepare(`SELECT * FROM audit_events WHERE entity='cooling_log'`).get();
    assert.strictEqual(audit.action, 'insert');
    assert.strictEqual(audit.actor_cook_id, 'alice');
  });
});

describe('POST /api/cooling — validation', () => {
  it('400 when item is missing', async () => {
    const res = await POST(postReq({ started_at: T_START }));
    assert.strictEqual(res.status, 400);
    assert.strictEqual(countCooling(), 0);
    assert.strictEqual(countAudit('cooling_log'), 0);
  });

  it('400 when started_at is not ISO', async () => {
    const res = await POST(postReq({ item: 'soup', started_at: 'yesterday' }));
    assert.strictEqual(res.status, 400);
  });
});

describe('PATCH /api/cooling — 422 needs_corrective_action', () => {
  async function openBatch() {
    const res = await POST(postReq({ item: 'pulled pork', started_at: T_START }));
    return (await res.json()).entry.id;
  }

  it('stage1 over 2h without a corrective note → 422; no update audit', async () => {
    const id = await openBatch();
    const res = await PATCH(patchReq({ id, reading_f: 65, at: T_STAGE1_LATE }));
    assert.strictEqual(res.status, 422);
    const body = await res.json();
    assert.strictEqual(body.needs_corrective_action, true);
    const updates = testDb
      .prepare(`SELECT COUNT(*) AS c FROM audit_events WHERE entity='cooling_log' AND action='update'`)
      .get().c;
    assert.strictEqual(updates, 0);
  });

  it('stage1 over 2h WITH a corrective note → 200, status=breach, audit update', async () => {
    const id = await openBatch();
    const res = await PATCH(patchReq({
      id,
      reading_f: 65,
      at: T_STAGE1_LATE,
      corrective_action: 'split into shallower pans, re-iced',
    }));
    assert.strictEqual(res.status, 200);
    const row = testDb.prepare('SELECT * FROM cooling_log WHERE id=?').get(id);
    assert.strictEqual(row.status, 'breach');
    assert.match(row.breach_reason, /stage1_over_2h/);
    const updates = testDb
      .prepare(`SELECT COUNT(*) AS c FROM audit_events WHERE entity='cooling_log' AND action='update'`)
      .get().c;
    assert.strictEqual(updates, 1);
  });
});

describe('GET /api/cooling', () => {
  it('lists in-progress batches; closed batches excluded by default', async () => {
    await POST(postReq({ item: 'soup', started_at: T_START }));
    const res = await GET(new Request('http://localhost/api/cooling'));
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.open.length, 1);
    assert.strictEqual(body.open[0].item, 'soup');
    assert.ok(Array.isArray(body.scan));
  });
});

// ─────────────────────────────────────────────────────────────────
// PATCH /api/cooling — cross-location IDOR guard
//
// A cook scoped to site-A must not be able to mutate a cooling batch
// belonging to site-B by guessing the numeric id. Surfaced as 404
// (not 403) so existence at another site does not leak.
// ─────────────────────────────────────────────────────────────────

describe('PATCH /api/cooling — cross-location IDOR guard', () => {
  it('404 when caller location does not match the row location', async () => {
    // Open a batch at site-B.
    const openRes = await POST(postReq({
      item: 'site-b stew',
      started_at: T_START,
      location_id: 'site-b',
    }));
    const id = (await openRes.json()).entry.id;

    // Site-A cook tries to patch the site-B batch.
    const res = await PATCH(new Request(
      'http://localhost/api/cooling?location=site-a',
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id,
          reading_f: 65,
          at: T_STAGE1_OK,
          corrective_action: 'malicious',
        }),
      },
    ));
    assert.strictEqual(res.status, 404);

    // Row at site-B was not mutated.
    const row = testDb.prepare('SELECT status, stage1_at FROM cooling_log WHERE id=?').get(id);
    assert.strictEqual(row.status, 'in_progress');
    assert.strictEqual(row.stage1_at, null);

    // No audit update was emitted.
    const updates = testDb
      .prepare(`SELECT COUNT(*) AS c FROM audit_events WHERE entity='cooling_log' AND action='update'`)
      .get().c;
    assert.strictEqual(updates, 0);
  });

  it('200 when caller location matches the row location', async () => {
    const openRes = await POST(postReq({
      item: 'site-b stew',
      started_at: T_START,
      location_id: 'site-b',
    }));
    const id = (await openRes.json()).entry.id;

    const res = await PATCH(new Request(
      'http://localhost/api/cooling?location=site-b',
      {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id, reading_f: 65, at: T_STAGE1_OK }),
      },
    ));
    assert.strictEqual(res.status, 200);
  });
});
