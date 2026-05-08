#!/usr/bin/env node
// Admin cleaning_schedule API route regression pins.
//
// Covers the four HTTP methods on /api/cleaning-schedule:
//   GET    /api/cleaning-schedule?location=...&includeArchived=1
//   POST   /api/cleaning-schedule
//   PATCH  /api/cleaning-schedule
//   DELETE /api/cleaning-schedule
//
// Contracts pinned:
//   - GET default filters archived_at IS NULL.
//   - GET ?includeArchived=1 returns archived rows too.
//   - POST creates a row with active=1 and archived_at=NULL.
//   - POST/PATCH reject empty-string location_id with 400.
//   - POST missing area/task/frequency → 400 each.
//   - PATCH updates any supplied mutable field (partial allowed).
//   - PATCH bad id → 404.
//   - DELETE soft-deletes: active=0, archived_at set.
//   - PATCH {id, active: 1} on a previously archived row clears archived_at
//     (resurrection behavior), row reappears in default GET.
//   - Location scoping: rows for other locations are not returned.
//
// Note: unlike service_hours, cleaning_schedule has NO UNIQUE constraint —
// duplicate rows are acceptable because the same task can repeat per-date.
//
// Run: node --test tests/js/test-cleaning-schedule-api.mjs

import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

register(new URL('./resolver.mjs', import.meta.url));

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-cleansched-api-'));
const TMP_DB = path.join(TMP_DIR, 'lariat-test.db');

const db = await import('../../lib/db.ts');
db.setDbPathForTest(TMP_DB);
const testDb = db.getDb();

const route = await import('../../app/api/cleaning-schedule/route.js');

