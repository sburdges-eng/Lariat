#!/usr/bin/env node
// Integration tests for /api/checks — glove-change attestation tri-state
// persistence (F15, FDA §3-301.11: bare-hand-contact-with-RTE).
//
// The `glove_change_attested` column on `line_check_entries` is strictly
// tri-state:
//   boolean true  → SQL 1
//   boolean false → SQL 0
//   anything else → SQL NULL   (missing, null, string "true", number 1, …)
//
// NULL means "this line-check item doesn't touch RTE food"; 0 means
// "touches RTE, not yet attested"; 1 means "cook attested fresh gloves".
// The strict bool check in the route prevents silent truthy coercion
// (e.g. the string "false" becoming 0). These tests pin that behavior.
//
// This file mirrors the shape of test-tphc-api.mjs (same project patterns,
// same setDbPathForTest approach, same Request-object construction).
// Audit events for /api/checks: every successful POST writes one row to
// `audit_events` inside the same transaction as the line-check insert
// (docs/PATTERNS.md §3). The "Audit trail" describe-block below pins
// that contract. /api/checks is not PIN-gated (cooks need it on the
// iPad without typing the manager PIN).
//
// Run: node --test tests/js/test-checks-api.mjs

import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

register(new URL('./resolver.mjs', import.meta.url));

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-checks-api-'));
const TMP_DB = path.join(TMP_DIR, 'lariat-test.db');

const db = await import('../../lib/db.ts');
const route = await import('../../app/api/checks/route.js');

db.setDbPathForTest(TMP_DB);
const testDb = db.getDb();

const { POST, GET } = route;

const SHIFT_DATE = '2026-04-20';
const STATION = 'saute';

