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
  testDb.exec('DELETE FROM date_marks; DELETE FROM audit_events; DELETE FROM idempotency_keys;');
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
function countMarksFor(location_id) {
  return testDb
    .prepare('SELECT COUNT(*) AS c FROM date_marks WHERE location_id=?')
    .get(location_id).c;
}
function countAudit(entity) {
  return testDb.prepare('SELECT COUNT(*) AS c FROM audit_events WHERE entity=?').get(entity).c;
}
function countAuditAction(entity, action) {
  return testDb
    .prepare('SELECT COUNT(*) AS c FROM audit_events WHERE entity=? AND action=?')
    .get(entity, action).c;
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

  it('GET excludes already-discarded rows from active and scan', async () => {
    const post = await POST(postReq({ item: 'aji-verde', prepared_on: '2026-04-20' }));
    const id = (await post.json()).entry.id;
    await PATCH(patchReq({ id, discard_reason: 'early_use' }));

    const res = await GET(getReq('?today=2026-04-22'));
    const body = await res.json();
    assert.strictEqual(body.active.length, 0);
    assert.strictEqual(body.scan.length, 0);
  });

  it('GET sorts the scan with most-past-due first', async () => {
    // today = 2026-04-20; +6d holding window
    //   chimichurri prep 04-12 → discard 04-18 → -2d (expired)
    //   aji-verde   prep 04-14 → discard 04-20 → 0  (due_today)
    //   beef-stock  prep 04-19 → discard 04-25 → +5 (ok)
    await POST(postReq({ item: 'chimichurri', prepared_on: '2026-04-12' }));
    await POST(postReq({ item: 'aji-verde',   prepared_on: '2026-04-14' }));
    await POST(postReq({ item: 'beef-stock',  prepared_on: '2026-04-19' }));

    const res = await GET(getReq('?today=2026-04-20'));
    const body = await res.json();
    assert.strictEqual(body.scan.length, 3);
    assert.strictEqual(body.scan[0].item, 'chimichurri');
    assert.strictEqual(body.scan[0].status, 'expired');
    assert.strictEqual(body.scan[0].days_until_discard, -2);
    assert.strictEqual(body.scan[1].item, 'aji-verde');
    assert.strictEqual(body.scan[1].status, 'due_today');
    assert.strictEqual(body.scan[2].item, 'beef-stock');
    assert.strictEqual(body.scan[2].status, 'ok');
  });
});

// ── Location scoping (POST + GET, audit_events.location_id) ───────
//
// Mirrors tests/js/test-cooling-api.mjs's location-scoping block: a
// write to one site must not leak into another site's read, and the
// audit row inherits the correct location_id.

describe('location scoping', () => {
  it('POST kitchen-a does not leak into kitchen-b reads', async () => {
    const a = await POST(postReq({
      item: 'aji-verde',
      prepared_on: '2026-04-20',
      cook_id: 'rosa',
      location_id: 'kitchen-a',
    }));
    assert.strictEqual(a.status, 200);

    const b = await POST(postReq({
      item: 'chimichurri',
      prepared_on: '2026-04-21',
      cook_id: 'mateo',
      location_id: 'kitchen-b',
    }));
    assert.strictEqual(b.status, 200);

    assert.strictEqual(countMarksFor('kitchen-a'), 1);
    assert.strictEqual(countMarksFor('kitchen-b'), 1);
    assert.strictEqual(countMarksFor('default'), 0);

    const resA = await GET(getReq('?location=kitchen-a&today=2026-04-22'));
    assert.strictEqual(resA.status, 200);
    const bodyA = await resA.json();
    assert.strictEqual(bodyA.location_id, 'kitchen-a');
    assert.strictEqual(bodyA.active.length, 1);
    assert.strictEqual(bodyA.active[0].item, 'aji-verde');

    const resB = await GET(getReq('?location=kitchen-b&today=2026-04-22'));
    const bodyB = await resB.json();
    assert.strictEqual(bodyB.location_id, 'kitchen-b');
    assert.strictEqual(bodyB.active.length, 1);
    assert.strictEqual(bodyB.active[0].item, 'chimichurri');

    // Default location must be empty — no cross-site leakage.
    const resDefault = await GET(getReq('?today=2026-04-22'));
    const bodyDefault = await resDefault.json();
    assert.strictEqual(bodyDefault.location_id, 'default');
    assert.strictEqual(bodyDefault.active.length, 0);
  });

  it('audit_events carry the same location_id as the source row', async () => {
    await POST(postReq({
      item: 'aji-verde',
      prepared_on: '2026-04-20',
      location_id: 'kitchen-a',
    }));
    await POST(postReq({
      item: 'chimichurri',
      prepared_on: '2026-04-20',
      location_id: 'kitchen-b',
    }));

    const aAudit = testDb
      .prepare(
        `SELECT COUNT(*) AS c FROM audit_events
          WHERE entity='date_marks' AND location_id=?`,
      )
      .get('kitchen-a').c;
    const bAudit = testDb
      .prepare(
        `SELECT COUNT(*) AS c FROM audit_events
          WHERE entity='date_marks' AND location_id=?`,
      )
      .get('kitchen-b').c;
    assert.strictEqual(aAudit, 1);
    assert.strictEqual(bAudit, 1);
  });
});

// ── Audit-event delta within the same tx window ───────────────────
//
// `postAuditEvent()` MUST run inside the same db.transaction(...) as
// the source INSERT. We can't observe transaction boundaries from
// outside better-sqlite3, but we CAN assert "exactly one audit row was
// added by exactly one source-row insert" — if the audit posted
// outside the tx and the tx rolled back, the deltas would diverge.

