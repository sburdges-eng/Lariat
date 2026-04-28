#!/usr/bin/env node
// Admin service_hours API route regression pins.
//
// Covers the four HTTP methods on /api/service-hours:
//   GET    /api/service-hours?location=...&includeArchived=1
//   POST   /api/service-hours
//   PATCH  /api/service-hours
//   DELETE /api/service-hours
//
// Contracts pinned:
//   - GET default filters archived_at IS NULL.
//   - GET ?includeArchived=1 returns archived rows too.
//   - POST creates a row with active=1 and archived_at=NULL.
//   - PATCH updates any supplied mutable field.
//   - DELETE soft-deletes: active=0, archived_at set.
//   - PATCH {id, active: 1} on a previously archived row clears archived_at
//     (resurrection behavior).
//   - Validation: day_of_week must be 0-6 integer.
//   - UNIQUE collisions surface as 409.
//
// Run: node --test tests/js/test-service-hours-api.mjs

import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

register(new URL('./resolver.mjs', import.meta.url));

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-svchrs-api-'));
const TMP_DB = path.join(TMP_DIR, 'lariat-test.db');

const db = await import('../../lib/db.ts');
db.setDbPathForTest(TMP_DB);
const testDb = db.getDb();

const route = await import('../../app/api/service-hours/route.js');

