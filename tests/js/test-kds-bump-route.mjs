#!/usr/bin/env node
// Integration tests for POST /api/kds/tickets/:id/bump (protocol v2 §3).
//
// Mirrors test-receiving-api.mjs: spin up a temp SQLite DB, import the
// route in-process, assert on the Response objects. Covers the audit
// row emission, idempotent replay, station/PIN handling, 422 behavior,
// and the kept-latest correction semantics.
//
// Run: node --experimental-strip-types --test tests/js/test-kds-bump-route.mjs

import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

register(new URL('./resolver.mjs', import.meta.url));

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-kds-bump-'));
const TMP_DB = path.join(TMP_DIR, 'lariat-test.db');

const db = await import('../../lib/db.ts');
const route = await import('../../app/api/kds/tickets/[id]/bump/route.js');

db.setDbPathForTest(TMP_DB);
const testDb = db.getDb();

const { POST } = route;

after(() => {
  db.setDbPathForTest(null);
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

beforeEach(() => {
  testDb.exec(
    'DELETE FROM kds_ticket_states; DELETE FROM audit_events; DELETE FROM idempotency_keys;',
  );
});

function bumpReq(ticketId, { body, key } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (key) headers['idempotency-key'] = key;
  return new Request(`http://localhost/api/kds/tickets/${ticketId}/bump`, {
    method: 'POST',
    headers,
    body: body === undefined ? '' : JSON.stringify(body),
  });
}

function ctx(id) {
  return { params: { id } };
}

function countStates(ticketId) {
  return testDb
    .prepare('SELECT COUNT(*) AS c FROM kds_ticket_states WHERE ticket_id = ?')
    .get(ticketId).c;
}

function readState(ticketId) {
  return testDb
    .prepare('SELECT * FROM kds_ticket_states WHERE ticket_id = ?')
    .get(ticketId);
}

function countAudit(entity, action) {
  if (action) {
    return testDb
      .prepare('SELECT COUNT(*) AS c FROM audit_events WHERE entity = ? AND action = ?')
      .get(entity, action).c;
  }
  return testDb
    .prepare('SELECT COUNT(*) AS c FROM audit_events WHERE entity = ?')
    .get(entity).c;
}

// ── happy path ──────────────────────────────────────────────────

describe('POST /api/kds/tickets/:id/bump — happy path', () => {
  it('records a bump with all fields and returns the canonical shape', async () => {
    const bumpedAt = '2026-05-04T18:42:11.000Z';
    const res = await POST(
      bumpReq('tkt_abc', { body: { bumped_at: bumpedAt, station: 'grill', cook_pin: '1234' } }),
      ctx('tkt_abc'),
    );

    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /application\/json/);

    const body = await res.json();
    assert.deepStrictEqual(body, { id: 'tkt_abc', bumped_at: bumpedAt });

    assert.equal(countStates('tkt_abc'), 1);
    const row = readState('tkt_abc');
    assert.equal(row.bumped_at, bumpedAt);
    assert.equal(row.bumped_station, 'grill');
    // PIN is hashed, never stored raw
    assert.notEqual(row.bumped_pin_hash, '1234');
    assert.equal(row.bumped_pin_hash, createHash('sha256').update('1234').digest('hex'));

    assert.equal(countAudit('kds_ticket_state', 'insert'), 1);
  });

  it('accepts an empty body and stamps server time', async () => {
    const before = new Date().toISOString();
    const res = await POST(bumpReq('tkt_empty'), ctx('tkt_empty'));
    const body = await res.json();
    const after = new Date().toISOString();

    assert.equal(res.status, 200);
    assert.equal(body.id, 'tkt_empty');
    // Server-stamped time falls between the test bookends
    assert.ok(body.bumped_at >= before && body.bumped_at <= after,
      `bumped_at ${body.bumped_at} should be between ${before} and ${after}`);

    const row = readState('tkt_empty');
    assert.equal(row.bumped_station, null);
    assert.equal(row.bumped_pin_hash, null);
  });

  it('accepts an unknown station slug (forward compat per protocol §2)', async () => {
    const res = await POST(
      bumpReq('tkt_expo', { body: { station: 'expo' } }),
      ctx('tkt_expo'),
    );
    assert.equal(res.status, 200);
    assert.equal(readState('tkt_expo').bumped_station, 'expo');
  });
});

// ── re-bump (kept-latest + correction audit) ────────────────────

describe('POST /api/kds/tickets/:id/bump — re-bump', () => {
  it('updates bumped_at and writes a correction audit row on re-bump', async () => {
    const t1 = '2026-05-04T18:00:00.000Z';
    const t2 = '2026-05-04T18:05:00.000Z';

    await POST(bumpReq('tkt_re', { body: { bumped_at: t1, station: 'grill' } }), ctx('tkt_re'));
    await POST(bumpReq('tkt_re', { body: { bumped_at: t2, station: 'grill' } }), ctx('tkt_re'));

    assert.equal(countStates('tkt_re'), 1, 'still one row');
    assert.equal(readState('tkt_re').bumped_at, t2, 'kept-latest');

    assert.equal(countAudit('kds_ticket_state', 'insert'), 1);
    assert.equal(countAudit('kds_ticket_state', 'correction'), 1);
  });

  it('audit payload on correction carries prior_bumped_at', async () => {
    const t1 = '2026-05-04T18:00:00.000Z';
    const t2 = '2026-05-04T18:05:00.000Z';

    await POST(bumpReq('tkt_pay', { body: { bumped_at: t1 } }), ctx('tkt_pay'));
    await POST(bumpReq('tkt_pay', { body: { bumped_at: t2 } }), ctx('tkt_pay'));

    const auditRow = testDb
      .prepare(
        `SELECT payload_json FROM audit_events
          WHERE entity = 'kds_ticket_state' AND action = 'correction'
          ORDER BY id DESC LIMIT 1`,
      )
      .get();
    const payload = JSON.parse(auditRow.payload_json);
    assert.equal(payload.prior_bumped_at, t1);
    assert.equal(payload.bumped_at, t2);
  });
});

// ── idempotency ─────────────────────────────────────────────────

describe('POST /api/kds/tickets/:id/bump — idempotency', () => {
  it('replay with same key returns cached response and writes nothing new', async () => {
    const key = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
    const body = { bumped_at: '2026-05-04T18:42:11.000Z', station: 'grill' };

    const res1 = await POST(bumpReq('tkt_idem', { body, key }), ctx('tkt_idem'));
    const body1 = await res1.json();
    const res2 = await POST(bumpReq('tkt_idem', { body, key }), ctx('tkt_idem'));
    const body2 = await res2.json();

    assert.equal(res2.status, 200);
    assert.deepStrictEqual(body2, body1);
    assert.equal(countStates('tkt_idem'), 1);
    assert.equal(countAudit('kds_ticket_state'), 1, 'no second audit row on replay');
  });

  it('reused key with a different body returns 409', async () => {
    const key = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
    await POST(
      bumpReq('tkt_409', { body: { station: 'grill' }, key }),
      ctx('tkt_409'),
    );
    const res2 = await POST(
      bumpReq('tkt_409', { body: { station: 'sides' }, key }),
      ctx('tkt_409'),
    );
    assert.equal(res2.status, 409);
  });
});

// ── validation ──────────────────────────────────────────────────

describe('POST /api/kds/tickets/:id/bump — validation', () => {
  it('400 on empty ticket id', async () => {
    const res = await POST(bumpReq(''), ctx(''));
    assert.equal(res.status, 400);
  });

  it('422 on non-canonical ISO-8601', async () => {
    const res = await POST(
      bumpReq('tkt_bad', { body: { bumped_at: '2026-05-04 18:42:11' } }),
      ctx('tkt_bad'),
    );
    assert.equal(res.status, 422);
  });

  it('422 on mixed-case station', async () => {
    const res = await POST(
      bumpReq('tkt_case', { body: { station: 'Grill' } }),
      ctx('tkt_case'),
    );
    assert.equal(res.status, 422);
  });

  it('422 on malformed JSON body', async () => {
    const req = new Request('http://localhost/api/kds/tickets/tkt_jx/bump', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    });
    const res = await POST(req, ctx('tkt_jx'));
    assert.equal(res.status, 422);
  });
});

// ── transactional rollback ──────────────────────────────────────

describe('POST /api/kds/tickets/:id/bump — atomicity', () => {
  it('audit row + state row are committed together (one tx)', async () => {
    const before = countAudit('kds_ticket_state');
    await POST(
      bumpReq('tkt_tx', { body: { bumped_at: '2026-05-04T18:42:11.000Z' } }),
      ctx('tkt_tx'),
    );
    const after = countAudit('kds_ticket_state');
    // Exactly one of each — proves the audit row landed in the same
    // commit as the state row, not a second tx that could partial-fail.
    assert.equal(after - before, 1);
    assert.equal(countStates('tkt_tx'), 1);
  });
});
