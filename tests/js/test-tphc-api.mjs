#!/usr/bin/env node
// Integration tests for /api/tphc — Time as Public Health Control
// (FDA §3-501.19). Covers POST (start) / PATCH (discard) / GET (scan)
// against a real temp better-sqlite3 DB. Mirrors the setup used by
// test-receiving-api.mjs and the audit-rollback simulation used by
// test-haccp-audit-atomicity.mjs.
//
// The pure rule module (lib/tphc.ts) is covered by test-tphc-rules.mjs;
// this file only exercises route-level behavior.
//
// Run: node --test tests/js/test-tphc-api.mjs

import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

register(new URL('./resolver.mjs', import.meta.url));

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-tphc-api-'));
const TMP_DB = path.join(TMP_DIR, 'lariat-test.db');

const db = await import('../../lib/db.ts');
const route = await import('../../app/api/tphc/route.js');

db.setDbPathForTest(TMP_DB);
const testDb = db.getDb();

const { POST, PATCH, GET } = route;
const { todayISO } = db;

// Fixed reference instants so cutoff math can be asserted exactly.
// Using Z suffix ensures the route's clip() doesn't trim offset.
const T0 = '2026-04-20T10:00:00.000Z';
const T0_HOT_CUTOFF = '2026-04-20T14:00:00.000Z';   // +4h
const T0_COLD_CUTOFF = '2026-04-20T16:00:00.000Z';  // +6h