after(() => {
  db.setDbPathForTest(null);
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

beforeEach(() => {
  testDb.exec(`DELETE FROM cleaning_schedule;`);
});

// ── Sanity: schema has the columns we expect ───────────────────────

describe('schema', () => {
  it('cleaning_schedule has expected columns incl. archived_at', () => {
    const cols = testDb.prepare(`PRAGMA table_info(cleaning_schedule)`).all()
      .map((c) => c.name);
    for (const required of [
      'id', 'location_id', 'area', 'task', 'frequency', 'last_done',
      'next_due', 'notes', 'active', 'created_at', 'archived_at',
    ]) {
      assert.ok(cols.includes(required), `missing column: ${required}`);
    }
  });
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
  const res = await route.POST(
    jsonReq('POST', 'http://localhost/api/cleaning-schedule', payload),
  );
  assert.strictEqual(res.status, 200, `POST expected 200, got ${res.status}`);
  const j = await res.json();
  return j.row;
}

function selectById(id) {
  return testDb.prepare('SELECT * FROM cleaning_schedule WHERE id = ?').get(id);
}

const base = (over = {}) => ({
  area: 'Line',
  task: 'Deep clean flat-top',
  frequency: 'weekly',
  ...over,
});

// ── GET ───────────────────────────────────────────────────────────

describe('GET /api/cleaning-schedule', () => {
  it('default call hides archived rows (archived_at IS NULL only)', async () => {
    const live = await postRow(base({ location_id: 'default', task: 'Wipe line' }));
    const retired = await postRow(base({ location_id: 'default', task: 'Clean hood' }));
    await route.DELETE(jsonReq(
      'DELETE', 'http://localhost/api/cleaning-schedule', { id: retired.id },
    ));

    const res = await route.GET(getReq(
      'http://localhost/api/cleaning-schedule?location=default',
    ));
    assert.strictEqual(res.status, 200);
    const j = await res.json();
    assert.strictEqual(j.rows.length, 1);
    assert.strictEqual(j.rows[0].id, live.id);
    assert.strictEqual(j.rows[0].archived_at, null);
  });

  it('?includeArchived=1 returns both live and archived rows', async () => {
    const live = await postRow(base({ location_id: 'default', task: 'Wipe line' }));
    const retired = await postRow(base({ location_id: 'default', task: 'Clean hood' }));
    await route.DELETE(jsonReq(
      'DELETE', 'http://localhost/api/cleaning-schedule', { id: retired.id },
    ));

    const res = await route.GET(getReq(
      'http://localhost/api/cleaning-schedule?location=default&includeArchived=1',
    ));
    const j = await res.json();
    const ids = j.rows.map((r) => r.id).sort((a, b) => a - b);
    assert.deepStrictEqual(ids, [live.id, retired.id].sort((a, b) => a - b));
    const retRow = j.rows.find((r) => r.id === retired.id);
    assert.ok(retRow.archived_at, 'archived_at should be set on retired row');
    assert.strictEqual(retRow.active, 0);
  });

  it('scopes by location_id (other locations not returned)', async () => {
    await postRow(base({ location_id: 'default', task: 'Wipe line' }));
    await postRow(base({ location_id: 'downtown', task: 'Wipe line' }));

    const res = await route.GET(getReq(
      'http://localhost/api/cleaning-schedule?location=downtown',
    ));
    const j = await res.json();
    assert.strictEqual(j.rows.length, 1);
    assert.strictEqual(j.rows[0].location_id, 'downtown');
  });
});

// ── POST ───────────────────────────────────────────────────────────

describe('POST /api/cleaning-schedule', () => {
  it('creates a row with active=1 and archived_at=NULL', async () => {
    const res = await route.POST(jsonReq(
      'POST', 'http://localhost/api/cleaning-schedule', {
        location_id: 'default',
        area: 'Walk-in',
        task: 'Sanitize shelves',
        frequency: 'weekly',
        last_done: '2026-04-10',
        next_due: '2026-04-17',
        notes: 'rotate with produce check',
      },
    ));
    assert.strictEqual(res.status, 200);
    const j = await res.json();
    assert.ok(j.row?.id);
    assert.strictEqual(j.row.active, 1);
    assert.strictEqual(j.row.archived_at, null);
    assert.strictEqual(j.row.area, 'Walk-in');
    assert.strictEqual(j.row.task, 'Sanitize shelves');
    assert.strictEqual(j.row.frequency, 'weekly');
    assert.strictEqual(j.row.last_done, '2026-04-10');
    assert.strictEqual(j.row.next_due, '2026-04-17');
    assert.strictEqual(j.row.notes, 'rotate with produce check');
  });

  it('defaults location_id to "default" when omitted', async () => {
    const row = await postRow(base({ area: 'FOH', task: 'Vacuum', frequency: 'daily' }));
    assert.strictEqual(row.location_id, 'default');
  });

  it('accepts empty last_done / next_due as null', async () => {
    const row = await postRow(base({
      last_done: '',
      next_due: '',
    }));
    assert.strictEqual(row.last_done, null);
    assert.strictEqual(row.next_due, null);
  });

  it('rejects missing area with 400', async () => {
    const res = await route.POST(jsonReq(
      'POST', 'http://localhost/api/cleaning-schedule', {
        task: 'Wipe', frequency: 'daily',
      },
    ));
    assert.strictEqual(res.status, 400);
    const j = await res.json();
    assert.match(String(j.error || ''), /area/);
  });

  it('rejects missing task with 400', async () => {
    const res = await route.POST(jsonReq(
      'POST', 'http://localhost/api/cleaning-schedule', {
        area: 'Line', frequency: 'daily',
      },
    ));
    assert.strictEqual(res.status, 400);
    const j = await res.json();
    assert.match(String(j.error || ''), /task/);
  });

  it('rejects missing frequency with 400', async () => {
    const res = await route.POST(jsonReq(
      'POST', 'http://localhost/api/cleaning-schedule', {
        area: 'Line', task: 'Wipe',
      },
    ));
    assert.strictEqual(res.status, 400);
    const j = await res.json();
    assert.match(String(j.error || ''), /frequency/);
  });

  it('rejects whitespace-only area/task/frequency with 400', async () => {
    for (const field of ['area', 'task', 'frequency']) {
      const payload = base();
      payload[field] = '   ';
      const res = await route.POST(jsonReq(
        'POST', 'http://localhost/api/cleaning-schedule', payload,
      ));
      assert.strictEqual(res.status, 400, `expected 400 for blank ${field}`);
    }
  });

  it('clips over-long string fields', async () => {
    const big = 'x'.repeat(600);
    const row = await postRow({
      area: big,
      task: big,
      frequency: big,
      last_done: big,
      next_due: big,
      notes: big,
    });
    assert.strictEqual(row.area.length, 120);
    assert.strictEqual(row.task.length, 240);
    assert.strictEqual(row.frequency.length, 64);
    assert.strictEqual(row.last_done.length, 32);
    assert.strictEqual(row.next_due.length, 32);
    assert.strictEqual(row.notes.length, 500);
  });

  it('rejects empty-string location_id with 400 (no silent default substitution)', async () => {
    const res = await route.POST(jsonReq(
      'POST', 'http://localhost/api/cleaning-schedule', {
        location_id: '',
        area: 'Line', task: 'Wipe', frequency: 'daily',
      },
    ));
    assert.strictEqual(res.status, 400);
    const j = await res.json();
    assert.match(String(j.error || ''), /location_id/);
  });
});

// ── PATCH ──────────────────────────────────────────────────────────

describe('PATCH /api/cleaning-schedule', () => {
  it('updates supplied fields and leaves others alone', async () => {
    const row = await postRow(base({
      area: 'Line',
      task: 'Deep clean flat-top',
      frequency: 'weekly',
      last_done: '2026-04-01',
      next_due: '2026-04-08',
      notes: 'old',
    }));

    const res = await route.PATCH(jsonReq(
      'PATCH', 'http://localhost/api/cleaning-schedule', {
        id: row.id,
        next_due: '2026-04-15',
        notes: 'new',
      },
    ));
    assert.strictEqual(res.status, 200);
    const j = await res.json();
    assert.strictEqual(j.row.next_due, '2026-04-15');
    assert.strictEqual(j.row.notes, 'new');
    assert.strictEqual(j.row.last_done, '2026-04-01');
    assert.strictEqual(j.row.frequency, 'weekly');
    assert.strictEqual(j.row.task, 'Deep clean flat-top');
    assert.strictEqual(j.row.area, 'Line');
  });

  it('supports partial patch of just last_done', async () => {
    const row = await postRow(base());
    const res = await route.PATCH(jsonReq(
      'PATCH', 'http://localhost/api/cleaning-schedule', {
        id: row.id,
        last_done: '2026-04-20',
      },
    ));
    assert.strictEqual(res.status, 200);
    const j = await res.json();
    assert.strictEqual(j.row.last_done, '2026-04-20');
  });

  it('allows clearing last_done/next_due by sending empty string', async () => {
    const row = await postRow(base({ last_done: '2026-04-01', next_due: '2026-04-08' }));
    const res = await route.PATCH(jsonReq(
      'PATCH', 'http://localhost/api/cleaning-schedule', {
        id: row.id,
        last_done: '',
        next_due: '',
      },
    ));
    assert.strictEqual(res.status, 200);
    const j = await res.json();
    assert.strictEqual(j.row.last_done, null);
    assert.strictEqual(j.row.next_due, null);
  });

  it('rejects missing id with 400', async () => {
    const res = await route.PATCH(jsonReq(
      'PATCH', 'http://localhost/api/cleaning-schedule', {
        notes: 'nope',
      },
    ));
    assert.strictEqual(res.status, 400);
  });

  it('returns 404 when id does not exist', async () => {
    const res = await route.PATCH(jsonReq(
      'PATCH', 'http://localhost/api/cleaning-schedule', {
        id: 999999, notes: 'nope',
      },
    ));
    assert.strictEqual(res.status, 404);
  });

  it('rejects blanking required fields (area/task/frequency) with 400', async () => {
    const row = await postRow(base());
    for (const field of ['area', 'task', 'frequency']) {
      const res = await route.PATCH(jsonReq(
        'PATCH', 'http://localhost/api/cleaning-schedule', {
          id: row.id, [field]: '',
        },
      ));
      assert.strictEqual(res.status, 400, `expected 400 blanking ${field}`);
      const after = selectById(row.id);
      assert.ok(after[field], `${field} must not be wiped`);
    }
  });

  it('returns 400 when no editable fields are supplied', async () => {
    const row = await postRow(base());
    const res = await route.PATCH(jsonReq(
      'PATCH', 'http://localhost/api/cleaning-schedule', {
        id: row.id,
      },
    ));
    assert.strictEqual(res.status, 400);
  });

  it('silently ignores body.location_id (not a PATCH-able field; row stays put)', async () => {
    // location_id is row-identity, not a mutable property — see
    // test-cleaning-schedule-patch-location-immutable.mjs for the full
    // security regression suite. Here we just pin that the existing PATCH
    // contract no longer treats location_id as editable: any value
    // (empty, blank, or a different site) is silently dropped.
    const row = await postRow(base({ location_id: 'downtown' }));
    const res = await route.PATCH(jsonReq(
      'PATCH', 'http://localhost/api/cleaning-schedule', {
        id: row.id,
        location_id: '',
      },
    ));
    // Body has only {id, location_id} now — location_id is no longer
    // counted as an editable field, so we get the standard "no editable
    // fields supplied" 400 instead of a location-specific error.
    assert.strictEqual(res.status, 400);
    const j = await res.json();
    assert.match(String(j.error || ''), /no editable fields supplied/);
    // The row must not have been silently moved or blanked.
    const after = selectById(row.id);
    assert.strictEqual(after.location_id, 'downtown');
  });
});

// ── DELETE (soft) ──────────────────────────────────────────────────

describe('DELETE /api/cleaning-schedule', () => {
  it('soft-deletes: sets active=0 AND archived_at is stamped', async () => {
    const row = await postRow(base());

    const res = await route.DELETE(jsonReq(
      'DELETE', 'http://localhost/api/cleaning-schedule', { id: row.id },
    ));
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
    const res = await route.DELETE(jsonReq(
      'DELETE', 'http://localhost/api/cleaning-schedule', {},
    ));
    assert.strictEqual(res.status, 400);
  });

  it('returns 404 when id does not exist', async () => {
    const res = await route.DELETE(jsonReq(
      'DELETE', 'http://localhost/api/cleaning-schedule', { id: 999999 },
    ));
    assert.strictEqual(res.status, 404);
  });
});

// ── Resurrection: PATCH {id, active: 1} on an archived row ─────────

describe('PATCH active=1 on archived row (resurrection)', () => {
  it('clears archived_at back to NULL, restores to default GET', async () => {
    const row = await postRow(base());

    // Archive it.
    await route.DELETE(jsonReq(
      'DELETE', 'http://localhost/api/cleaning-schedule', { id: row.id },
    ));
    const archived = selectById(row.id);
    assert.strictEqual(archived.active, 0);
    assert.ok(archived.archived_at);

    // Resurrect.
    const res = await route.PATCH(jsonReq(
      'PATCH', 'http://localhost/api/cleaning-schedule', {
        id: row.id, active: 1,
      },
    ));
    assert.strictEqual(res.status, 200);
    const j = await res.json();
    assert.strictEqual(j.row.active, 1);
    assert.strictEqual(j.row.archived_at, null);

    // Double-check the DB reflects the same.
    const raw = selectById(row.id);
    assert.strictEqual(raw.active, 1);
    assert.strictEqual(raw.archived_at, null);

    // GET (default, no includeArchived) should now show it again.
    const getRes = await route.GET(getReq(
      'http://localhost/api/cleaning-schedule?location=default',
    ));
    const getJ = await getRes.json();
    assert.ok(
      getJ.rows.some((r) => r.id === row.id),
      'resurrected row visible in default GET',
    );
  });
});