after(() => {
  db.setDbPathForTest(null);
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

beforeEach(() => {
  testDb.exec('DELETE FROM line_check_entries;');
  testDb.exec('DELETE FROM audit_events;');
});

// ── Helpers ──────────────────────────────────────────────────────

function postReq(body) {
  return new Request('http://localhost/api/checks', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function getReq(qs = '') {
  return new Request(`http://localhost/api/checks${qs}`);
}

async function postAndReturnRow(body) {
  const res = await POST(postReq(body));
  assert.strictEqual(res.status, 200, `expected 200, got ${res.status}`);
  const json = await res.json();
  assert.strictEqual(json.ok, true);
  const row = testDb
    .prepare('SELECT * FROM line_check_entries WHERE id = ?')
    .get(json.id);
  assert.ok(row, 'row must be retrievable by returned id');
  return row;
}

function baseBody(overrides = {}) {
  return {
    shift_date: SHIFT_DATE,
    station_id: STATION,
    item: 'tomato dice mise',
    status: 'pass',
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────
// POST — tri-state persistence (F15)
// ─────────────────────────────────────────────────────────────────

describe('POST /api/checks — glove_change_attested tri-state persistence', () => {
  it('boolean true → persists as SQL 1', async () => {
    const row = await postAndReturnRow(baseBody({ glove_change_attested: true }));
    assert.strictEqual(row.glove_change_attested, 1);
  });

  it('boolean false → persists as SQL 0', async () => {
    const row = await postAndReturnRow(baseBody({ glove_change_attested: false }));
    assert.strictEqual(row.glove_change_attested, 0);
  });

  it('field omitted entirely → persists as SQL NULL', async () => {
    const row = await postAndReturnRow(baseBody());
    assert.strictEqual(row.glove_change_attested, null);
  });

  it('explicit null → persists as SQL NULL', async () => {
    const row = await postAndReturnRow(baseBody({ glove_change_attested: null }));
    assert.strictEqual(row.glove_change_attested, null);
  });

  it('string "true" → persists as SQL NULL (strict bool only; no coercion)', async () => {
    const row = await postAndReturnRow(baseBody({ glove_change_attested: 'true' }));
    assert.strictEqual(row.glove_change_attested, null);
  });

  it('string "false" → persists as SQL NULL (strict bool only; no silent 0)', async () => {
    // This is the specific regression the strict === check guards against:
    // truthy "false" would silently become 0 under a loose coercion.
    const row = await postAndReturnRow(baseBody({ glove_change_attested: 'false' }));
    assert.strictEqual(row.glove_change_attested, null);
  });

  it('number 1 → persists as SQL NULL (strict bool only)', async () => {
    const row = await postAndReturnRow(baseBody({ glove_change_attested: 1 }));
    assert.strictEqual(row.glove_change_attested, null);
  });

  it('number 0 → persists as SQL NULL (strict bool only)', async () => {
    const row = await postAndReturnRow(baseBody({ glove_change_attested: 0 }));
    assert.strictEqual(row.glove_change_attested, null);
  });
});

// ─────────────────────────────────────────────────────────────────
// POST — legacy regression (row shape without the new field)
// ─────────────────────────────────────────────────────────────────

describe('POST /api/checks — legacy regression', () => {
  it('legacy body (no glove_change_attested) round-trips other columns and leaves attestation NULL', async () => {
    const row = await postAndReturnRow({
      shift_date: SHIFT_DATE,
      station_id: STATION,
      item: 'oil level',
      status: 'pass',
      par: '8qt',
      have: '6qt',
      need: '2qt',
      note: 'topped off from drum A',
      cook_id: 'alice',
    });
    assert.strictEqual(row.shift_date, SHIFT_DATE);
    assert.strictEqual(row.station_id, STATION);
    assert.strictEqual(row.item, 'oil level');
    assert.strictEqual(row.status, 'pass');
    assert.strictEqual(row.par, '8qt');
    assert.strictEqual(row.have, '6qt');
    assert.strictEqual(row.need, '2qt');
    assert.strictEqual(row.note, 'topped off from drum A');
    assert.strictEqual(row.cook_id, 'alice');
    assert.strictEqual(row.glove_change_attested, null);
  });
});

// ─────────────────────────────────────────────────────────────────
// POST — validation (400) unchanged from pre-F15
// ─────────────────────────────────────────────────────────────────

describe('POST /api/checks — required-field validation', () => {
  it('400 "missing fields" when shift_date is missing', async () => {
    const res = await POST(postReq({ station_id: STATION, item: 'x', status: 'pass' }));
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.strictEqual(body.error, 'missing fields');
    assert.strictEqual(testDb.prepare('SELECT COUNT(*) AS c FROM line_check_entries').get().c, 0);
  });

  it('400 "missing fields" when item is missing', async () => {
    const res = await POST(postReq({ shift_date: SHIFT_DATE, station_id: STATION, status: 'pass' }));
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.strictEqual(body.error, 'missing fields');
    assert.strictEqual(testDb.prepare('SELECT COUNT(*) AS c FROM line_check_entries').get().c, 0);
  });

  it('400 "missing fields" when station_id is missing', async () => {
    const res = await POST(postReq({ shift_date: SHIFT_DATE, item: 'x', status: 'pass' }));
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.strictEqual(body.error, 'missing fields');
    assert.strictEqual(testDb.prepare('SELECT COUNT(*) AS c FROM line_check_entries').get().c, 0);
  });

  it('400 still fires even when glove_change_attested is provided (validation runs first)', async () => {
    const res = await POST(postReq({
      // shift_date missing
      station_id: STATION,
      item: 'x',
      glove_change_attested: true,
    }));
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.strictEqual(body.error, 'missing fields');
  });
});

// ─────────────────────────────────────────────────────────────────
// GET — round-trip of tri-state values
// ─────────────────────────────────────────────────────────────────

describe('GET /api/checks — tri-state round-trip', () => {
  it('GET returns all three rows with glove_change_attested preserved as 1 / 0 / null', async () => {
    await POST(postReq(baseBody({ item: 'ready-to-eat salsa portion', glove_change_attested: true })));
    await POST(postReq(baseBody({ item: 'ready-to-eat pico', glove_change_attested: false })));
    await POST(postReq(baseBody({ item: 'raw chicken portion' /* omitted — not RTE */ })));

    const res = await GET(getReq(`?date=${SHIFT_DATE}&station=${STATION}`));
    assert.strictEqual(res.status, 200);
    const rows = await res.json();
    assert.strictEqual(rows.length, 3);

    const byItem = Object.fromEntries(rows.map((r) => [r.item, r]));
    assert.strictEqual(byItem['ready-to-eat salsa portion'].glove_change_attested, 1);
    assert.strictEqual(byItem['ready-to-eat pico'].glove_change_attested, 0);
    assert.strictEqual(byItem['raw chicken portion'].glove_change_attested, null);
  });

  it('GET preserves the raw column value (no truthy collapse of 0 → null)', async () => {
    // Belt-and-suspenders: make sure the JSON encoder doesn't turn a
    // persisted 0 into null or false on the way out.
    await POST(postReq(baseBody({ item: 'rte item', glove_change_attested: false })));
    const res = await GET(getReq(`?date=${SHIFT_DATE}&station=${STATION}`));
    const rows = await res.json();
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].glove_change_attested, 0);
    // And verify it's a numeric 0, not the boolean false.
    assert.notStrictEqual(rows[0].glove_change_attested, false);
    assert.notStrictEqual(rows[0].glove_change_attested, null);
  });
});

// ─────────────────────────────────────────────────────────────────
// Audit trail — per docs/PATTERNS.md §3 every regulated mutation must
// post one audit_events row inside the same transaction as the source
// INSERT. line_check_entries is HACCP-regulated (F15 RTE attestation,
// pass/fail records that feed station sign-off), so /api/checks must
// audit. Pre-fix, the POST handler INSERTed the row outside any
// transaction and never called postAuditEvent — silent gap.
// ─────────────────────────────────────────────────────────────────

describe('POST /api/checks — audit trail (docs/PATTERNS.md §3)', () => {
  it('successful POST writes one audit_events row tied to the inserted line-check id', async () => {
    const row = await postAndReturnRow(baseBody({
      item: 'rte salad portion',
      cook_id: 'alice',
      glove_change_attested: true,
    }));
    const audit = testDb
      .prepare(
        `SELECT * FROM audit_events
          WHERE entity = 'line_check_entries' AND entity_id = ?`
      )
      .get(row.id);
    assert.ok(audit, 'audit row must exist for the inserted line-check');
    assert.strictEqual(audit.action, 'insert');
    assert.strictEqual(audit.actor_source, 'cook_ui');
    assert.strictEqual(audit.actor_cook_id, 'alice');
    assert.strictEqual(audit.location_id, 'default');
    assert.strictEqual(audit.shift_date, SHIFT_DATE);

    const payload = JSON.parse(audit.payload_json || '{}');
    assert.strictEqual(payload.station_id, STATION);
    assert.strictEqual(payload.item, 'rte salad portion');
    assert.strictEqual(payload.status, 'pass');
    assert.strictEqual(payload.glove_change_attested, 1);
  });

  it('400 / validation failure writes NO audit row (handler short-circuits before tx)', async () => {
    const res = await POST(postReq({ station_id: STATION, item: 'x', status: 'pass' }));
    assert.strictEqual(res.status, 400);
    const auditCount = testDb
      .prepare(`SELECT COUNT(*) AS c FROM audit_events WHERE entity = 'line_check_entries'`)
      .get().c;
    assert.strictEqual(auditCount, 0);
  });

  it('one POST → exactly one audit row (no duplicates)', async () => {
    await postAndReturnRow(baseBody({ item: 'oil temp' }));
    const c = testDb
      .prepare(`SELECT COUNT(*) AS c FROM audit_events WHERE entity = 'line_check_entries'`)
      .get().c;
    assert.strictEqual(c, 1);
  });
});

// ─────────────────────────────────────────────────────────────────
// Location scoping
// ─────────────────────────────────────────────────────────────────

describe('GET /api/checks — location scoping', () => {
  it('a row posted with location_id=lariat-south is NOT returned by a default-location GET', async () => {
    await POST(postReq(baseBody({
      item: 'south-only item',
      glove_change_attested: true,
      location_id: 'lariat-south',
    })));

    // Sanity: row is actually in the DB under the south location.
    const southRowCount = testDb
      .prepare(`SELECT COUNT(*) AS c FROM line_check_entries WHERE location_id='lariat-south'`)
      .get().c;
    assert.strictEqual(southRowCount, 1);

    // Default GET (no ?location=) must not see it.
    const defRes = await GET(getReq(`?date=${SHIFT_DATE}&station=${STATION}`));
    const defRows = await defRes.json();
    assert.strictEqual(defRows.length, 0);

    // Scoped GET does see it, with attestation preserved.
    const southRes = await GET(getReq(`?date=${SHIFT_DATE}&station=${STATION}&location=lariat-south`));
    const southRows = await southRes.json();
    assert.strictEqual(southRows.length, 1);
    assert.strictEqual(southRows[0].item, 'south-only item');
    assert.strictEqual(southRows[0].glove_change_attested, 1);
  });
});