after(() => {
  db.setDbPathForTest(null);
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

beforeEach(() => {
  testDb.exec('DELETE FROM tphc_entries; DELETE FROM audit_events;');
});

// ── Helpers ───────────────────────────────────────────────────────

function postReq(body) {
  return new Request('http://localhost/api/tphc', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function patchReq(body) {
  return new Request('http://localhost/api/tphc', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function getReq(qs = '') {
  return new Request(`http://localhost/api/tphc${qs}`);
}

function countTphc(where = '') {
  return testDb.prepare(`SELECT COUNT(*) AS c FROM tphc_entries ${where}`).get().c;
}

function countAuditByAction(action) {
  return testDb
    .prepare(`SELECT COUNT(*) AS c FROM audit_events WHERE entity='tphc_entries' AND action=?`)
    .get(action).c;
}

// ─────────────────────────────────────────────────────────────────
// POST — happy paths
// ─────────────────────────────────────────────────────────────────

describe('POST /api/tphc — happy paths', () => {
  it('kind=hot_time_only persists row with cutoff_at = started_at + 4h', async () => {
    const res = await POST(postReq({
      item: 'taco bar proteins',
      started_at: T0,
      kind: 'hot_time_only',
      cook_id: 'alice',
    }));
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.ok, true);
    assert.strictEqual(body.kind, 'hot_time_only');
    assert.strictEqual(body.cutoff_at, T0_HOT_CUTOFF);
    assert.strictEqual(body.entry.started_at, T0);
    assert.strictEqual(body.entry.cutoff_at, T0_HOT_CUTOFF);
    assert.strictEqual(body.entry.item, 'taco bar proteins');
    assert.strictEqual(countTphc(), 1);
  });

  it('kind=cold_time_only persists row with cutoff_at = started_at + 6h', async () => {
    const res = await POST(postReq({
      item: 'sliced tomato mise',
      started_at: T0,
      kind: 'cold_time_only',
      cook_id: 'bob',
    }));
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.kind, 'cold_time_only');
    assert.strictEqual(body.cutoff_at, T0_COLD_CUTOFF);
    assert.strictEqual(body.entry.cutoff_at, T0_COLD_CUTOFF);
    assert.strictEqual(countTphc(), 1);
  });

  it('batch_ref and station_id round-trip when provided', async () => {
    await POST(postReq({
      item: 'carnitas',
      started_at: T0,
      kind: 'hot_time_only',
      batch_ref: 'BATCH-2026-04-20-A',
      station_id: 'hot_hold_1',
      cook_id: 'alice',
    }));
    const row = testDb.prepare('SELECT * FROM tphc_entries').get();
    assert.strictEqual(row.batch_ref, 'BATCH-2026-04-20-A');
    assert.strictEqual(row.station_id, 'hot_hold_1');
  });

  it('shift_date defaults to todayISO() when omitted', async () => {
    await POST(postReq({
      item: 'queso',
      started_at: T0,
      kind: 'hot_time_only',
    }));
    const row = testDb.prepare('SELECT * FROM tphc_entries').get();
    assert.strictEqual(row.shift_date, todayISO());
  });

  it('shift_date honors explicit value when provided', async () => {
    await POST(postReq({
      item: 'queso',
      started_at: T0,
      kind: 'hot_time_only',
      shift_date: '2026-04-19',
    }));
    const row = testDb.prepare('SELECT * FROM tphc_entries').get();
    assert.strictEqual(row.shift_date, '2026-04-19');
  });

  it('response body shape = { ok, entry, kind, cutoff_at }', async () => {
    const res = await POST(postReq({
      item: 'sliced melon',
      started_at: T0,
      kind: 'cold_time_only',
    }));
    const body = await res.json();
    assert.deepStrictEqual(
      Object.keys(body).sort(),
      ['cutoff_at', 'entry', 'kind', 'ok'],
    );
    assert.strictEqual(typeof body.entry.id, 'number');
  });
});

// ─────────────────────────────────────────────────────────────────
// POST — validation (400)
// ─────────────────────────────────────────────────────────────────

describe('POST /api/tphc — validation', () => {
  it('400 when item is empty string', async () => {
    const res = await POST(postReq({
      item: '',
      started_at: T0,
      kind: 'hot_time_only',
    }));
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /Item is required/);
    assert.strictEqual(countTphc(), 0);
  });

  it('400 when item is whitespace-only', async () => {
    const res = await POST(postReq({
      item: '   ',
      started_at: T0,
      kind: 'hot_time_only',
    }));
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /Item is required/);
  });

  it('400 when started_at is missing', async () => {
    const res = await POST(postReq({
      item: 'taco bar',
      kind: 'hot_time_only',
    }));
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /started_at/);
    assert.strictEqual(countTphc(), 0);
  });

  it('400 when started_at is a non-ISO phrase ("yesterday")', async () => {
    const res = await POST(postReq({
      item: 'taco bar',
      started_at: 'yesterday',
      kind: 'hot_time_only',
    }));
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /started_at/);
  });

  it('400 when started_at is date-only (no time component)', async () => {
    const res = await POST(postReq({
      item: 'taco bar',
      started_at: '2026-04-24',
      kind: 'hot_time_only',
    }));
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /started_at/);
  });

  it('400 when kind is unknown ("warm_time_only")', async () => {
    const res = await POST(postReq({
      item: 'taco bar',
      started_at: T0,
      kind: 'warm_time_only',
    }));
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /kind must be one of/);
    assert.match(body.error, /hot_time_only/);
    assert.match(body.error, /cold_time_only/);
  });

  it('400 when kind is missing entirely', async () => {
    const res = await POST(postReq({
      item: 'taco bar',
      started_at: T0,
    }));
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /kind must be one of/);
  });
});

// ─────────────────────────────────────────────────────────────────
// POST — audit atomicity
// ─────────────────────────────────────────────────────────────────

