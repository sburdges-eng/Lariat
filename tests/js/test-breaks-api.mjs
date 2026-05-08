#!/usr/bin/env node
// Integration tests for /api/breaks (L1 / CO COMPS #39).
//
// Pure rules covered by test-break-rules.mjs; this file exercises the
// API surface with focus on the cross-location IDOR guard added on
// 2026-05-08 to PATCH (the end-break path), which prior to the fix
// allowed a cook scoped to site-A to end a break belonging to site-B
// by guessing the numeric id.
//
// Run: node --experimental-strip-types --test tests/js/test-breaks-api.mjs

import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

register(new URL('./resolver.mjs', import.meta.url));

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-breaks-api-'));
const TMP_DB = path.join(TMP_DIR, 'lariat-test.db');

const db = await import('../../lib/db.ts');
const route = await import('../../app/api/breaks/route.js');

db.setDbPathForTest(TMP_DB);
const testDb = db.getDb();

const { POST, PATCH } = route;

after(() => {
  db.setDbPathForTest(null);
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

beforeEach(() => {
  testDb.exec('DELETE FROM shift_breaks; DELETE FROM audit_events;');
});

const T_START = '2026-04-20T10:00:00.000Z';
const T_END = '2026-04-20T10:30:00.000Z';

function postReq(body) {
  return new Request('http://localhost/api/breaks', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function patchReq(body, { location } = {}) {
  const url = location
    ? `http://localhost/api/breaks?location=${encodeURIComponent(location)}`
    : 'http://localhost/api/breaks';
  return new Request(url, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function openBreakAt(locationId) {
  const res = await POST(postReq({
    kind: 'rest',
    cook_id: 'alice',
    started_at: T_START,
    location_id: locationId,
  }));
  return (await res.json()).entry.id;
}

describe('POST /api/breaks — happy path', () => {
  it('opens a break and emits one audit insert', async () => {
    const res = await POST(postReq({
      kind: 'rest',
      cook_id: 'alice',
      started_at: T_START,
    }));
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.ok, true);
    assert.strictEqual(body.entry.kind, 'rest');
    assert.strictEqual(body.entry.ended_at, null);

    const inserts = testDb
      .prepare(`SELECT COUNT(*) AS c FROM audit_events WHERE entity='shift_breaks' AND action='insert'`)
      .get().c;
    assert.strictEqual(inserts, 1);
  });
});

// ─────────────────────────────────────────────────────────────────
// PATCH /api/breaks — cross-location IDOR guard (2026-05-08 fix)
//
// A cook scoped to site-A must not be able to end a break that
// belongs to site-B by guessing the numeric id. Surfaced as 404
// (not 403) so existence at another site does not leak.
// ─────────────────────────────────────────────────────────────────

describe('PATCH /api/breaks — cross-location IDOR guard', () => {
  it('404 when caller location does not match the row location', async () => {
    const id = await openBreakAt('site-b');

    const res = await PATCH(patchReq({ id, ended_at: T_END }, { location: 'site-a' }));
    assert.strictEqual(res.status, 404);

    // The break is still open at site-b.
    const row = testDb
      .prepare('SELECT ended_at, duration_min FROM shift_breaks WHERE id=?')
      .get(id);
    assert.strictEqual(row.ended_at, null);
    assert.strictEqual(row.duration_min, null);

    // No update audit was emitted.
    const updates = testDb
      .prepare(`SELECT COUNT(*) AS c FROM audit_events WHERE entity='shift_breaks' AND action='update'`)
      .get().c;
    assert.strictEqual(updates, 0);
  });

  it('200 when caller location matches the row location', async () => {
    const id = await openBreakAt('site-b');

    const res = await PATCH(patchReq({ id, ended_at: T_END }, { location: 'site-b' }));
    assert.strictEqual(res.status, 200);

    const row = testDb
      .prepare('SELECT ended_at, duration_min FROM shift_breaks WHERE id=?')
      .get(id);
    assert.strictEqual(row.ended_at, T_END);
    assert.strictEqual(row.duration_min, 30);

    const updates = testDb
      .prepare(`SELECT COUNT(*) AS c FROM audit_events WHERE entity='shift_breaks' AND action='update'`)
      .get().c;
    assert.strictEqual(updates, 1);
  });

  it('mutation defaults to "default" location when ?location= is absent', async () => {
    // Row at non-default site; no ?location= → caller defaults to
    // 'default' → IDOR guard fires → 404.
    const id = await openBreakAt('site-b');

    const res = await PATCH(patchReq({ id, ended_at: T_END }));
    assert.strictEqual(res.status, 404);

    const row = testDb
      .prepare('SELECT ended_at FROM shift_breaks WHERE id=?')
      .get(id);
    assert.strictEqual(row.ended_at, null);
  });
});
