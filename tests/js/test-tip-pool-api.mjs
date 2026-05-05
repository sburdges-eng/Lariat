#!/usr/bin/env node
// Integration tests for /api/tip-pool (L4 / COMPS #39 §3.3, §3.4).
// Run: node --experimental-strip-types --test tests/js/test-tip-pool-api.mjs

import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

register(new URL('./resolver.mjs', import.meta.url));

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-tip-pool-api-'));
const TMP_DB = path.join(TMP_DIR, 'lariat-test.db');

const db = await import('../../lib/db.ts');
delete process.env.LARIAT_PIN;
const route = await import('../../app/api/tip-pool/route.js');

db.setDbPathForTest(TMP_DB);
const testDb = db.getDb();

const { POST, GET } = route;
const { todayISO } = db;

after(() => {
  db.setDbPathForTest(null);
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

beforeEach(() => {
  testDb.exec('DELETE FROM tip_pool_distributions; DELETE FROM staff_flags; DELETE FROM audit_events; DELETE FROM idempotency_keys;');
});

function postReq(body, headers = {}) {
  return new Request('http://localhost/api/tip-pool', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}
function getReq(qs = '') {
  return new Request(`http://localhost/api/tip-pool${qs}`);
}
function countDist() {
  return testDb.prepare('SELECT COUNT(*) AS c FROM tip_pool_distributions').get().c;
}
function countAudit() {
  return testDb.prepare(`SELECT COUNT(*) AS c FROM audit_events WHERE entity='tip_pool_distributions'`).get().c;
}

// ── PIN gate ─────────────────────────────────────────────────────

describe('POST /api/tip-pool — PIN gate', () => {
  it('403 when PIN is configured but missing', async () => {
    process.env.LARIAT_PIN = '1234';
    try {
      const res = await POST(postReq({
        shift_date: todayISO(), pool_ref: 'POOL-1', cook_id: 'alice',
        kind: 'tip_pool', amount_cents: 5000,
      }));
      assert.strictEqual(res.status, 403);
      assert.strictEqual(countDist(), 0);
    } finally {
      delete process.env.LARIAT_PIN;
    }
  });
});

// ── POST happy path ──────────────────────────────────────────────

describe('POST /api/tip-pool — happy path', () => {
  it('persists a tip_pool line and emits audit', async () => {
    const res = await POST(postReq({
      shift_date: todayISO(), pool_ref: 'POOL-1', cook_id: 'alice',
      role: 'server', kind: 'tip_pool', amount_cents: 5000, note: 'Friday close',
    }));
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.ok, true);
    assert.strictEqual(body.entry.amount_cents, 5000);
    assert.strictEqual(countDist(), 1);
    assert.strictEqual(countAudit(), 1);
    const audit = testDb.prepare(`SELECT * FROM audit_events WHERE entity='tip_pool_distributions'`).get();
    assert.strictEqual(audit.action, 'insert');
    assert.strictEqual(audit.actor_source, 'pic_ui');
  });

  it('persists service_charge and direct_tip kinds', async () => {
    await POST(postReq({
      shift_date: todayISO(), pool_ref: 'POOL-1', cook_id: 'alice',
      kind: 'service_charge', amount_cents: 1500,
    }));
    await POST(postReq({
      shift_date: todayISO(), pool_ref: 'POOL-1', cook_id: 'bob',
      kind: 'direct_tip', amount_cents: 800,
    }));
    assert.strictEqual(countDist(), 2);
  });
});

// ── POST validation ──────────────────────────────────────────────

describe('POST /api/tip-pool — validation', () => {
  it('422 when amount_cents is a float', async () => {
    const res = await POST(postReq({
      shift_date: todayISO(), pool_ref: 'POOL-1', cook_id: 'alice',
      kind: 'tip_pool', amount_cents: 12.5,
    }));
    assert.strictEqual(res.status, 422);
    const body = await res.json();
    assert.match(body.error, /integer/);
    assert.strictEqual(countDist(), 0);
    assert.strictEqual(countAudit(), 0);
  });

  it('422 when amount_cents is a string number', async () => {
    const res = await POST(postReq({
      shift_date: todayISO(), pool_ref: 'POOL-1', cook_id: 'alice',
      kind: 'tip_pool', amount_cents: '5000',
    }));
    assert.strictEqual(res.status, 422);
  });

  it('400 on unknown kind', async () => {
    const res = await POST(postReq({
      shift_date: todayISO(), pool_ref: 'POOL-1', cook_id: 'alice',
      kind: 'bonus', amount_cents: 1000,
    }));
    assert.strictEqual(res.status, 400);
  });

  it('400 on missing pool_ref', async () => {
    const res = await POST(postReq({
      shift_date: todayISO(), cook_id: 'alice',
      kind: 'tip_pool', amount_cents: 1000,
    }));
    assert.strictEqual(res.status, 400);
  });

  it('400 on missing cook_id', async () => {
    const res = await POST(postReq({
      shift_date: todayISO(), pool_ref: 'POOL-1',
      kind: 'tip_pool', amount_cents: 1000,
    }));
    assert.strictEqual(res.status, 400);
  });

  it('400 on negative amount_cents', async () => {
    const res = await POST(postReq({
      shift_date: todayISO(), pool_ref: 'POOL-1', cook_id: 'alice',
      kind: 'tip_pool', amount_cents: -100,
    }));
    assert.strictEqual(res.status, 400);
  });

  it('400 on malformed shift_date', async () => {
    const res = await POST(postReq({
      shift_date: '4/20/2026', pool_ref: 'POOL-1', cook_id: 'alice',
      kind: 'tip_pool', amount_cents: 100,
    }));
    assert.strictEqual(res.status, 400);
  });
});

// ── POST eligibility ─────────────────────────────────────────────

describe('POST /api/tip-pool — pool eligibility', () => {
  it('422 when manager flag active and kind=tip_pool', async () => {
    testDb.prepare(`
      INSERT INTO staff_flags (location_id, cook_id, flag, effective_from, effective_to)
      VALUES ('default', 'morgan', 'manager', '2025-01-01', NULL)
    `).run();
    const res = await POST(postReq({
      shift_date: todayISO(), pool_ref: 'POOL-1', cook_id: 'morgan',
      kind: 'tip_pool', amount_cents: 5000,
    }));
    assert.strictEqual(res.status, 422);
    const body = await res.json();
    assert.match(body.error, /excluded/);
    assert.match(body.citation, /§3\.4/);
    assert.strictEqual(countDist(), 0);
    assert.strictEqual(countAudit(), 0);
  });

  it('200 when manager flag active but kind=service_charge (legal path)', async () => {
    testDb.prepare(`
      INSERT INTO staff_flags (location_id, cook_id, flag, effective_from, effective_to)
      VALUES ('default', 'morgan', 'manager', '2025-01-01', NULL)
    `).run();
    const res = await POST(postReq({
      shift_date: todayISO(), pool_ref: 'POOL-1', cook_id: 'morgan',
      kind: 'service_charge', amount_cents: 5000,
    }));
    assert.strictEqual(res.status, 200);
    assert.strictEqual(countDist(), 1);
  });

  it('expired manager flag does NOT block (effective_to set)', async () => {
    testDb.prepare(`
      INSERT INTO staff_flags (location_id, cook_id, flag, effective_from, effective_to)
      VALUES ('default', 'morgan', 'manager', '2024-01-01', '2025-12-31')
    `).run();
    const res = await POST(postReq({
      shift_date: todayISO(), pool_ref: 'POOL-1', cook_id: 'morgan',
      kind: 'tip_pool', amount_cents: 5000,
    }));
    assert.strictEqual(res.status, 200);
  });
});

// ── GET ──────────────────────────────────────────────────────────

describe('GET /api/tip-pool', () => {
  it('returns empty arrays + zeros for clean day', async () => {
    const res = await GET(getReq());
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.deepStrictEqual(body.rows, []);
    assert.strictEqual(body.summary.total_cents, 0);
    assert.ok(body.comps);
    assert.strictEqual(body.comps.tipped_min_wage_cents, 1179);
  });

  it('returns rows + summary for the queried date', async () => {
    await POST(postReq({ shift_date: todayISO(), pool_ref: 'POOL-1', cook_id: 'alice', kind: 'tip_pool', amount_cents: 5000 }));
    await POST(postReq({ shift_date: todayISO(), pool_ref: 'POOL-1', cook_id: 'bob', kind: 'tip_pool', amount_cents: 3000 }));
    const res = await GET(getReq());
    const body = await res.json();
    assert.strictEqual(body.rows.length, 2);
    assert.strictEqual(body.summary.total_cents, 8000);
    assert.strictEqual(body.summary.by_cook.alice, 5000);
  });

  it('honors ?pool_ref filter', async () => {
    await POST(postReq({ shift_date: todayISO(), pool_ref: 'POOL-A', cook_id: 'alice', kind: 'tip_pool', amount_cents: 5000 }));
    await POST(postReq({ shift_date: todayISO(), pool_ref: 'POOL-B', cook_id: 'bob', kind: 'tip_pool', amount_cents: 3000 }));
    const res = await GET(getReq('?pool_ref=POOL-A'));
    const body = await res.json();
    assert.strictEqual(body.rows.length, 1);
    assert.strictEqual(body.rows[0].pool_ref, 'POOL-A');
  });
});

// ── Idempotency ──────────────────────────────────────────────────

describe('POST /api/tip-pool — idempotency', () => {
  it('replayed key returns same response, no duplicate row', async () => {
    const headers = { 'idempotency-key': 'tip-pool-test-key-aaaaaaaaaaaaa1' };
    const body = {
      shift_date: todayISO(), pool_ref: 'POOL-1', cook_id: 'alice',
      kind: 'tip_pool', amount_cents: 5000,
    };
    const r1 = await POST(postReq(body, headers));
    const j1 = await r1.json();
    const r2 = await POST(postReq(body, headers));
    const j2 = await r2.json();
    assert.deepStrictEqual(j1, j2);
    assert.strictEqual(countDist(), 1);
    assert.strictEqual(countAudit(), 1);
  });
});
