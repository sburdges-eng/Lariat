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
const route = await import('../../app/api/performance-reviews/route.ts');

db.setDbPathForTest(TMP_DB);
const testDb = db.getDb();

const { POST, GET } = route;

after(() => {
  db.setDbPathForTest(null);
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

beforeEach(() => {
  testDb.exec('DELETE FROM performance_reviews; DELETE FROM audit_events;');
});

function postReq(body) {
  return new Request('http://localhost/api/performance-reviews', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function getReq(qs = '') {
  return new Request(`http://localhost/api/performance-reviews${qs}`);
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
