#!/usr/bin/env node
// Integration tests for /api/sick-leave (L2 / HFWA).
// Run: node --experimental-strip-types --test tests/js/test-sick-leave-api.mjs

import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

register(new URL('./resolver.mjs', import.meta.url));

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-sick-leave-api-'));
const TMP_DB = path.join(TMP_DIR, 'lariat-test.db');

const db = await import('../../lib/db.ts');

// LARIAT_PIN must NOT be set during tests — keeps the gate disabled
// so we can exercise the happy path without a fake cookie. The 403
// behavior is exercised explicitly by toggling the env at runtime.
delete process.env.LARIAT_PIN;

const route = await import('../../app/api/sick-leave/route.js');

db.setDbPathForTest(TMP_DB);
const testDb = db.getDb();

const { POST, GET } = route;

after(() => {
  db.setDbPathForTest(null);
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

beforeEach(() => {
  testDb.exec('DELETE FROM paid_sick_leave_balances; DELETE FROM audit_events; DELETE FROM idempotency_keys;');
});

function postReq(body, headers = {}) {
  return new Request('http://localhost/api/sick-leave', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

function getReq(qs = '') {
  return new Request(`http://localhost/api/sick-leave${qs}`);
}

function countBalances() {
  return testDb.prepare('SELECT COUNT(*) AS c FROM paid_sick_leave_balances').get().c;
}

function countAudit() {
  return testDb.prepare(`SELECT COUNT(*) AS c FROM audit_events WHERE entity='paid_sick_leave_balances'`).get().c;
}

// ── PIN gate ─────────────────────────────────────────────────────

describe('POST /api/sick-leave — PIN gate', () => {
  it('returns 403 when PIN is configured but not presented', async () => {
    process.env.LARIAT_PIN = '1234';
    try {
      const res = await POST(postReq({
        kind: 'accrual', cook_id: 'alice', accrual_year: 2026, hours: 1,
      }));
      assert.strictEqual(res.status, 403);
      assert.strictEqual(countBalances(), 0);
      assert.strictEqual(countAudit(), 0);
    } finally {
      delete process.env.LARIAT_PIN;
    }
  });
});

// ── POST happy path ──────────────────────────────────────────────

describe('POST /api/sick-leave — accrual', () => {
  it('first accrual creates the balance row and audit insert', async () => {
    const res = await POST(postReq({
      kind: 'accrual', cook_id: 'alice', accrual_year: 2026,
      hours: 0, hours_worked: 30,
    }));
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.ok, true);
    assert.strictEqual(body.kind, 'accrual');
    assert.strictEqual(body.hours_applied, 1);
    assert.strictEqual(body.balance.hours_accrued, 1);
    assert.strictEqual(body.balance.hours_used, 0);
    assert.strictEqual(body.balance.hours_available, 1);
    assert.strictEqual(countBalances(), 1);
    assert.strictEqual(countAudit(), 1);
    const audit = testDb.prepare(`SELECT * FROM audit_events WHERE entity='paid_sick_leave_balances'`).get();
    assert.strictEqual(audit.action, 'insert');
    assert.strictEqual(audit.actor_source, 'pic_ui');
  });

  it('second accrual updates the row and emits update audit', async () => {
    await POST(postReq({ kind: 'accrual', cook_id: 'alice', accrual_year: 2026, hours: 1 }));
    const res = await POST(postReq({ kind: 'accrual', cook_id: 'alice', accrual_year: 2026, hours: 0, hours_worked: 90 }));
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.hours_applied, 3);
    assert.strictEqual(body.balance.hours_accrued, 4); // 1 + 3
    assert.strictEqual(countBalances(), 1);
    const audits = testDb.prepare(`SELECT action FROM audit_events WHERE entity='paid_sick_leave_balances' ORDER BY id`).all();
    assert.strictEqual(audits.length, 2);
    assert.strictEqual(audits[0].action, 'insert');
    assert.strictEqual(audits[1].action, 'update');
  });

  it('cap reached returns 422 with reason; no audit row', async () => {
    // Front-load to cap
    await POST(postReq({ kind: 'accrual', cook_id: 'alice', accrual_year: 2026, hours: 48 }));
    assert.strictEqual(countAudit(), 1);
    const res = await POST(postReq({ kind: 'accrual', cook_id: 'alice', accrual_year: 2026, hours: 0, hours_worked: 30 }));
    assert.strictEqual(res.status, 422);
    const body = await res.json();
    assert.strictEqual(body.capped, true);
    // No new audit row from the failed accrual.
    assert.strictEqual(countAudit(), 1);
  });
});

describe('POST /api/sick-leave — use', () => {
  it('use within balance succeeds and reduces hours_available', async () => {
    await POST(postReq({ kind: 'accrual', cook_id: 'alice', accrual_year: 2026, hours: 8 }));
    const res = await POST(postReq({ kind: 'use', cook_id: 'alice', accrual_year: 2026, hours: 3 }));
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.balance.hours_used, 3);
    assert.strictEqual(body.balance.hours_available, 5);
  });

  it('use over balance returns 422; no row change', async () => {
    await POST(postReq({ kind: 'accrual', cook_id: 'alice', accrual_year: 2026, hours: 4 }));
    const res = await POST(postReq({ kind: 'use', cook_id: 'alice', accrual_year: 2026, hours: 8 }));
    assert.strictEqual(res.status, 422);
    const body = await res.json();
    assert.match(body.error, /not enough/);
    const row = testDb.prepare('SELECT hours_used FROM paid_sick_leave_balances').get();
    assert.strictEqual(row.hours_used, 0);
  });
});

// ── POST validation ──────────────────────────────────────────────

describe('POST /api/sick-leave — validation', () => {
  it('400 when kind missing', async () => {
    const res = await POST(postReq({ cook_id: 'alice', accrual_year: 2026, hours: 1 }));
    assert.strictEqual(res.status, 400);
  });
  it('400 when kind is not "accrual" or "use"', async () => {
    const res = await POST(postReq({ kind: 'bonus', cook_id: 'alice', accrual_year: 2026, hours: 1 }));
    assert.strictEqual(res.status, 400);
  });
  it('400 when cook_id missing', async () => {
    const res = await POST(postReq({ kind: 'accrual', accrual_year: 2026, hours: 1 }));
    assert.strictEqual(res.status, 400);
  });
  it('400 when accrual_year out of range', async () => {
    const res = await POST(postReq({ kind: 'accrual', cook_id: 'alice', accrual_year: 1899, hours: 1 }));
    assert.strictEqual(res.status, 400);
  });
  it('400 when hours not positive', async () => {
    const res = await POST(postReq({ kind: 'accrual', cook_id: 'alice', accrual_year: 2026, hours: 0 }));
    assert.strictEqual(res.status, 400);
  });
  it('400 when dated_on is malformed', async () => {
    const res = await POST(postReq({ kind: 'accrual', cook_id: 'alice', accrual_year: 2026, hours: 1, dated_on: '4/20/2026' }));
    assert.strictEqual(res.status, 400);
  });
});

// ── Idempotency ──────────────────────────────────────────────────

describe('POST /api/sick-leave — idempotency', () => {
  it('replayed key returns same response, no duplicate row or audit', async () => {
    const headers = { 'idempotency-key': 'sick-leave-test-key-aaaaaaaaaaaaa1' };
    const body = { kind: 'accrual', cook_id: 'alice', accrual_year: 2026, hours: 1 };
    const r1 = await POST(postReq(body, headers));
    const j1 = await r1.json();
    const r2 = await POST(postReq(body, headers));
    const j2 = await r2.json();
    assert.deepStrictEqual(j1, j2);
    assert.strictEqual(countBalances(), 1);
    assert.strictEqual(countAudit(), 1);
  });
});

// ── GET ──────────────────────────────────────────────────────────

describe('GET /api/sick-leave', () => {
  it('returns zero balance + empty events for unknown cook', async () => {
    const res = await GET(getReq('?cook_id=alice&year=2026'));
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.balance.hours_accrued, 0);
    assert.strictEqual(body.balance.hours_available, 0);
    assert.deepStrictEqual(body.events, []);
  });

  it('returns balance + recent events after accrual', async () => {
    await POST(postReq({ kind: 'accrual', cook_id: 'alice', accrual_year: 2026, hours: 4 }));
    const res = await GET(getReq('?cook_id=alice&year=2026'));
    const body = await res.json();
    assert.strictEqual(body.balance.hours_accrued, 4);
    assert.strictEqual(body.events.length, 1);
    assert.strictEqual(body.events[0].action, 'insert');
  });

  it('list mode returns balances for the location/year', async () => {
    await POST(postReq({ kind: 'accrual', cook_id: 'alice', accrual_year: 2026, hours: 4 }));
    await POST(postReq({ kind: 'accrual', cook_id: 'bob', accrual_year: 2026, hours: 8 }));
    const res = await GET(getReq('?year=2026'));
    const body = await res.json();
    assert.strictEqual(body.balances.length, 2);
    const cooks = body.balances.map((b) => b.cook_id).sort();
    assert.deepStrictEqual(cooks, ['alice', 'bob']);
  });
});