describe('POST /api/tphc — audit atomicity', () => {
  it('every successful insert emits exactly one audit row (action=insert, matching entity_id, kind+cutoff in note)', async () => {
    const res = await POST(postReq({
      item: 'taco bar',
      started_at: T0,
      kind: 'hot_time_only',
      cook_id: 'alice',
    }));
    assert.strictEqual(res.status, 200);
    const body = await res.json();

    assert.strictEqual(countTphc(), 1);
    assert.strictEqual(countAuditByAction('insert'), 1);

    const audit = testDb
      .prepare(`SELECT * FROM audit_events WHERE entity='tphc_entries' AND action='insert'`)
      .get();
    assert.strictEqual(audit.entity, 'tphc_entries');
    assert.strictEqual(audit.action, 'insert');
    assert.strictEqual(Number(audit.entity_id), body.entry.id);
    assert.strictEqual(audit.actor_cook_id, 'alice');
    assert.strictEqual(audit.actor_source, 'cook_ui');
    assert.match(audit.note, /hot_time_only/);
    assert.match(audit.note, new RegExp(T0_HOT_CUTOFF.replace(/\./g, '\\.')));
  });

  it('rollback: drop audit_events mid-flight → tphc_entries insert rolls back (zero stranded rows)', async () => {
    testDb.exec(`ALTER TABLE audit_events RENAME TO audit_events_stash`);
    try {
      const before = countTphc();
      const res = await POST(postReq({
        item: 'taco bar',
        started_at: T0,
        kind: 'hot_time_only',
        cook_id: 'alice',
      }));
      assert.strictEqual(res.status, 500, 'route must 500 when audit write fails');
      assert.strictEqual(countTphc(), before, 'tphc_entries must be rolled back — no stranded rows');
    } finally {
      testDb.exec(`ALTER TABLE audit_events_stash RENAME TO audit_events`);
    }
  });
});

// ─────────────────────────────────────────────────────────────────
// PATCH — discard flow
// ─────────────────────────────────────────────────────────────────

describe('PATCH /api/tphc — discard flow', () => {
  // Helper: insert a fresh batch via POST and return its id.
  async function startBatch(overrides = {}) {
    const res = await POST(postReq({
      item: 'taco bar',
      started_at: T0,
      kind: 'hot_time_only',
      ...overrides,
    }));
    const body = await res.json();
    return body.entry.id;
  }

  for (const reason of ['reached_cutoff', 'consumed', 'quality', 'contamination']) {
    it(`discard_reason='${reason}' → discarded_at set, reason persisted, audit action=update`, async () => {
      const id = await startBatch();
      // Clear audit so we only count the PATCH's event.
      testDb.exec(`DELETE FROM audit_events`);

      const res = await PATCH(patchReq({ id, discard_reason: reason, cook_id: 'alice' }));
      assert.strictEqual(res.status, 200);
      const body = await res.json();
      assert.strictEqual(body.ok, true);
      assert.strictEqual(body.entry.discard_reason, reason);
      assert.ok(body.entry.discarded_at, 'discarded_at must be populated');

      const row = testDb.prepare('SELECT * FROM tphc_entries WHERE id=?').get(id);
      assert.strictEqual(row.discard_reason, reason);
      assert.ok(row.discarded_at);

      assert.strictEqual(countAuditByAction('update'), 1);
      const audit = testDb
        .prepare(`SELECT * FROM audit_events WHERE entity='tphc_entries' AND action='update'`)
        .get();
      assert.strictEqual(Number(audit.entity_id), id);
      assert.match(audit.note, new RegExp(reason));
    });
  }

  it('400 when discard_reason is missing', async () => {
    const id = await startBatch();
    const res = await PATCH(patchReq({ id }));
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /discard_reason must be one of/);
  });

  it('400 when discard_reason is unknown', async () => {
    const id = await startBatch();
    const res = await PATCH(patchReq({ id, discard_reason: 'bored_of_it' }));
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /discard_reason must be one of/);
  });

  it('400 when id is missing', async () => {
    const res = await PATCH(patchReq({ discard_reason: 'consumed' }));
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /id is required/);
  });

  it('400 when id is non-numeric', async () => {
    const res = await PATCH(patchReq({ id: 'abc', discard_reason: 'consumed' }));
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /id is required/);
  });

  it('400 when id is zero / negative', async () => {
    const res = await PATCH(patchReq({ id: 0, discard_reason: 'consumed' }));
    assert.strictEqual(res.status, 400);
  });

  it('404 when id does not exist', async () => {
    const res = await PATCH(patchReq({ id: 9999, discard_reason: 'consumed' }));
    assert.strictEqual(res.status, 404);
    const body = await res.json();
    assert.match(body.error, /unknown tphc entry/);
  });

  it('409 on double-discard attempt', async () => {
    const id = await startBatch();
    const first = await PATCH(patchReq({ id, discard_reason: 'consumed' }));
    assert.strictEqual(first.status, 200);

    const second = await PATCH(patchReq({ id, discard_reason: 'quality' }));
    assert.strictEqual(second.status, 409);
    const body = await second.json();
    assert.match(body.error, /already discarded/);
    assert.ok(body.entry, '409 body should include the existing entry');

    // And the reason didn't change.
    const row = testDb.prepare('SELECT * FROM tphc_entries WHERE id=?').get(id);
    assert.strictEqual(row.discard_reason, 'consumed');
  });

  it('rollback: drop audit_events mid-PATCH → tphc_entries update rolls back (discarded_at stays NULL)', async () => {
    const id = await startBatch();
    // Baseline: no discard yet.
    assert.strictEqual(
      testDb.prepare('SELECT discarded_at FROM tphc_entries WHERE id=?').get(id).discarded_at,
      null,
    );
    testDb.exec(`ALTER TABLE audit_events RENAME TO audit_events_stash`);
    try {
      const res = await PATCH(patchReq({ id, discard_reason: 'consumed' }));
      assert.strictEqual(res.status, 500, 'PATCH must 500 when audit write fails');
      const row = testDb.prepare('SELECT * FROM tphc_entries WHERE id=?').get(id);
      assert.strictEqual(row.discarded_at, null, 'discarded_at must remain NULL after rollback');
      assert.strictEqual(row.discard_reason, null, 'discard_reason must remain NULL after rollback');
    } finally {
      testDb.exec(`ALTER TABLE audit_events_stash RENAME TO audit_events`);
    }
  });
});

