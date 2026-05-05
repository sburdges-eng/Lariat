#!/usr/bin/env node
// Integration tests for /api/wage-notices (L7 / C.R.S. §8-4-103).
// Run: node --experimental-strip-types --test tests/js/test-wage-notices-api.mjs

import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

register(new URL('./resolver.mjs', import.meta.url));

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-wage-notices-api-'));
const TMP_DB = path.join(TMP_DIR, 'lariat-test.db');

const db = await import('../../lib/db.ts');
delete process.env.LARIAT_PIN;
const route = await import('../../app/api/wage-notices/route.js');

db.setDbPathForTest(TMP_DB);
const testDb = db.getDb();

const { POST, GET } = route;

after(() => {
  db.setDbPathForTest(null);
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

beforeEach(() => {
  testDb.exec('DELETE FROM wage_notices; DELETE FROM audit_events; DELETE FROM idempotency_keys;');
});

function postReq(body, headers = {}) {
  return new Request('http://localhost/api/wage-notices', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}
function getReq(qs = '') {
  return new Request(`http://localhost/api/wage-notices${qs}`);
}
function countNotices() {
  return testDb.prepare('SELECT COUNT(*) AS c FROM wage_notices').get().c;
}
function countAudit() {
  return testDb.prepare(`SELECT COUNT(*) AS c FROM audit_events WHERE entity='wage_notices'`).get().c;
}

// ── PIN gate ─────────────────────────────────────────────────────

describe('POST /api/wage-notices — PIN gate', () => {
  it('403 when PIN is configured and missing', async () => {
    process.env.LARIAT_PIN = '1234';
    try {
      const res = await POST(postReq({
        cook_id: 'alice', reason: 'hire', wage_rate_cents: 1500,
        pay_basis: 'hourly', signed_on: '2026-04-20',
      }));
      assert.strictEqual(res.status, 403);
      assert.strictEqual(countNotices(), 0);
      assert.strictEqual(countAudit(), 0);
    } finally {
      delete process.env.LARIAT_PIN;
    }
  });
});

// ── POST happy path ──────────────────────────────────────────────

describe('POST /api/wage-notices — happy path', () => {
  it('persists a hire notice and emits insert audit', async () => {
    const res = await POST(postReq({
      cook_id: 'alice', reason: 'hire', wage_rate_cents: 1500,
      pay_basis: 'hourly', signed_on: '2026-04-20',
    }));
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.ok, true);
    assert.strictEqual(body.entry.cook_id, 'alice');
    assert.strictEqual(body.entry.wage_rate_cents, 1500);
    assert.strictEqual(countNotices(), 1);
    assert.strictEqual(countAudit(), 1);
    const audit = testDb.prepare(`SELECT * FROM audit_events WHERE entity='wage_notices'`).get();
    assert.strictEqual(audit.action, 'insert');
    assert.strictEqual(audit.actor_source, 'pic_ui');
    assert.strictEqual(audit.note, 'hire:hourly');
  });

  it('persists a tipped notice with tip_credit_cents', async () => {
    const res = await POST(postReq({
      cook_id: 'alice', reason: 'hire', wage_rate_cents: 1179,
      pay_basis: 'tipped', tip_credit_cents: 302, signed_on: '2026-04-20',
    }));
    assert.strictEqual(res.status, 200);
    const row = testDb.prepare('SELECT * FROM wage_notices').get();
    assert.strictEqual(row.tip_credit_cents, 302);
    assert.strictEqual(row.pay_basis, 'tipped');
  });
});

// ── POST validation ──────────────────────────────────────────────

describe('POST /api/wage-notices — validation', () => {
  it('400 on unknown reason', async () => {
    const res = await POST(postReq({
      cook_id: 'alice', reason: 'fired', wage_rate_cents: 1500,
      pay_basis: 'hourly', signed_on: '2026-04-20',
    }));
    assert.strictEqual(res.status, 400);
  });
  it('400 on unknown pay_basis', async () => {
    const res = await POST(postReq({
      cook_id: 'alice', reason: 'hire', wage_rate_cents: 1500,
      pay_basis: 'piece_rate', signed_on: '2026-04-20',
    }));
    assert.strictEqual(res.status, 400);
  });
  it('400 on float wage_rate_cents', async () => {
    const res = await POST(postReq({
      cook_id: 'alice', reason: 'hire', wage_rate_cents: 14.81,
      pay_basis: 'hourly', signed_on: '2026-04-20',
    }));
    assert.strictEqual(res.status, 400);
  });
  it('400 on tip_credit_cents > 0 with hourly pay_basis', async () => {
    const res = await POST(postReq({
      cook_id: 'alice', reason: 'hire', wage_rate_cents: 1500,
      pay_basis: 'hourly', tip_credit_cents: 302, signed_on: '2026-04-20',
    }));
    assert.strictEqual(res.status, 400);
  });
  it('400 on missing cook_id', async () => {
    const res = await POST(postReq({
      reason: 'hire', wage_rate_cents: 1500,
      pay_basis: 'hourly', signed_on: '2026-04-20',
    }));
    assert.strictEqual(res.status, 400);
  });
  it('400 on malformed signed_on', async () => {
    const res = await POST(postReq({
      cook_id: 'alice', reason: 'hire', wage_rate_cents: 1500,
      pay_basis: 'hourly', signed_on: '4/20/2026',
    }));
    assert.strictEqual(res.status, 400);
  });
});

// ── GET ──────────────────────────────────────────────────────────

describe('GET /api/wage-notices', () => {
  it('returns latest per cook for the location, sorted by cook_id', async () => {
    await POST(postReq({ cook_id: 'alice', reason: 'hire', wage_rate_cents: 1500, pay_basis: 'hourly', signed_on: '2024-04-20' }));
    await POST(postReq({ cook_id: 'alice', reason: 'rate_change', wage_rate_cents: 1600, pay_basis: 'hourly', signed_on: '2026-01-01' }));
    await POST(postReq({ cook_id: 'bob', reason: 'hire', wage_rate_cents: 1500, pay_basis: 'hourly', signed_on: '2025-06-01' }));
    const res = await GET(getReq());
    const body = await res.json();
    assert.strictEqual(body.latest_per_cook.length, 2);
    const alice = body.latest_per_cook.find((r) => r.cook_id === 'alice');
    const bob = body.latest_per_cook.find((r) => r.cook_id === 'bob');
    assert.strictEqual(alice.signed_on, '2026-01-01');
    assert.strictEqual(alice.wage_rate_cents, 1600);
    assert.strictEqual(bob.signed_on, '2025-06-01');
  });

  it('returns history for one cook (latest first)', async () => {
    await POST(postReq({ cook_id: 'alice', reason: 'hire', wage_rate_cents: 1500, pay_basis: 'hourly', signed_on: '2024-04-20' }));
    await POST(postReq({ cook_id: 'alice', reason: 'rate_change', wage_rate_cents: 1600, pay_basis: 'hourly', signed_on: '2026-01-01' }));
    const res = await GET(getReq('?cook_id=alice'));
    const body = await res.json();
    assert.strictEqual(body.history.length, 2);
    assert.strictEqual(body.history[0].signed_on, '2026-01-01');
    assert.strictEqual(body.history[1].signed_on, '2024-04-20');
    assert.strictEqual(body.latest.signed_on, '2026-01-01');
  });

  it('cook_id with no notices returns has_notice=false + needs_new=true', async () => {
    const res = await GET(getReq('?cook_id=ghost'));
    const body = await res.json();
    assert.strictEqual(body.latest, null);
    assert.deepStrictEqual(body.history, []);
    assert.strictEqual(body.freshness.has_notice, false);
    assert.strictEqual(body.freshness.needs_new, true);
  });

  it('freshness flags stale notice (>365 days old)', async () => {
    await POST(postReq({ cook_id: 'alice', reason: 'hire', wage_rate_cents: 1500, pay_basis: 'hourly', signed_on: '2024-01-01' }));
    const res = await GET(getReq());
    const body = await res.json();
    const f = body.freshness.find((x) => x.cook_id === 'alice');
    assert.strictEqual(f.needs_new, true);
    assert.ok(f.days_since > 365);
  });
});

// ── Idempotency ──────────────────────────────────────────────────

describe('POST /api/wage-notices — idempotency', () => {
  it('replayed key returns same response, no duplicate row', async () => {
    const headers = { 'idempotency-key': 'wage-notices-test-key-aaaaaaaaaa1' };
    const body = {
      cook_id: 'alice', reason: 'hire', wage_rate_cents: 1500,
      pay_basis: 'hourly', signed_on: '2026-04-20',
    };
    const r1 = await POST(postReq(body, headers));
    const j1 = await r1.json();
    const r2 = await POST(postReq(body, headers));
    const j2 = await r2.json();
    assert.deepStrictEqual(j1, j2);
    assert.strictEqual(countNotices(), 1);
    assert.strictEqual(countAudit(), 1);
  });
});
