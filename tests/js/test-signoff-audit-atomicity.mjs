#!/usr/bin/env node
// Signoff audit atomicity — pins the contract that POST /api/signoff
// writes one row to station_signoffs AND one row to audit_events inside
// the same db.transaction.
//
// Found via the 2026-05-01 breaker audit (Section 1 — HACCP rules + API
// audit atomicity). The route used to INSERT into station_signoffs
// without ever calling postAuditEvent, leaving manager attestations of
// CCP checks invisible in the audit trail. Two existing tests touching
// station_signoffs (test-bundle-h-apis, test-toctou-race-regressions)
// treated the table as a read-only projection and missed the gap.
//
// This file pins:
//   1. Happy path — POST commits both station_signoffs and audit_events.
//   2. No "outside transaction" warn during the route's normal path.
//   3. If audit_events is broken mid-flight, station_signoffs rolls back.
//   4. Audit row carries the right entity, action, actor, location.
//
// Run: node --experimental-strip-types --test tests/js/test-signoff-audit-atomicity.mjs

import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

register(new URL('./resolver.mjs', import.meta.url));

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-signoff-atomicity-'));
const TMP_DB = path.join(TMP_DIR, 'lariat-test.db');

const db = await import('../../lib/db.ts');

db.setDbPathForTest(TMP_DB);
const testDb = db.getDb();

const { todayISO } = db;

// Lazy-imported so setDbPathForTest has already run.
const signoff = await import('../../app/api/signoff/route.ts');