after(() => {
  db.setDbPathForTest(null);
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

beforeEach(() => {
  testDb.exec(`DELETE FROM service_hours;`);
});

// ── Helpers ────────────────────────────────────────────────────────

function jsonReq(method, url, body) {
  return new Request(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function getReq(url) {
  return new Request(url, { method: 'GET' });
}

async function postRow(payload) {
  const res = await route.POST(jsonReq('POST', 'http://localhost/api/service-hours', payload));
  assert.strictEqual(res.status, 200, `POST expected 200, got ${res.status}`);
  const j = await res.json();
  return j.row;
}

function selectById(id) {
  return testDb.prepare('SELECT * FROM service_hours WHERE id = ?').get(id);
}

// ── GET ───────────────────────────────────────────────────────────

describe('GET /api/service-hours', () => {
  it('default call hides archived rows (archived_at IS NULL only)', async () => {
    const live = await postRow({
      location_id: 'default', day_of_week: 1, service_label: 'Lunch',
      opens_at: '11:00', closes_at: '14:00',
    });
    const retired = await postRow({
      location_id: 'default', day_of_week: 2, service_label: 'Brunch',
      opens_at: '10:00', closes_at: '14:00',
    });
    // Archive the second row via DELETE.
    await route.DELETE(jsonReq('DELETE', 'http://localhost/api/service-hours', { id: retired.id }));

    const res = await route.GET(getReq('http://localhost/api/service-hours?location=default'));
    assert.strictEqual(res.status, 200);
    const j = await res.json();
    assert.strictEqual(j.rows.length, 1);
    assert.strictEqual(j.rows[0].id, live.id);
    assert.strictEqual(j.rows[0].archived_at, null);
  });

  it('?includeArchived=1 returns both live and archived rows', async () => {
    const live = await postRow({
      location_id: 'default', day_of_week: 1, service_label: 'Lunch',
      opens_at: '11:00', closes_at: '14:00',
    });
    const retired = await postRow({
      location_id: 'default', day_of_week: 2, service_label: 'Brunch',
      opens_at: '10:00', closes_at: '14:00',
    });
    await route.DELETE(jsonReq('DELETE', 'http://localhost/api/service-hours', { id: retired.id }));

    const res = await route.GET(getReq(
      'http://localhost/api/service-hours?location=default&includeArchived=1',
    ));
    const j = await res.json();
    const ids = j.rows.map((r) => r.id).sort((a, b) => a - b);
    assert.deepStrictEqual(ids, [live.id, retired.id].sort((a, b) => a - b));
    const retRow = j.rows.find((r) => r.id === retired.id);
    assert.ok(retRow.archived_at, 'archived_at should be set on retired row');
    assert.strictEqual(retRow.active, 0);
  });

  it('scopes by location_id', async () => {
    await postRow({ location_id: 'default', day_of_week: 1, service_label: 'Lunch' });
    await postRow({ location_id: 'downtown', day_of_week: 1, service_label: 'Lunch' });

    const res = await route.GET(getReq('http://localhost/api/service-hours?location=downtown'));
    const j = await res.json();
    assert.strictEqual(j.rows.length, 1);
    assert.strictEqual(j.rows[0].location_id, 'downtown');
  });
});

// ── POST ───────────────────────────────────────────────────────────

describe('POST /api/service-hours', () => {
  it('creates a row with active=1 and archived_at=NULL', async () => {
    const res = await route.POST(jsonReq('POST', 'http://localhost/api/service-hours', {
      location_id: 'default',
      day_of_week: 3,
      service_label: 'Dinner',
      opens_at: '17:00',
      closes_at: '22:00',
      notes: 'nightly',
    }));
    assert.strictEqual(res.status, 200);
    const j = await res.json();
    assert.ok(j.row?.id);
    assert.strictEqual(j.row.active, 1);
    assert.strictEqual(j.row.archived_at, null);
    assert.strictEqual(j.row.day_of_week, 3);
    assert.strictEqual(j.row.service_label, 'Dinner');
    assert.strictEqual(j.row.opens_at, '17:00');
    assert.strictEqual(j.row.closes_at, '22:00');
    assert.strictEqual(j.row.notes, 'nightly');
  });

  it('defaults location_id to "default" when omitted', async () => {
    const row = await postRow({ day_of_week: 4, service_label: 'Late' });
    assert.strictEqual(row.location_id, 'default');
  });

  it('rejects day_of_week outside 0-6 with 400', async () => {
    const tooHigh = await route.POST(jsonReq('POST', 'http://localhost/api/service-hours', {
      day_of_week: 7,
    }));
    assert.strictEqual(tooHigh.status, 400);

    const neg = await route.POST(jsonReq('POST', 'http://localhost/api/service-hours', {
      day_of_week: -1,
    }));
    assert.strictEqual(neg.status, 400);

    const nonInt = await route.POST(jsonReq('POST', 'http://localhost/api/service-hours', {
      day_of_week: 3.5,
    }));
    assert.strictEqual(nonInt.status, 400);

    const missing = await route.POST(jsonReq('POST', 'http://localhost/api/service-hours', {}));
    assert.strictEqual(missing.status, 400);
  });

  it('clips over-long string fields', async () => {
    const big = 'x'.repeat(600);
    const row = await postRow({
      day_of_week: 0,
      service_label: big,
      opens_at: big,
      closes_at: big,
      notes: big,
    });
    assert.strictEqual(row.service_label.length, 64);
    assert.strictEqual(row.opens_at.length, 16);
    assert.strictEqual(row.closes_at.length, 16);
    assert.strictEqual(row.notes.length, 500);
  });

  it('returns 409 on UNIQUE(location_id, day_of_week, service_label) collision', async () => {
    await postRow({ day_of_week: 5, service_label: 'Dinner' });
    const dup = await route.POST(jsonReq('POST', 'http://localhost/api/service-hours', {
      day_of_week: 5, service_label: 'Dinner',
    }));
    assert.strictEqual(dup.status, 409);
  });

  it('rejects empty-string location_id with 400 (no silent default substitution)', async () => {
    const res = await route.POST(jsonReq('POST', 'http://localhost/api/service-hours', {
      location_id: '',
      day_of_week: 2,
      service_label: 'Lunch',
    }));
    assert.strictEqual(res.status, 400);
    const j = await res.json();
    assert.match(String(j.error || ''), /location_id/);
  });
});

// ── PATCH ──────────────────────────────────────────────────────────

describe('PATCH /api/service-hours', () => {
  it('updates supplied fields and leaves others alone', async () => {
    const row = await postRow({
      day_of_week: 1,
      service_label: 'Lunch',
      opens_at: '11:00',
      closes_at: '14:00',
      notes: 'old',
    });

    const res = await route.PATCH(jsonReq('PATCH', 'http://localhost/api/service-hours', {
      id: row.id,
      opens_at: '11:30',
      notes: 'new',
    }));
    assert.strictEqual(res.status, 200);
    const j = await res.json();
    assert.strictEqual(j.row.opens_at, '11:30');
    assert.strictEqual(j.row.notes, 'new');
    assert.strictEqual(j.row.closes_at, '14:00');
    assert.strictEqual(j.row.service_label, 'Lunch');
    assert.strictEqual(j.row.day_of_week, 1);
  });

  it('rejects missing id with 400', async () => {
    const res = await route.PATCH(jsonReq('PATCH', 'http://localhost/api/service-hours', {
      opens_at: '09:00',
    }));
    assert.strictEqual(res.status, 400);
  });

  it('returns 404 when id does not exist', async () => {
    const res = await route.PATCH(jsonReq('PATCH', 'http://localhost/api/service-hours', {
      id: 999999, opens_at: '09:00',
    }));
    assert.strictEqual(res.status, 404);
  });

  it('rejects day_of_week out of range with 400 and does not mutate the row', async () => {
    const row = await postRow({ day_of_week: 1, service_label: 'Lunch', opens_at: '11:00' });
    const res = await route.PATCH(jsonReq('PATCH', 'http://localhost/api/service-hours', {
      id: row.id, day_of_week: 9,
    }));
    assert.strictEqual(res.status, 400);
    const after = selectById(row.id);
    assert.strictEqual(after.day_of_week, 1);
    assert.strictEqual(after.opens_at, '11:00');
  });

  it('returns 400 when no editable fields are supplied', async () => {
    const row = await postRow({ day_of_week: 1, service_label: 'Lunch' });
    const res = await route.PATCH(jsonReq('PATCH', 'http://localhost/api/service-hours', {
      id: row.id,
    }));
    assert.strictEqual(res.status, 400);
  });

  it('rejects empty-string location_id with 400 (no silent default substitution)', async () => {
    const row = await postRow({
      location_id: 'downtown',
      day_of_week: 1,
      service_label: 'Lunch',
    });
    const res = await route.PATCH(jsonReq('PATCH', 'http://localhost/api/service-hours', {
      id: row.id,
      location_id: '',
    }));
    assert.strictEqual(res.status, 400);
    const j = await res.json();
    assert.match(String(j.error || ''), /location_id/);
    // The row must not have been silently moved.
    const after = selectById(row.id);
    assert.strictEqual(after.location_id, 'downtown');
  });
});

// ── DELETE (soft) ──────────────────────────────────────────────────

describe('DELETE /api/service-hours', () => {
  it('soft-deletes: sets active=0 and archived_at', async () => {
    const row = await postRow({ day_of_week: 1, service_label: 'Lunch' });

    const res = await route.DELETE(jsonReq('DELETE', 'http://localhost/api/service-hours', {
      id: row.id,
    }));
    assert.strictEqual(res.status, 200);
    const j = await res.json();
    assert.strictEqual(j.row.active, 0);
    assert.ok(j.row.archived_at, 'archived_at should be stamped');

    // Row is still in the table — not hard-deleted.
    const raw = selectById(row.id);
    assert.ok(raw, 'row still present');
    assert.strictEqual(raw.active, 0);
    assert.ok(raw.archived_at);
  });

  it('rejects missing id with 400', async () => {
    const res = await route.DELETE(jsonReq('DELETE', 'http://localhost/api/service-hours', {}));
    assert.strictEqual(res.status, 400);
  });

  it('returns 404 when id does not exist', async () => {
    const res = await route.DELETE(jsonReq('DELETE', 'http://localhost/api/service-hours', {
      id: 999999,
    }));
    assert.strictEqual(res.status, 404);
  });
});

// ── Resurrection: PATCH {id, active: 1} on an archived row ─────────

describe('PATCH active=1 on archived row (resurrection)', () => {
  it('clears archived_at back to NULL and sets active=1', async () => {
    const row = await postRow({ day_of_week: 1, service_label: 'Lunch' });

    // Archive it.
    await route.DELETE(jsonReq('DELETE', 'http://localhost/api/service-hours', { id: row.id }));
    const archived = selectById(row.id);
    assert.strictEqual(archived.active, 0);
    assert.ok(archived.archived_at);

    // Resurrect.
    const res = await route.PATCH(jsonReq('PATCH', 'http://localhost/api/service-hours', {
      id: row.id, active: 1,
    }));
    assert.strictEqual(res.status, 200);
    const j = await res.json();
    assert.strictEqual(j.row.active, 1);
    assert.strictEqual(j.row.archived_at, null);

    // Double-check the DB reflects the same.
    const raw = selectById(row.id);
    assert.strictEqual(raw.active, 1);
    assert.strictEqual(raw.archived_at, null);

    // GET (default, no includeArchived) should now show it again.
    const getRes = await route.GET(getReq('http://localhost/api/service-hours?location=default'));
    const getJ = await getRes.json();
    assert.ok(getJ.rows.some((r) => r.id === row.id), 'resurrected row visible in default GET');
  });
});
