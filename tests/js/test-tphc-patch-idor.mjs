#!/usr/bin/env node
// Cross-location IDOR guard for PATCH /api/tphc.
//
// PR #189 closed the TOCTOU race (SELECT/guards now run inside the same
// transaction as the UPDATE) but left a cross-location IDOR gap: a cook
// scoped to site-A could mutate a TPHC batch belonging to site-B by
// guessing the numeric id. The PATCH never compared existing.location_id
// against locationFromRequest(req).
//
// Mirror of tests/js/test-cooling-api.mjs's "PATCH /api/cooling —
// cross-location IDOR guard" describe block. 404 (not 403) is
// deliberate: existence at another site must not leak.
//
// Run: node --test tests/js/test-tphc-patch-idor.mjs

import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

register(new URL('./resolver.mjs', import.meta.url));

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-tphc-idor-'));
const TMP_DB = path.join(TMP_DIR, 'lariat-test.db');

const db = await import('../../lib/db.ts');
const route = await import('../../app/api/tphc/route.js');

db.setDbPathForTest(TMP_DB);
const testDb = db.getDb();

const { POST, PATCH } = route;

const T0 = '2026-04-20T10:00:00.000Z';

after(() => {
  db.setDbPathForTest(null);
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

beforeEach(() => {
  testDb.exec('DELETE FROM tphc_entries; DELETE FROM audit_events;');
});

// ── Helpers ───────────────────────────────────────────────────────

function postReq(body, qs = '') {
  return new Request(`http://localhost/api/tphc${qs}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function patchReq(body, qs = '') {
  return new Request(`http://localhost/api/tphc${qs}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function startBatch(overrides = {}) {
  const res = await POST(postReq({
    item: 'taco bar',
    started_at: T0,
    kind: 'hot_time_only',
    ...overrides,
  }));
  assert.strictEqual(res.status, 200, 'POST should succeed in fixture setup');
  const body = await res.json();
  return body.entry.id;
}

function countAuditByAction(action) {
  return testDb
    .prepare(`SELECT COUNT(*) AS c FROM audit_events WHERE entity='tphc_entries' AND action=?`)
    .get(action).c;
}

// ─────────────────────────────────────────────────────────────────
// PATCH /api/tphc — cross-location IDOR guard
// ─────────────────────────────────────────────────────────────────

describe('PATCH /api/tphc — cross-location IDOR guard', () => {
  it('404 when caller location does not match the row location', async () => {
    // Start a batch at site-a.
    const id = await startBatch({ location_id: 'site-a' });

    // site-b cook (caller scoped via ?location=site-b) tries to PATCH it.
    const res = await PATCH(patchReq(
      { id, discard_reason: 'consumed', cook_id: 'mallory' },
      '?location=site-b',
    ));
    assert.strictEqual(res.status, 404);
    const body = await res.json();
    // Existence-leak prevention: same error string as the unknown-id 404.
    assert.match(body.error, /unknown tphc entry/);

    // Row at site-a was not mutated.
    const row = testDb.prepare('SELECT * FROM tphc_entries WHERE id=?').get(id);
    assert.strictEqual(row.discarded_at, null, 'discarded_at must remain NULL');
    assert.strictEqual(row.discard_reason, null, 'discard_reason must remain NULL');
    assert.strictEqual(row.location_id, 'site-a');

    // No update audit event was emitted.
    assert.strictEqual(countAuditByAction('update'), 0);
  });

  it('200 when caller location matches the row location', async () => {
    const id = await startBatch({ location_id: 'site-a' });

    const res = await PATCH(patchReq(
      { id, discard_reason: 'consumed', cook_id: 'alice' },
      '?location=site-a',
    ));
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.ok, true);
    assert.strictEqual(body.entry.discard_reason, 'consumed');
    assert.ok(body.entry.discarded_at, 'discarded_at must be populated');

    // Row was mutated.
    const row = testDb.prepare('SELECT * FROM tphc_entries WHERE id=?').get(id);
    assert.strictEqual(row.discard_reason, 'consumed');
    assert.ok(row.discarded_at);

    // One update audit event was emitted.
    assert.strictEqual(countAuditByAction('update'), 1);
  });

  it('default-location compat: POST without location_id, PATCH without ?location= → 200', async () => {
    // No location_id in body → defaults to 'default'.
    const id = await startBatch();

    // No ?location= on the PATCH URL → caller scope defaults to 'default'.
    const res = await PATCH(patchReq(
      { id, discard_reason: 'consumed', cook_id: 'alice' },
    ));
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.ok, true);
    assert.strictEqual(body.entry.discard_reason, 'consumed');

    const row = testDb.prepare('SELECT * FROM tphc_entries WHERE id=?').get(id);
    assert.strictEqual(row.location_id, 'default');
    assert.strictEqual(row.discard_reason, 'consumed');
    assert.ok(row.discarded_at);

    assert.strictEqual(countAuditByAction('update'), 1);
  });
});