after(() => {
  db.setDbPathForTest(null);
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

beforeEach(() => {
  testDb.exec(`
    DELETE FROM audit_events;
    DELETE FROM station_signoffs;
    DELETE FROM line_check_entries;
    DELETE FROM idempotency_keys;
  `);
});

function postReq(url, body, { idempotencyKey } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (idempotencyKey) headers['idempotency-key'] = idempotencyKey;
  return new Request(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

function countRows(table) {
  return testDb.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get().c;
}

function countAudit(entity) {
  return testDb
    .prepare('SELECT COUNT(*) AS c FROM audit_events WHERE entity = ?')
    .get(entity).c;
}

async function captureWarnsAsync(fn) {
  const original = console.warn;
  const captured = [];
  console.warn = (...args) => { captured.push(args.map(String).join(' ')); };
  try {
    await fn();
  } finally {
    console.warn = original;
  }
  return { captured };
}

describe('POST /api/signoff — audit atomicity', () => {
  it('commits both station_signoffs and audit_events', async () => {
    const res = await signoff.POST(postReq('http://localhost/api/signoff', {
      shift_date: todayISO(),
      station_id: 'saute',
      cook_id: 'alice',
      signoff_type: 'self',
    }));
    assert.strictEqual(res.status, 200, `body: ${await res.text()}`);
    assert.strictEqual(countRows('station_signoffs'), 1, 'one signoff row');
    assert.strictEqual(countAudit('station_signoffs'), 1, 'one audit row');
  });

  it('emits NO "called outside" warn (audit is inside the transaction)', async () => {
    const { captured } = await captureWarnsAsync(async () => {
      await signoff.POST(postReq('http://localhost/api/signoff', {
        shift_date: todayISO(),
        station_id: 'saute',
        cook_id: 'alice',
        signoff_type: 'self',
      }));
    });
    const auditWarns = captured.filter((m) => /postAuditEvent called outside/.test(m));
    assert.strictEqual(auditWarns.length, 0, `unexpected audit warns: ${auditWarns.join(' | ')}`);
  });

  it('rolls back station_signoffs if audit_events INSERT fails', async () => {
    // Break the audit path the same way test-haccp-audit-atomicity does:
    // rename the table. The route will throw inside the transaction; the
    // entire tx must roll back, leaving station_signoffs untouched.
    testDb.exec(`ALTER TABLE audit_events RENAME TO audit_events_stash`);
    try {
      const beforeSignoffs = countRows('station_signoffs');
      const res = await signoff.POST(postReq('http://localhost/api/signoff', {
        shift_date: todayISO(),
        station_id: 'saute',
        cook_id: 'alice',
        signoff_type: 'self',
      }));
      assert.strictEqual(res.status, 500, 'route must 500 when audit write fails');
      assert.strictEqual(
        countRows('station_signoffs'),
        beforeSignoffs,
        'station_signoffs must be rolled back',
      );
    } finally {
      testDb.exec(`ALTER TABLE audit_events_stash RENAME TO audit_events`);
    }
  });

  it('audit row records entity, action, actor_cook_id, location, payload', async () => {
    await signoff.POST(postReq('http://localhost/api/signoff', {
      shift_date: '2026-05-01',
      station_id: 'saute',
      cook_id: 'alice',
      signoff_type: 'pic',
      location_id: 'south',
    }));
    const row = testDb
      .prepare(
        `SELECT entity, action, actor_cook_id, location_id, shift_date,
                payload_json
           FROM audit_events
          WHERE entity = 'station_signoffs'
          ORDER BY id DESC LIMIT 1`,
      )
      .get();
    assert.ok(row, 'audit row should exist');
    assert.strictEqual(row.entity, 'station_signoffs');
    assert.strictEqual(row.action, 'insert');
    assert.strictEqual(row.actor_cook_id, 'alice');
    assert.strictEqual(row.location_id, 'south');
    assert.strictEqual(row.shift_date, '2026-05-01');
    const payload = JSON.parse(row.payload_json);
    assert.strictEqual(payload.station_id, 'saute');
    assert.strictEqual(payload.signoff_type, 'pic');
  });

  it('409 unnoted-fails gate writes neither row', async () => {
    // Seed a failing line-check with no note for the same shift/station.
    testDb
      .prepare(
        `INSERT INTO line_check_entries
           (shift_date, station_id, item, status, note, location_id, created_at)
         VALUES (?, 'saute', 'walk-in cooler temp', 'fail', NULL, 'default', datetime('now'))`,
      )
      .run(todayISO());

    const res = await signoff.POST(postReq('http://localhost/api/signoff', {
      shift_date: todayISO(),
      station_id: 'saute',
      cook_id: 'alice',
      signoff_type: 'self',
    }));
    assert.strictEqual(res.status, 409);
    assert.strictEqual(countRows('station_signoffs'), 0, 'no signoff written');
    assert.strictEqual(countAudit('station_signoffs'), 0, 'no audit written');
  });
});

// §8 P1 Task 2 — idempotency replay must NOT double-write the
// regulated CCP attestation. Closes the doctrine gap surfaced by
// docs/agentic/findings/2026-05-02-sw-replay-no-idempotency.md.
describe('POST /api/signoff — idempotency replay', () => {
  it('replayed POST with same key writes ONE row, ONE audit, returns identical body', async () => {
    const KEY = 'signoff-key-aaaaaaaaaaaa';
    const payload = {
      shift_date: todayISO(),
      station_id: 'saute',
      cook_id: 'alice',
      signoff_type: 'self',
    };

    const r1 = await signoff.POST(
      postReq('http://localhost/api/signoff', payload, { idempotencyKey: KEY }),
    );
    assert.strictEqual(r1.status, 200);
    const body1 = await r1.json();

    // Replay — same key, same payload.
    const r2 = await signoff.POST(
      postReq('http://localhost/api/signoff', payload, { idempotencyKey: KEY }),
    );
    assert.strictEqual(r2.status, 200);
    const body2 = await r2.json();

    assert.deepStrictEqual(body1, body2, 'replay must return the cached body verbatim');
    assert.strictEqual(
      countRows('station_signoffs'), 1,
      'replay must NOT write a second signoff row',
    );
    assert.strictEqual(
      countAudit('station_signoffs'), 1,
      'replay must NOT write a second audit row',
    );
  });

  it('different idempotency-key writes a second row (distinct mutation)', async () => {
    const payload = {
      shift_date: todayISO(),
      station_id: 'saute',
      cook_id: 'alice',
      signoff_type: 'self',
    };
    await signoff.POST(
      postReq('http://localhost/api/signoff', payload, { idempotencyKey: 'k-aaaaaaaaaaaaaaaa' }),
    );
    await signoff.POST(
      postReq(
        'http://localhost/api/signoff',
        { ...payload, cook_id: 'bob' },
        { idempotencyKey: 'k-bbbbbbbbbbbbbbbb' },
      ),
    );
    assert.strictEqual(countRows('station_signoffs'), 2);
  });

  it('same key + different body returns 409 without writing a second row', async () => {
    const KEY = 'signoff-409-aaaaaaaaaaaa';
    await signoff.POST(
      postReq(
        'http://localhost/api/signoff',
        { shift_date: todayISO(), station_id: 'saute', cook_id: 'alice', signoff_type: 'self' },
        { idempotencyKey: KEY },
      ),
    );
    assert.strictEqual(countRows('station_signoffs'), 1);

    const r2 = await signoff.POST(
      postReq(
        'http://localhost/api/signoff',
        { shift_date: todayISO(), station_id: 'saute', cook_id: 'bob', signoff_type: 'pic' },
        { idempotencyKey: KEY },
      ),
    );
    assert.strictEqual(r2.status, 409);
    assert.strictEqual(
      countRows('station_signoffs'), 1,
      'mismatched-hash replay must NOT write a row',
    );
  });
});