// ─────────────────────────────────────────────────────────────────
// GET — shape + scan
// ─────────────────────────────────────────────────────────────────

describe('GET /api/tphc — shape + scan', () => {
  it('empty state returns expected envelope keys', async () => {
    const res = await GET(getReq());
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.deepStrictEqual(
      Object.keys(body).sort(),
      ['active', 'discard_reasons', 'kinds', 'location_id', 'now', 'scan'],
    );
    assert.deepStrictEqual(body.kinds, ['hot_time_only', 'cold_time_only']);
    assert.deepStrictEqual(body.discard_reasons, [
      'reached_cutoff', 'consumed', 'quality', 'contamination',
    ]);
    assert.deepStrictEqual(body.active, []);
    assert.deepStrictEqual(body.scan, []);
  });

  it('active excludes discarded rows', async () => {
    // Start two batches; discard one.
    const r1 = await POST(postReq({ item: 'a', started_at: T0, kind: 'hot_time_only' }));
    const b1 = await r1.json();
    await POST(postReq({ item: 'b', started_at: T0, kind: 'cold_time_only' }));
    await PATCH(patchReq({ id: b1.entry.id, discard_reason: 'consumed' }));

    const res = await GET(getReq());
    const body = await res.json();
    assert.strictEqual(body.active.length, 1);
    assert.strictEqual(body.active[0].item, 'b');
    assert.strictEqual(body.active[0].discarded_at, null);
  });

  it('?now= threads through; scan spot-check matches scanActiveTphc classification', async () => {
    // Hot batch started at T0; cutoff T0+4h = 14:00Z.
    await POST(postReq({ item: 'hot', started_at: T0, kind: 'hot_time_only' }));
    // Cold batch started at T0; cutoff T0+6h = 16:00Z.
    await POST(postReq({ item: 'cold', started_at: T0, kind: 'cold_time_only' }));

    // now = 11:00Z → hot has 180m left (ok), cold has 300m (ok).
    let res = await GET(getReq(`?now=${encodeURIComponent('2026-04-20T11:00:00.000Z')}`));
    let body = await res.json();
    assert.strictEqual(body.now, '2026-04-20T11:00:00.000Z');
    assert.strictEqual(body.scan.length, 2);
    for (const s of body.scan) assert.strictEqual(s.status, 'ok');

    // now = 13:45Z → hot has 15m left (warning); cold has 135m (ok).
    res = await GET(getReq(`?now=${encodeURIComponent('2026-04-20T13:45:00.000Z')}`));
    body = await res.json();
    const hot1 = body.scan.find((x) => x.item === 'hot');
    const cold1 = body.scan.find((x) => x.item === 'cold');
    assert.strictEqual(hot1.status, 'warning');
    assert.strictEqual(hot1.minutes_until_cutoff, 15);
    assert.strictEqual(cold1.status, 'ok');

    // now = 15:00Z → hot expired (-60m); cold warning? actually 60m, still ok.
    res = await GET(getReq(`?now=${encodeURIComponent('2026-04-20T15:00:00.000Z')}`));
    body = await res.json();
    const hot2 = body.scan.find((x) => x.item === 'hot');
    const cold2 = body.scan.find((x) => x.item === 'cold');
    assert.strictEqual(hot2.status, 'expired');
    assert.ok(hot2.minutes_until_cutoff <= 0);
    assert.strictEqual(cold2.status, 'ok');
    // Sort order: most-past-due first.
    assert.strictEqual(body.scan[0].item, 'hot');
  });

  it('location scoping — default GET excludes lariat-south rows', async () => {
    await POST(postReq({
      item: 'south batch',
      started_at: T0,
      kind: 'hot_time_only',
      location_id: 'lariat-south',
    }));
    const res = await GET(getReq());
    const body = await res.json();
    assert.strictEqual(body.location_id, 'default');
    assert.strictEqual(body.active.length, 0);
    assert.strictEqual(body.scan.length, 0);
  });
});

