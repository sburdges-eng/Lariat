#!/usr/bin/env node
// Integration tests for /api/sanitizer (F4 / FDA §4-703.11).
//
// Pure rule module is covered by test-sanitizer-rules.mjs. This file
// exercises route-level behavior: POST happy path, 422 needs-note for
// out-of-band readings, GET roll-up.
//
// Run: node --experimental-strip-types --test tests/js/test-sanitizer-api.mjs

import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

register(new URL('./resolver.mjs', import.meta.url));

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-sanitizer-api-'));
const TMP_DB = path.join(TMP_DIR, 'lariat-test.db');

const db = await import('../../lib/db.ts');
const route = await import('../../app/api/sanitizer/route.ts');

db.setDbPathForTest(TMP_DB);
const testDb = db.getDb();

const { POST, GET } = route;

after(() => {
  db.setDbPathForTest(null);
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

beforeEach(() => {
  testDb.exec('DELETE FROM sanitizer_checks; DELETE FROM audit_events;');
});

function postReq(body) {
  return new Request('http://localhost/api/sanitizer', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}
function getReq(qs = '') {
  return new Request(`http://localhost/api/sanitizer${qs}`);
}
function countChecks() {
  return testDb.prepare('SELECT COUNT(*) AS c FROM sanitizer_checks').get().c;
}
function countAudit(entity) {
  return testDb.prepare('SELECT COUNT(*) AS c FROM audit_events WHERE entity=?').get(entity).c;
}

describe('POST /api/sanitizer — happy path', () => {
  it('in-band quat reading → 200, row + audit written', async () => {
    const res = await POST(postReq({
      chemistry: 'quat',
      concentration_ppm: 200,
      point_label: 'Wiping bucket — line',
      cook_id: 'alice',
    }));
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.ok, true);
    assert.strictEqual(body.entry.chemistry, 'quat');
    assert.strictEqual(body.decision.status, 'ok');
    assert.strictEqual(countChecks(), 1);
    assert.strictEqual(countAudit('sanitizer_checks'), 1);
    const audit = testDb
      .prepare(`SELECT * FROM audit_events WHERE entity='sanitizer_checks'`).get();
    assert.strictEqual(audit.action, 'insert');
    assert.strictEqual(audit.actor_cook_id, 'alice');
  });
});

describe('POST /api/sanitizer — validation + 422', () => {
  it('400 on unknown chemistry', async () => {
    const res = await POST(postReq({
      chemistry: 'lemon_juice',
      concentration_ppm: 200,
      point_label: 'Wiping bucket — line',
    }));
    assert.strictEqual(res.status, 400);
    assert.strictEqual(countChecks(), 0);
  });

  it('low quat reading without corrective note → 422 needs_corrective_action', async () => {
    const res = await POST(postReq({
      chemistry: 'quat',
      concentration_ppm: 50,                    // below 150-min band
      point_label: 'Wiping bucket — line',
    }));
    assert.strictEqual(res.status, 422);
    const body = await res.json();
    assert.strictEqual(body.needs_corrective_action, true);
    assert.strictEqual(body.status, 'low');
    assert.strictEqual(body.required_min_ppm, 150);
    assert.strictEqual(countChecks(), 0);
    assert.strictEqual(countAudit('sanitizer_checks'), 0);
  });

  it('low reading WITH corrective note → 200; row saved with breach status', async () => {
    const res = await POST(postReq({
      chemistry: 'quat',
      concentration_ppm: 50,
      point_label: 'Wiping bucket — line',
      corrective_action: 'remade bucket, re-tested at 250 ppm',
    }));
    assert.strictEqual(res.status, 200);
    const row = testDb.prepare('SELECT * FROM sanitizer_checks').get();
    assert.strictEqual(row.status, 'low');
    assert.match(row.corrective_action, /remade bucket/);
    assert.strictEqual(countAudit('sanitizer_checks'), 1);
  });
});

describe('GET /api/sanitizer', () => {
  it('returns rows + latest-per-point roll-up', async () => {
    await POST(postReq({
      chemistry: 'quat',
      concentration_ppm: 200,
      point_label: 'Wiping bucket — line',
    }));
    await POST(postReq({
      chemistry: 'quat',
      concentration_ppm: 250,
      point_label: 'Wiping bucket — grill',
    }));
    const res = await GET(getReq());
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.rows.length, 2);
    assert.strictEqual(body.latest.length, 2);
    assert.ok(Array.isArray(body.known_points));
    assert.ok(Array.isArray(body.chemistries));
  });
});

// ─────────────────────────────────────────────────────────────────
// POST /api/sanitizer — transactional rollback
//
// Per docs/PATTERNS.md §3, postAuditEvent() runs inside the same
// transaction as the source INSERT. If the audit write fails the
// sanitizer_checks row MUST also roll back — no stranded readings
// without their audit trail. We simulate by renaming audit_events
// out of the way mid-test so the audit insert throws.
// ─────────────────────────────────────────────────────────────────

describe('POST /api/sanitizer — transactional rollback', () => {
  it('rollback: drop audit_events mid-flight → sanitizer_checks insert rolls back (zero stranded rows)', async () => {
    testDb.exec(`ALTER TABLE audit_events RENAME TO audit_events_stash`);
    try {
      const before = countChecks();
      const res = await POST(postReq({
        chemistry: 'quat',
        concentration_ppm: 200,                  // in-band — would otherwise succeed
        point_label: 'Wiping bucket — line',
        cook_id: 'alice',
      }));
      assert.strictEqual(res.status, 500, 'route must 500 when audit write fails');
      assert.strictEqual(countChecks(), before, 'sanitizer_checks must be rolled back — no stranded rows');
    } finally {
      testDb.exec(`ALTER TABLE audit_events_stash RENAME TO audit_events`);
    }
  });
});
