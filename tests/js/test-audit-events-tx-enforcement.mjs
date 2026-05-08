#!/usr/bin/env node
// postAuditEvent — transaction-context enforcement (unit-level pin).
//
// Contract: postAuditEvent MUST be called inside a db.transaction(...).
// If it is not, the function THROWS — atomicity is required so an audit
// failure rolls back the source row (CLAUDE.md / docs/PATTERNS.md §3).
//
// This file owns the unit-level enforcement of that invariant. The
// successor of the prior warn-only pins that lived in
// test-haccp-audit-atomicity.mjs.
//
// Three cases:
//   1. Throws when called outside a transaction.
//   2. Succeeds (returns numeric id, row exists) when called inside one.
//   3. Thrown error message contains both `entity` and `action` so the
//      stack trace points the developer at the violating call site.
//
// Run: node --experimental-strip-types --test tests/js/test-audit-events-tx-enforcement.mjs

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

register(new URL('./resolver.mjs', import.meta.url));

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-audit-tx-enforcement-'));
const TMP_DB = path.join(TMP_DIR, 'lariat-test.db');

const db = await import('../../lib/db.ts');
const auditEvents = await import('../../lib/auditEvents.ts');

db.setDbPathForTest(TMP_DB);
const testDb = db.getDb();

const { postAuditEvent } = auditEvents;

after(() => {
  db.setDbPathForTest(null);
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('postAuditEvent — transaction-context enforcement', () => {
  it('THROWS when called outside a db.transaction', () => {
    assert.throws(
      () => {
        postAuditEvent({
          entity: 'temp_log',
          entity_id: null,
          action: 'insert',
          actor_cook_id: null,
          actor_source: 'api',
        });
      },
      /transaction context/i,
      'postAuditEvent must throw when invoked outside a transaction',
    );
  });

  it('succeeds inside db.transaction — returns numeric id, row exists', () => {
    const beforeCount = testDb
      .prepare('SELECT COUNT(*) AS c FROM audit_events WHERE entity = ?')
      .get('cooling_log').c;

    let returnedId;
    const run = testDb.transaction(() => {
      returnedId = postAuditEvent({
        entity: 'cooling_log',
        entity_id: 42,
        action: 'insert',
        actor_cook_id: 'alice',
        actor_source: 'api',
        note: 'tx-enforcement happy path',
      });
    });
    run();

    assert.strictEqual(typeof returnedId, 'number', 'expected numeric id');
    assert.ok(returnedId > 0, `expected positive id, got ${returnedId}`);

    const row = testDb
      .prepare('SELECT id, entity, entity_id, action, actor_cook_id, note FROM audit_events WHERE id = ?')
      .get(returnedId);
    assert.ok(row, 'audit_events row must exist');
    assert.strictEqual(row.entity, 'cooling_log');
    assert.strictEqual(row.entity_id, 42);
    assert.strictEqual(row.action, 'insert');
    assert.strictEqual(row.actor_cook_id, 'alice');
    assert.strictEqual(row.note, 'tx-enforcement happy path');

    const afterCount = testDb
      .prepare('SELECT COUNT(*) AS c FROM audit_events WHERE entity = ?')
      .get('cooling_log').c;
    assert.strictEqual(afterCount, beforeCount + 1, 'exactly one new row');
  });

  it('thrown error message names both `entity` and `action`', () => {
    let thrown;
    try {
      postAuditEvent({
        entity: 'sanitizer_checks',
        entity_id: null,
        action: 'correction',
        actor_cook_id: null,
        actor_source: 'api',
      });
    } catch (err) {
      thrown = err;
    }
    assert.ok(thrown instanceof Error, 'expected Error instance');
    assert.match(thrown.message, /sanitizer_checks/, 'message should contain entity');
    assert.match(thrown.message, /correction/, 'message should contain action');
  });
});