describe('audit-event delta is +1 per successful POST/PATCH', () => {
  it('POST: insert audit count grows by exactly 1 alongside the row', async () => {
    const beforeRows = countMarks();
    const beforeAudit = countAuditAction('date_marks', 'insert');

    const res = await POST(postReq({
      item: 'beef-stock',
      prepared_on: '2026-04-20',
      cook_id: 'rosa',
    }));
    assert.strictEqual(res.status, 200);

    assert.strictEqual(countMarks() - beforeRows, 1);
    assert.strictEqual(countAuditAction('date_marks', 'insert') - beforeAudit, 1);
  });

  it('PATCH: update audit count grows by exactly 1 alongside the discard', async () => {
    const post = await POST(postReq({
      item: 'beef-stock',
      prepared_on: '2026-04-20',
    }));
    const id = (await post.json()).entry.id;

    const beforeUpdates = countAuditAction('date_marks', 'update');
    const res = await PATCH(patchReq({ id, discard_reason: 'expired' }));
    assert.strictEqual(res.status, 200);

    assert.strictEqual(countAuditAction('date_marks', 'update') - beforeUpdates, 1);

    // Update audit payload references the discarded row + reason.
    const audit = testDb
      .prepare(
        `SELECT * FROM audit_events
          WHERE entity='date_marks' AND action='update'
          ORDER BY id DESC LIMIT 1`,
      )
      .get();
    assert.strictEqual(audit.entity_id, id);
    assert.match(audit.note ?? '', /discarded:\s*expired/);
  });

  it('rejected POST writes ZERO audit rows (no rollback debris)', async () => {
    const beforeAudit = countAudit('date_marks');
    const res = await POST(postReq({ prepared_on: '2026-04-20' })); // no item
    assert.strictEqual(res.status, 400);
    assert.strictEqual(countMarks(), 0);
    assert.strictEqual(countAudit('date_marks'), beforeAudit);
  });

  it('rejected PATCH (unknown enum reason) writes ZERO update audit rows', async () => {
    const post = await POST(postReq({
      item: 'aji-verde',
      prepared_on: '2026-04-20',
    }));
    const id = (await post.json()).entry.id;

    const beforeUpdates = countAuditAction('date_marks', 'update');
    const res = await PATCH(patchReq({ id, discard_reason: 'because' }));
    assert.strictEqual(res.status, 400);
    assert.strictEqual(countAuditAction('date_marks', 'update'), beforeUpdates);

    // Source row stays active.
    const row = testDb.prepare('SELECT * FROM date_marks WHERE id=?').get(id);
    assert.strictEqual(row.discarded_at, null);
  });
});

// ── PATCH error paths ────────────────────────────────────────────

describe('PATCH /api/date-marks — error contract', () => {
  it('400 when id is missing or non-positive', async () => {
    const r1 = await PATCH(patchReq({ discard_reason: 'expired' }));
    assert.strictEqual(r1.status, 400);
    const r2 = await PATCH(patchReq({ id: 0, discard_reason: 'expired' }));
    assert.strictEqual(r2.status, 400);
    const r3 = await PATCH(patchReq({ id: -1, discard_reason: 'expired' }));
    assert.strictEqual(r3.status, 400);
  });

  it('400 when discard_reason is missing', async () => {
    const post = await POST(postReq({ item: 'aji-verde', prepared_on: '2026-04-20' }));
    const id = (await post.json()).entry.id;
    const res = await PATCH(patchReq({ id }));
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /discard_reason/);
  });

  it('accepts every documented discard_reason value', async () => {
    for (const reason of ['expired', 'early_use', 'quality', 'contamination']) {
      testDb.exec('DELETE FROM date_marks; DELETE FROM audit_events;');
      const post = await POST(postReq({ item: 'beef-stock', prepared_on: '2026-04-20' }));
      const id = (await post.json()).entry.id;
      const res = await PATCH(patchReq({ id, discard_reason: reason }));
      assert.strictEqual(res.status, 200, `expected 200 for reason=${reason}`);
      const row = testDb.prepare('SELECT * FROM date_marks WHERE id=?').get(id);
      assert.strictEqual(row.discard_reason, reason);
    }
  });

  it('404 when the id does not exist; no audit row written', async () => {
    const beforeAudit = countAudit('date_marks');
    const res = await PATCH(patchReq({ id: 999_999, discard_reason: 'expired' }));
    assert.strictEqual(res.status, 404);
    assert.strictEqual(countAudit('date_marks'), beforeAudit);
  });

  it('409 when discarding an already-discarded mark; reason is NOT overwritten', async () => {
    const post = await POST(postReq({ item: 'aji-verde', prepared_on: '2026-04-20' }));
    const id = (await post.json()).entry.id;

    const first = await PATCH(patchReq({ id, discard_reason: 'expired' }));
    assert.strictEqual(first.status, 200);
    assert.strictEqual(countAuditAction('date_marks', 'update'), 1);

    const second = await PATCH(patchReq({ id, discard_reason: 'quality' }));
    assert.strictEqual(second.status, 409);
    const body = await second.json();
    assert.match(body.error, /already discarded/);

    // Original reason preserved; second discard did NOT roll forward.
    const row = testDb.prepare('SELECT * FROM date_marks WHERE id=?').get(id);
    assert.strictEqual(row.discard_reason, 'expired');
    assert.strictEqual(countAuditAction('date_marks', 'update'), 1);
  });
});
