#!/usr/bin/env node
// POST /api/shows/[id]/box-office — idempotency replay must NOT
// double-write a regulated cash-custody row.
//
// Task 2 of the §8 P1 plan. The DICE-bulk-import idempotency was
// closed by #113 via the (source, external_ref) partial UNIQUE
// index. This file pins the per-request idempotency for the
// per-line POST path that walkup / comp / will_call / guestlist
// use — those don't carry an external_ref, so the partial unique
// index doesn't apply.
//
// Run: node --experimental-strip-types --test tests/js/test-box-office-route-idempotency.mjs

import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

register(new URL('./resolver.mjs', import.meta.url));

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-bo-idem-'));
const TMP_DB = path.join(TMP_DIR, 'lariat-test.db');

const ORIGINAL_PIN = process.env.LARIAT_PIN;
delete process.env.LARIAT_PIN; // LAN-trust mode for test simplicity

const db = await import('../../lib/db.ts');
db.setDbPathForTest(TMP_DB);
const testDb = db.getDb();

const route = await import('../../app/api/shows/[id]/box-office/route.js');

after(() => {
  db.setDbPathForTest(null);
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
  if (ORIGINAL_PIN === undefined) delete process.env.LARIAT_PIN;
  else process.env.LARIAT_PIN = ORIGINAL_PIN;
});

beforeEach(() => {
  testDb.exec(`
    DELETE FROM audit_events;
    DELETE FROM box_office_lines;
    DELETE FROM idempotency_keys;
    DELETE FROM shows;
    DELETE FROM ingest_runs;
  `);
  testDb
    .prepare(
      `INSERT INTO ingest_runs (id, kind, started_at, status)
       VALUES (1, 'test', datetime('now'), 'ok')`,
    )
    .run();
  testDb
    .prepare(
      `INSERT INTO shows (id, location_id, band_name, show_date, source_row,
                          ingested_at, ingest_run_id)
       VALUES (1, 'default', 'Test Band', '2026-06-01', 1, datetime('now'), 1)`,
    )
    .run();
});

function postReq(showId, body, { idempotencyKey } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (idempotencyKey) headers['idempotency-key'] = idempotencyKey;
  return new Request(`http://localhost/api/shows/${showId}/box-office`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

const WALKUP_LINE = {
  source: 'walkup',
  qty: 1,
  face_price: 25.0,
  fees: 0,
  ticket_class: 'GA',
  actor_cook_id: 'door-anna',
};

function countRows(table) {
  return testDb.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get().c;
}

describe('POST /api/shows/[id]/box-office — idempotency replay', () => {
  it('replayed POST with same key writes ONE line, ONE audit, returns identical body', async () => {
    const KEY = 'bo-line-key-aaaaaaaaaaaa';

    const r1 = await route.POST(postReq(1, WALKUP_LINE, { idempotencyKey: KEY }), {
      params: { id: '1' },
    });
    assert.strictEqual(r1.status, 201);
    const body1 = await r1.json();
    assert.ok(body1.line);
    assert.strictEqual(body1.line.qty, 1);

    // Replay — same key, same payload.
    const r2 = await route.POST(postReq(1, WALKUP_LINE, { idempotencyKey: KEY }), {
      params: { id: '1' },
    });
    assert.strictEqual(r2.status, 201);
    const body2 = await r2.json();

    assert.deepStrictEqual(body1, body2, 'replay returns cached body verbatim');
    assert.strictEqual(
      countRows('box_office_lines'), 1,
      'replay must NOT write a second box-office line',
    );
    assert.strictEqual(
      countRows('audit_events'), 1,
      'replay must NOT write a second audit row',
    );
  });

  it('three retries still produce only one row (idempotent)', async () => {
    const KEY = 'bo-line-key-bbbbbbbbbbbb';
    for (let i = 0; i < 3; i++) {
      const r = await route.POST(postReq(1, WALKUP_LINE, { idempotencyKey: KEY }), {
        params: { id: '1' },
      });
      assert.strictEqual(r.status, 201);
    }
    assert.strictEqual(countRows('box_office_lines'), 1);
  });

  it('different keys for two distinct walkup lines write both', async () => {
    await route.POST(postReq(1, WALKUP_LINE, { idempotencyKey: 'k-aaaaaaaaaaaaaaaa' }), {
      params: { id: '1' },
    });
    await route.POST(
      postReq(1, { ...WALKUP_LINE, qty: 2 }, { idempotencyKey: 'k-bbbbbbbbbbbbbbbb' }),
      { params: { id: '1' } },
    );
    assert.strictEqual(countRows('box_office_lines'), 2);
  });

  it('same key + different body returns 409 without writing a second row', async () => {
    const KEY = 'bo-409-key-aaaaaaaaaaaa';
    await route.POST(postReq(1, WALKUP_LINE, { idempotencyKey: KEY }), {
      params: { id: '1' },
    });
    assert.strictEqual(countRows('box_office_lines'), 1);

    const r2 = await route.POST(
      postReq(1, { ...WALKUP_LINE, face_price: 99.99 }, { idempotencyKey: KEY }),
      { params: { id: '1' } },
    );
    assert.strictEqual(r2.status, 409);
    assert.strictEqual(
      countRows('box_office_lines'), 1,
      'mismatched-hash replay must NOT write',
    );
  });

  it('un-keyed POST is unchanged from pre-wrapper behavior', async () => {
    // No idempotency-key header — wrapper passes through, two POSTs
    // legitimately write two rows. (The UI is responsible for key
    // injection via clientFetch; this case proves curl/scripts/legacy
    // clients keep working.)
    await route.POST(postReq(1, WALKUP_LINE), { params: { id: '1' } });
    await route.POST(postReq(1, WALKUP_LINE), { params: { id: '1' } });
    assert.strictEqual(countRows('box_office_lines'), 2);
  });
});
