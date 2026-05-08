#!/usr/bin/env node
// Integration tests for /api/eighty-six and /api/eighty-six/resolve.
//
// Focus on the 2026-05-08 fixes to the resolve route:
//   1. Cross-location IDOR — the previous shape derived `loc` from
//      body.location_id, which let a caller assert the target row's
//      location and bypass the WHERE clause guard. Now the location
//      comes from ?location= via locationFromRequest.
//   2. Missing audit emission — the resolve UPDATE now writes an
//      audit_events row inside the same db.transaction.
//
// Run: node --experimental-strip-types --test tests/js/test-eighty-six-api.mjs

import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

register(new URL('./resolver.mjs', import.meta.url));

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-eighty-six-api-'));
const TMP_DB = path.join(TMP_DIR, 'lariat-test.db');

const db = await import('../../lib/db.ts');
const eightySixRoute = await import('../../app/api/eighty-six/route.js');
const resolveRoute = await import('../../app/api/eighty-six/resolve/route.js');

db.setDbPathForTest(TMP_DB);
const testDb = db.getDb();

const { POST: createPOST } = eightySixRoute;
const { POST: resolvePOST } = resolveRoute;

after(() => {
  db.setDbPathForTest(null);
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

beforeEach(() => {
  testDb.exec('DELETE FROM eighty_six; DELETE FROM audit_events;');
});

function createReq(body) {
  return new Request('http://localhost/api/eighty-six', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function resolveReq(body, { location } = {}) {
  const url = location
    ? `http://localhost/api/eighty-six/resolve?location=${encodeURIComponent(location)}`
    : 'http://localhost/api/eighty-six/resolve';
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function openEightySix({ item = 'salmon', locationId = 'default' } = {}) {
  const res = await createPOST(createReq({
    item,
    reason: 'out',
    cook_id: 'alice',
    location_id: locationId,
  }));
  return (await res.json()).id;
}

describe('POST /api/eighty-six/resolve — happy path', () => {
  it('marks the row resolved and emits an audit update inside the same transaction', async () => {
    const id = await openEightySix();

    const res = await resolvePOST(resolveReq({ id, cook_id: 'alice' }));
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.ok, true);
    assert.ok(body.entry.resolved_at);
    assert.strictEqual(body.entry.resolved_by, 'alice');

    // Audit update emitted (the bug pre-fix was that resolve was silent).
    const audits = testDb
      .prepare(`SELECT * FROM audit_events WHERE entity='eighty_six' AND action='update'`)
      .all();
    assert.strictEqual(audits.length, 1);
    assert.strictEqual(audits[0].actor_cook_id, 'alice');
    assert.strictEqual(audits[0].entity_id, id);
  });

  it('400 on missing id', async () => {
    const res = await resolvePOST(resolveReq({}));
    assert.strictEqual(res.status, 400);
  });

  it('404 on unknown id', async () => {
    const res = await resolvePOST(resolveReq({ id: 9999 }));
    assert.strictEqual(res.status, 404);
  });

  it('409 when already resolved', async () => {
    const id = await openEightySix();
    await resolvePOST(resolveReq({ id }));
    const res = await resolvePOST(resolveReq({ id }));
    assert.strictEqual(res.status, 409);

    // Still only ONE update audit (second resolve was rejected before
    // the audit emission).
    const updates = testDb
      .prepare(`SELECT COUNT(*) AS c FROM audit_events WHERE entity='eighty_six' AND action='update'`)
      .get().c;
    assert.strictEqual(updates, 1);
  });
});

// ─────────────────────────────────────────────────────────────────
// POST /api/eighty-six/resolve — cross-location IDOR guard (2026-05-08 fix)
//
// Pre-fix, the route derived `loc` from body.location_id — a caller
// who knew or guessed the target's location could pass it in the body
// and bypass the WHERE-clause guard. The fix moves location to
// ?location= (caller's own scope) and snapshots the row to compare
// existing.location_id before mutating.
// ─────────────────────────────────────────────────────────────────

describe('POST /api/eighty-six/resolve — cross-location IDOR guard', () => {
  it('404 when caller location does not match the row location', async () => {
    const id = await openEightySix({ locationId: 'site-b' });

    // Caller asserts site-A; row is at site-B; even with body.location_id=site-b
    // (the old bypass), the route now reads location from ?location= only.
    const res = await resolvePOST(resolveReq(
      { id, location_id: 'site-b' },
      { location: 'site-a' },
    ));
    assert.strictEqual(res.status, 404);

    // Row at site-B is untouched.
    const row = testDb
      .prepare('SELECT resolved_at FROM eighty_six WHERE id=?')
      .get(id);
    assert.strictEqual(row.resolved_at, null);

    // No audit update was emitted.
    const updates = testDb
      .prepare(`SELECT COUNT(*) AS c FROM audit_events WHERE entity='eighty_six' AND action='update'`)
      .get().c;
    assert.strictEqual(updates, 0);
  });

  it('200 when caller location matches the row location', async () => {
    const id = await openEightySix({ locationId: 'site-b' });
    const res = await resolvePOST(resolveReq({ id }, { location: 'site-b' }));
    assert.strictEqual(res.status, 200);

    const row = testDb
      .prepare('SELECT resolved_at, location_id FROM eighty_six WHERE id=?')
      .get(id);
    assert.ok(row.resolved_at);
    assert.strictEqual(row.location_id, 'site-b');
  });

  it('body.location_id is ignored — only ?location= controls the gate', async () => {
    // Row at default; caller passes ?location=default (matches) but
    // body.location_id=site-b (doesn't match). The body field used to
    // control the WHERE clause; now it's a no-op.
    const id = await openEightySix({ locationId: 'default' });

    const res = await resolvePOST(resolveReq(
      { id, location_id: 'site-b' },
      { location: 'default' },
    ));
    assert.strictEqual(res.status, 200);

    const row = testDb
      .prepare('SELECT resolved_at, location_id FROM eighty_six WHERE id=?')
      .get(id);
    assert.ok(row.resolved_at);
    assert.strictEqual(row.location_id, 'default');
  });
});
