#!/usr/bin/env node
// Integration tests for /api/performance-reviews.
//
// Spin up a temp SQLite DB, import the route in-process, assert on the Response objects.
// Run: node --test tests/js/test-performance-reviews-api.mjs

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

register(new URL('./resolver.mjs', import.meta.url));

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-perf-api-'));
const TMP_DB = path.join(TMP_DIR, 'lariat-test.db');

const db = await import('../../lib/db.ts');
// Reviews are PIN-gated (2026-06-12). Force the gate ON; with
// LARIAT_PIN_SECRET unset, the legacy unsigned 'lariat_pin_ok=1' cookie
// is accepted by hasPinCookie — same pattern as test-recipe-photos-api.
const SAVED_PIN = process.env.LARIAT_PIN;
const SAVED_PIN_SECRET = process.env.LARIAT_PIN_SECRET;
process.env.LARIAT_PIN = '0000';
delete process.env.LARIAT_PIN_SECRET;

const route = await import('../../app/api/performance-reviews/route.ts');

db.setDbPathForTest(TMP_DB);
const testDb = db.getDb();

const { POST, GET } = route;

after(() => {
  db.setDbPathForTest(null);
  if (SAVED_PIN === undefined) delete process.env.LARIAT_PIN;
  else process.env.LARIAT_PIN = SAVED_PIN;
  if (SAVED_PIN_SECRET !== undefined) process.env.LARIAT_PIN_SECRET = SAVED_PIN_SECRET;
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

beforeEach(() => {
  testDb.exec('DELETE FROM performance_reviews; DELETE FROM audit_events;');
});

function postReq(body) {
  return new Request('http://localhost/api/performance-reviews', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: 'lariat_pin_ok=1' },
    body: JSON.stringify(body),
  });
}

function getReq(qs = '') {
  return new Request(`http://localhost/api/performance-reviews${qs}`, {
    headers: { cookie: 'lariat_pin_ok=1' },
  });
}

function countReviews() {
  return testDb.prepare('SELECT COUNT(*) AS c FROM performance_reviews').get().c;
}

function countAudit() {
  return testDb
    .prepare("SELECT COUNT(*) AS c FROM audit_events WHERE entity = 'performance_reviews'")
    .get().c;
}

describe('POST /api/performance-reviews', () => {
  it('accepts a valid review', async () => {
    const res = await POST(postReq({
      cook_name: 'Alice',
      cook_uuid: 'uuid-alice-123',
      review_date: '2026-05-05',
      punctuality_score: 5,
      technique_score: 4,
      speed_score: 5,
      notes: 'Great worker!',
      reviewer_name: 'Chef Bob',
    }));
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.ok, true);
    assert.strictEqual(countReviews(), 1);
    assert.strictEqual(countAudit(), 1);
  });

  it('rejects if required fields are missing', async () => {
    const res = await POST(postReq({
      cook_name: 'Alice',
      // review_date missing
      reviewer_name: 'Chef Bob',
    }));
    assert.strictEqual(res.status, 400);
    assert.strictEqual(countReviews(), 0);
  });

  it('rejects if scores are not numbers', async () => {
    const res = await POST(postReq({
      cook_name: 'Alice',
      review_date: '2026-05-05',
      punctuality_score: 'A',
      technique_score: 4,
      speed_score: 5,
      reviewer_name: 'Chef Bob',
    }));
    assert.strictEqual(res.status, 400);
  });
});

// ─────────────────────────────────────────────────────────────────
// Two-track audit isolation (2026-05-08 fix)
//
// Per docs/PATTERNS.md §3, the file audit (logAuditAction → JSONL)
// MUST run AFTER the db.transaction commits, not inside it. The fix
// moves logAuditAction outside the transaction so a file-write failure
// can no longer roll back the DB review row, and a DB-commit failure
// can no longer leave a ghost JSONL entry.
// ─────────────────────────────────────────────────────────────────

