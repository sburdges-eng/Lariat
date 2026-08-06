#!/usr/bin/env node
// postAuditEvent — the shift_date it stamps when the caller doesn't supply one.
//
// Contract: an audit row written during a service belongs to that SERVICE day,
// not to whatever calendar day UTC happens to be in. The ledger is the
// deterministic record a regulator reads; a cooling correction logged at 20:00
// on the 6th must not appear under the 7th.
//
// This pins a field nothing else asserted. `shift_date` had no test coverage in
// any audit suite, which is how it went unnoticed that the default came from
// todayISO() — a UTC slice that rolls over at 18:00 Mountain.
//
// Run: node --experimental-strip-types --test tests/js/test-audit-events-service-date.mjs

import { describe, it, after, mock } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

register(new URL('./resolver.mjs', import.meta.url));

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-audit-service-date-'));
const TMP_DB = path.join(TMP_DIR, 'lariat-test.db');

const db = await import('../../lib/db.ts');
const auditEvents = await import('../../lib/auditEvents.ts');
const { serviceDate } = await import('../../lib/serviceDate.ts');

db.setDbPathForTest(TMP_DB);
const testDb = db.getDb();
const { postAuditEvent } = auditEvents;

after(() => {
  db.setDbPathForTest(null);
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

/** Write one audit row inside a transaction (postAuditEvent requires one) and read its shift_date back. */
function writeAndReadShiftDate(note) {
  const id = testDb.transaction(() =>
    postAuditEvent({
      entity: 'temp_log',
      entity_id: null,
      action: 'insert',
      actor_cook_id: null,
      actor_source: 'cook_ui',
      payload: { note },
    }))();
  const row = /** @type {{ shift_date: string }} */ (
    testDb.prepare('SELECT shift_date FROM audit_events WHERE id = ?').get(id)
  );
  return row.shift_date;
}

describe('postAuditEvent — stamps the service date', () => {
  it('files a 20:00 write under the service day that began that morning', () => {
    // 2026-08-07T02:00Z is 6 Aug 20:00 MDT — mid dinner service on the 6th.
    // toISOString().slice(0,10) says '2026-08-07'. The ledger must say the 6th.
    mock.timers.enable({ apis: ['Date'], now: new Date('2026-08-07T02:00:00Z') });
    try {
      assert.equal(writeAndReadShiftDate('dinner service'), '2026-08-06');
    } finally {
      mock.timers.reset();
    }
  });

  it('keeps an after-midnight write on the same service day as the evening', () => {
    // 7 Aug 01:30 MDT — the same shift as the row above, two hours later.
    mock.timers.enable({ apis: ['Date'], now: new Date('2026-08-07T07:30:00Z') });
    try {
      assert.equal(writeAndReadShiftDate('closing'), '2026-08-06');
    } finally {
      mock.timers.reset();
    }
  });

  it('rolls to the next service day after 02:00 local', () => {
    mock.timers.enable({ apis: ['Date'], now: new Date('2026-08-07T08:01:00Z') }); // 02:01 MDT
    try {
      assert.equal(writeAndReadShiftDate('after boundary'), '2026-08-07');
    } finally {
      mock.timers.reset();
    }
  });

  it('does not use the UTC slice', () => {
    const at = new Date('2026-08-07T02:00:00Z');
    mock.timers.enable({ apis: ['Date'], now: at });
    try {
      const stamped = writeAndReadShiftDate('utc divergence');
      assert.notEqual(stamped, at.toISOString().slice(0, 10), 'stamped the UTC date');
      assert.equal(stamped, serviceDate(at));
    } finally {
      mock.timers.reset();
    }
  });

  it('still honours an explicitly supplied shift_date', () => {
    mock.timers.enable({ apis: ['Date'], now: new Date('2026-08-07T02:00:00Z') });
    try {
      const id = testDb.transaction(() =>
        postAuditEvent({
          entity: 'temp_log',
          entity_id: null,
          action: 'insert',
          actor_cook_id: null,
          actor_source: 'cook_ui',
          shift_date: '2026-01-02',
          payload: {},
        }))();
      const row = /** @type {{ shift_date: string }} */ (
        testDb.prepare('SELECT shift_date FROM audit_events WHERE id = ?').get(id)
      );
      assert.equal(row.shift_date, '2026-01-02', 'an explicit date must win over the default');
    } finally {
      mock.timers.reset();
    }
  });
});
