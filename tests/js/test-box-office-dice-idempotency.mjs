#!/usr/bin/env node
// bulkUpsertFromDice — idempotency contract.
//
// Found via the 2026-05-02 breaker audit (Section 5 P1):
//   docs/agentic/findings/2026-05-02-dice-idempotency-not-enforced.md
//
// Phase 2 §C2 plans `scripts/ingest-dice.mjs` to call this helper. A
// network-hiccup retry mid-batch must NOT produce duplicate
// box_office_lines rows — duplicates inflate getSettlement's grossCents
// which inflates the talent vsBonus, silently overpaying talent.
//
// Pins:
//   1. First call inserts N rows.
//   2. Second call with identical input is idempotent — still N rows,
//      no audit rows added on the second pass.
//   3. Updated face_price triggers UPDATE not INSERT, with an audit
//      row carrying before/after.
//   4. Walkup / comp lines (no external_ref) don't collide via the
//      partial UNIQUE constraint — multiple NULL external_refs are
//      allowed.
//   5. Same external_ref under a DIFFERENT source ('walkup' vs 'dice')
//      doesn't collide — the constraint is on (source, external_ref).
//
// Run: node --experimental-strip-types --test tests/js/test-box-office-dice-idempotency.mjs

import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

register(new URL('./resolver.mjs', import.meta.url));

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-dice-idem-'));
const TMP_DB = path.join(TMP_DIR, 'lariat-test.db');

const db = await import('../../lib/db.ts');
db.setDbPathForTest(TMP_DB);
const testDb = db.getDb();

const { bulkUpsertFromDice, createBoxOfficeLine } = await import(
  '../../lib/boxOfficeRepo.ts'
);