describe('POST /api/performance-reviews — two-track audit isolation', () => {
  it('writes a file-audit JSONL entry when LARIAT_AUDIT_PATH is honored', async () => {
    const auditFile = path.join(TMP_DIR, 'mgmt-actions.jsonl');
    if (fs.existsSync(auditFile)) fs.unlinkSync(auditFile);

    const prevAuditPath = process.env.LARIAT_AUDIT_PATH;
    process.env.LARIAT_AUDIT_PATH = auditFile;
    try {
      const res = await POST(postReq({
        cook_name: 'Alice',
        cook_uuid: 'uuid-alice-123',
        review_date: '2026-05-05',
        punctuality_score: 5,
        technique_score: 4,
        speed_score: 5,
        reviewer_name: 'Chef Bob',
      }));
      assert.strictEqual(res.status, 200);
    } finally {
      if (prevAuditPath === undefined) delete process.env.LARIAT_AUDIT_PATH;
      else process.env.LARIAT_AUDIT_PATH = prevAuditPath;
    }

    assert.ok(fs.existsSync(auditFile), 'audit JSONL file was written');
    const lines = fs.readFileSync(auditFile, 'utf8').split('\n').filter(Boolean);
    assert.strictEqual(lines.length, 1);
    const entry = JSON.parse(lines[0]);
    assert.strictEqual(entry.action, 'performance_review_logged');
    assert.strictEqual(entry.user, 'Chef Bob');
    assert.strictEqual(entry.changes.cook, 'Alice');
  });

  it('a failing file-audit write does NOT roll back the DB review row', async () => {
    // Point LARIAT_AUDIT_PATH at a path whose parent will be created by
    // the auditLog module (ensureAuditDir mkdirs); then chmod the parent
    // to read-only so the appendFileSync inside logAuditAction fails.
    // POSIX-only — skip on platforms where chmod doesn't restrict the
    // current user (root, Windows).
    if (process.getuid && process.getuid() === 0) return; // root bypasses perms
    if (process.platform === 'win32') return;

    const auditDir = path.join(TMP_DIR, 'readonly-audit');
    fs.mkdirSync(auditDir, { recursive: true });
    const auditFile = path.join(auditDir, 'mgmt-actions.jsonl');

    // Pre-create the file so chmod 0o400 still leaves the path
    // resolvable; appendFileSync on a read-only file is the actual
    // failure we're forcing.
    fs.writeFileSync(auditFile, '');
    fs.chmodSync(auditFile, 0o400);

    const prevAuditPath = process.env.LARIAT_AUDIT_PATH;
    process.env.LARIAT_AUDIT_PATH = auditFile;
    try {
      const res = await POST(postReq({
        cook_name: 'Bob',
        cook_uuid: 'uuid-bob-456',
        review_date: '2026-05-06',
        punctuality_score: 4,
        technique_score: 5,
        speed_score: 4,
        reviewer_name: 'Chef Carol',
      }));

      // The DB write succeeded and the response is 200 — the
      // best-effort file audit failure does not roll back the durable
      // DB row.
      assert.strictEqual(res.status, 200);

      // DB row landed.
      assert.strictEqual(countReviews(), 1);
      const reviewRow = testDb
        .prepare('SELECT cook_name FROM performance_reviews ORDER BY id DESC LIMIT 1')
        .get();
      assert.strictEqual(reviewRow.cook_name, 'Bob');

      // DB-track audit row landed (postAuditEvent runs inside the tx).
      assert.strictEqual(countAudit(), 1);

      // File-track audit DID NOT land (the file is still empty).
      const txt = fs.readFileSync(auditFile, 'utf8');
      assert.strictEqual(txt, '', 'file-audit write failed silently');
    } finally {
      // Restore perms so the after() rmSync can clean up.
      try { fs.chmodSync(auditFile, 0o600); } catch { /* ignore */ }
      if (prevAuditPath === undefined) delete process.env.LARIAT_AUDIT_PATH;
      else process.env.LARIAT_AUDIT_PATH = prevAuditPath;
    }
  });
});

describe('GET /api/performance-reviews', () => {
  it('returns reviews for the current location', async () => {
    await POST(postReq({
      cook_name: 'Alice',
      cook_uuid: 'uuid-alice-123',
      review_date: '2026-05-05',
      punctuality_score: 5,
      technique_score: 4,
      speed_score: 5,
      reviewer_name: 'Chef Bob',
    }));
    
    const res = await GET(getReq());
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.length, 1);
    assert.strictEqual(body[0].cook_name, 'Alice');
  });

  it('filters by location', async () => {
    await POST(postReq({
      cook_name: 'Alice',
      cook_uuid: 'uuid-alice-123',
      review_date: '2026-05-05',
      punctuality_score: 5,
      technique_score: 4,
      speed_score: 5,
      reviewer_name: 'Chef Bob',
      location_id: 'downtown',
    }));
    
    const resDefault = await GET(getReq());
    const bodyDefault = await resDefault.json();
    assert.strictEqual(bodyDefault.length, 0);
    
    const resDowntown = await GET(getReq('?location=downtown'));
    const bodyDowntown = await resDowntown.json();
    assert.strictEqual(bodyDowntown.length, 1);
  });
});