// ─────────────────────────────────────────────────────────────────
// Location scoping cross-cut
// ─────────────────────────────────────────────────────────────────

describe('/api/tphc — location scoping cross-cut', () => {
  it('POST with location_id=lariat-south persists only to that location; GET scopes correctly', async () => {
    // Two rows: one south, one default.
    await POST(postReq({
      item: 'south batch',
      started_at: T0,
      kind: 'hot_time_only',
      location_id: 'lariat-south',
    }));
    await POST(postReq({
      item: 'default batch',
      started_at: T0,
      kind: 'hot_time_only',
    }));

    assert.strictEqual(countTphc(`WHERE location_id='lariat-south'`), 1);
    assert.strictEqual(countTphc(`WHERE location_id='default'`), 1);

    const southRes = await GET(getReq('?location=lariat-south'));
    const southBody = await southRes.json();
    assert.strictEqual(southBody.location_id, 'lariat-south');
    assert.strictEqual(southBody.active.length, 1);
    assert.strictEqual(southBody.active[0].item, 'south batch');

    const defRes = await GET(getReq());
    const defBody = await defRes.json();
    assert.strictEqual(defBody.active.length, 1);
    assert.strictEqual(defBody.active[0].item, 'default batch');
  });

  it('?location_id= alias works identically to ?location=', async () => {
    await POST(postReq({
      item: 'south batch',
      started_at: T0,
      kind: 'hot_time_only',
      location_id: 'lariat-south',
    }));
    const res = await GET(getReq('?location_id=lariat-south'));
    const body = await res.json();
    assert.strictEqual(body.location_id, 'lariat-south');
    assert.strictEqual(body.active.length, 1);
  });
});