after(() => {
  db.setDbPathForTest(null);
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

beforeEach(() => {
  testDb.exec(`
    DELETE FROM audit_events;
    DELETE FROM box_office_lines;
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

const BATCH_A = [
  {
    show_id: 1,
    location_id: 'default',
    external_ref: 'DICE-1001',
    ticket_class: 'GA',
    qty: 1,
    face_price: 25.0,
    fees: 4.5,
  },
  {
    show_id: 1,
    location_id: 'default',
    external_ref: 'DICE-1002',
    ticket_class: 'VIP',
    qty: 2,
    face_price: 75.0,
    fees: 10.0,
  },
  {
    show_id: 1,
    location_id: 'default',
    external_ref: 'DICE-1003',
    ticket_class: 'GA',
    qty: 1,
    face_price: 25.0,
    fees: 4.5,
  },
];

function countRows(table) {
  return testDb.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get().c;
}

function countAuditByEntity(entity) {
  return testDb
    .prepare('SELECT COUNT(*) AS c FROM audit_events WHERE entity = ?')
    .get(entity).c;
}

describe('bulkUpsertFromDice — first-call inserts', () => {
  it('inserts N rows and N audit events', () => {
    const result = bulkUpsertFromDice(testDb, BATCH_A);
    assert.deepStrictEqual(result, { inserted: 3, updated: 0 });
    assert.strictEqual(countRows('box_office_lines'), 3);
    assert.strictEqual(countAuditByEntity('box_office_lines'), 3);
  });
});

describe('bulkUpsertFromDice — idempotency on retry', () => {
  it('second identical call writes neither rows nor audit', () => {
    bulkUpsertFromDice(testDb, BATCH_A);
    const auditBefore = countAuditByEntity('box_office_lines');

    const result = bulkUpsertFromDice(testDb, BATCH_A);
    assert.deepStrictEqual(result, { inserted: 0, updated: 0 });
    assert.strictEqual(
      countRows('box_office_lines'), 3,
      'no duplicate rows on retry',
    );
    assert.strictEqual(
      countAuditByEntity('box_office_lines'), auditBefore,
      'no audit churn on a no-op retry',
    );
  });

  it('three retries still produce only the original 3 rows', () => {
    bulkUpsertFromDice(testDb, BATCH_A);
    bulkUpsertFromDice(testDb, BATCH_A);
    bulkUpsertFromDice(testDb, BATCH_A);
    assert.strictEqual(countRows('box_office_lines'), 3);
  });
});

describe('bulkUpsertFromDice — DICE revision (price change)', () => {
  it('updated face_price triggers UPDATE not INSERT', () => {
    bulkUpsertFromDice(testDb, BATCH_A);
    const auditBefore = countAuditByEntity('box_office_lines');

    const revised = [
      { ...BATCH_A[0], face_price: 30.0 }, // upgraded ticket
      BATCH_A[1],                          // unchanged
      BATCH_A[2],                          // unchanged
    ];
    const result = bulkUpsertFromDice(testDb, revised);
    assert.deepStrictEqual(result, { inserted: 0, updated: 1 });
    assert.strictEqual(
      countRows('box_office_lines'), 3,
      'UPDATE must NOT add a new row',
    );

    const row = testDb
      .prepare(`SELECT face_price FROM box_office_lines WHERE external_ref = ?`)
      .get('DICE-1001');
    assert.strictEqual(row.face_price, 30.0);

    assert.strictEqual(
      countAuditByEntity('box_office_lines'), auditBefore + 1,
      'one audit row for the one revised line',
    );
    const auditRow = testDb
      .prepare(
        `SELECT action, payload_json FROM audit_events
          WHERE entity = 'box_office_lines'
          ORDER BY id DESC LIMIT 1`,
      )
      .get();
    assert.strictEqual(auditRow.action, 'update');
    const payload = JSON.parse(auditRow.payload_json);
    assert.strictEqual(payload.op, 'dice_revision');
    assert.strictEqual(payload.before.face_price, 25.0);
    assert.strictEqual(payload.after.face_price, 30.0);
  });
});

describe('bulkUpsertFromDice — walkup / comp without external_ref do not collide', () => {
  it('multiple walkup lines with NULL external_ref all insert', () => {
    // Three walkup lines through the per-line writer (not bulkUpsertFromDice).
    // The partial UNIQUE constraint is `WHERE external_ref IS NOT NULL`,
    // so multiple NULL refs MUST be permitted.
    for (let i = 0; i < 3; i++) {
      createBoxOfficeLine(testDb, {
        show_id: 1,
        location_id: 'default',
        source: 'walkup',
        qty: 1,
        face_price: 25.0,
        fees: 0,
        external_ref: null,
      });
    }
    const walkupCount = testDb
      .prepare(
        `SELECT COUNT(*) AS c FROM box_office_lines WHERE source = 'walkup'`,
      )
      .get().c;
    assert.strictEqual(walkupCount, 3);
  });
});

describe('bulkUpsertFromDice — partial UNIQUE keys on (source, external_ref) not external_ref alone', () => {
  it('same external_ref string under a DIFFERENT source does not collide', () => {
    bulkUpsertFromDice(testDb, [BATCH_A[0]]);
    // Insert a walkup line that happens to also carry "DICE-1001" as a
    // free-text external_ref (e.g. a manual cross-reference). Should
    // not violate the constraint because the constraint key includes
    // source.
    createBoxOfficeLine(testDb, {
      show_id: 1,
      location_id: 'default',
      source: 'walkup',
      qty: 1,
      face_price: 25.0,
      fees: 0,
      external_ref: 'DICE-1001',
    });
    const total = testDb
      .prepare(`SELECT COUNT(*) AS c FROM box_office_lines`)
      .get().c;
    assert.strictEqual(total, 2);
  });

  it('two distinct DICE external_refs both insert', () => {
    bulkUpsertFromDice(testDb, [BATCH_A[0], BATCH_A[1]]);
    assert.strictEqual(countRows('box_office_lines'), 2);
  });
});

describe('bulkUpsertFromDice — input validation', () => {
  it('throws on missing external_ref', () => {
    assert.throws(
      () => bulkUpsertFromDice(testDb, [{ ...BATCH_A[0], external_ref: '' }]),
      /external_ref must be a non-empty string/,
    );
    assert.strictEqual(countRows('box_office_lines'), 0);
  });

  it('throws on non-positive qty', () => {
    assert.throws(
      () => bulkUpsertFromDice(testDb, [{ ...BATCH_A[0], qty: 0 }]),
      /qty must be a positive integer/,
    );
  });
});
