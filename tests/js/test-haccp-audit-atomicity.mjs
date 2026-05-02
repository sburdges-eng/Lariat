#!/usr/bin/env node
// Cross-HACCP audit atomicity hardening — regression pins.
//
// All 9 HACCP POST/PATCH routes now wrap the source-table insert/update
// and the accompanying postAuditEvent call in a single db.transaction,
// so a failure in either rolls back both. postAuditEvent additionally
// emits a console.warn when called outside a transaction context, which
// catches any future caller that regresses the pattern.
//
// This file pins:
//   1. Rollback on audit failure — if postAuditEvent throws inside the
//      transaction, the source-table insert is rolled back.
//   2. postAuditEvent warns when called outside a db.transaction context.
//   3. postAuditEvent does NOT warn when called inside a db.transaction.
//   4. End-to-end insert+audit commit pair for each route category:
//      temp_log, receiving, thermometer_calibrations, cooling, sanitizer,
//      date_marks, sick_worker, breaks, certifications.
//
// Run: node --experimental-strip-types --test tests/js/test-haccp-audit-atomicity.mjs

import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

register(new URL('./resolver.mjs', import.meta.url));

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-haccp-atomicity-'));
const TMP_DB = path.join(TMP_DIR, 'lariat-test.db');

const ORIGINAL_PIN = process.env.LARIAT_PIN;
process.env.LARIAT_PIN = '4242';

const db = await import('../../lib/db.ts');
const auditEvents = await import('../../lib/auditEvents.ts');

db.setDbPathForTest(TMP_DB);
const testDb = db.getDb();

const { todayISO } = db;
const { postAuditEvent } = auditEvents;

// Routes — imported lazily so that setDbPathForTest has already run
// before any route module has captured a handle.
const tempLog = await import('../../app/api/temp-log/route.js');
const receiving = await import('../../app/api/receiving/route.js');
const calibrations = await import('../../app/api/thermometer-calibrations/route.js');
const cooling = await import('../../app/api/cooling/route.js');
const sanitizer = await import('../../app/api/sanitizer-check/route.js');
const dateMarks = await import('../../app/api/date-marks/route.js');
const sickWorker = await import('../../app/api/sick-worker/route.js');
const breaks = await import('../../app/api/breaks/route.js');
const certifications = await import('../../app/api/certifications/route.js');

after(() => {
  db.setDbPathForTest(null);
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
  if (ORIGINAL_PIN === undefined) delete process.env.LARIAT_PIN;
  else process.env.LARIAT_PIN = ORIGINAL_PIN;
});

beforeEach(() => {
  testDb.exec(`
    DELETE FROM audit_events;
    DELETE FROM temp_log;
    DELETE FROM receiving_log;
    DELETE FROM thermometer_calibrations;
    DELETE FROM cooling_log;
    DELETE FROM sanitizer_checks;
    DELETE FROM date_marks;
    DELETE FROM sick_worker_reports;
    DELETE FROM shift_breaks;
    DELETE FROM staff_certifications;
    DELETE FROM idempotency_keys;
  `);
});

function postReq(url, body, { pin = false, idempotencyKey } = {}) {
  const headers = { 'content-type': 'application/json' };
  // PIN-gated routes (sick-worker, certifications, some others) check
  // the lariat_pin_ok cookie via lib/pin.ts. Tests opt-in per call.
  if (pin) headers.cookie = 'lariat_pin_ok=1';
  if (idempotencyKey) headers['idempotency-key'] = idempotencyKey;
  return new Request(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

function countRows(table, where = '') {
  const sql = `SELECT COUNT(*) AS c FROM ${table} ${where}`;
  return testDb.prepare(sql).get().c;
}

function countAudit(entity) {
  return testDb
    .prepare('SELECT COUNT(*) AS c FROM audit_events WHERE entity = ?')
    .get(entity).c;
}

// ── Console capture helper ────────────────────────────────────────
//
// Swap console.warn for a capturing array, run fn, restore. Callers
// inspect the returned array to assert on warn behavior.
function captureWarns(fn) {
  const captured = [];
  const original = console.warn;
  console.warn = (...args) => { captured.push(args.map(String).join(' ')); };
  try {
    const out = fn();
    return { captured, out };
  } finally {
    console.warn = original;
  }
}

// ─────────────────────────────────────────────────────────────────
// 1. postAuditEvent warn behavior
// ─────────────────────────────────────────────────────────────────

describe('postAuditEvent — transaction-context warn', () => {
  it('WARNS when called outside a db.transaction', () => {
    const { captured } = captureWarns(() => {
      postAuditEvent({
        entity: 'temp_log',
        entity_id: null,
        action: 'insert',
        actor_cook_id: null,
        actor_source: 'api',
      });
    });
    assert.strictEqual(captured.length, 1, 'expected exactly one warn');
    assert.match(captured[0], /postAuditEvent called outside of a transaction context/);
    assert.match(captured[0], /temp_log/);
    assert.match(captured[0], /insert/);
  });

  it('does NOT warn when called inside a db.transaction', () => {
    const { captured } = captureWarns(() => {
      const run = testDb.transaction(() => {
        postAuditEvent({
          entity: 'temp_log',
          entity_id: null,
          action: 'insert',
          actor_cook_id: null,
          actor_source: 'api',
        });
      });
      run();
    });
    assert.strictEqual(captured.length, 0, `unexpected warns: ${captured.join(' | ')}`);
  });

  it('still inserts the audit row when called outside a transaction (warn only, not fatal)', () => {
    const before = countAudit('temp_log');
    captureWarns(() => {
      postAuditEvent({
        entity: 'temp_log',
        entity_id: null,
        action: 'insert',
        actor_cook_id: null,
        actor_source: 'api',
      });
    });
    assert.strictEqual(countAudit('temp_log'), before + 1);
  });
});

// ─────────────────────────────────────────────────────────────────
// 2. Rollback on audit failure
// ─────────────────────────────────────────────────────────────────
//
// We can't easily make postAuditEvent itself throw from outside, but
// better-sqlite3's transaction semantics are symmetric: any throw inside
// the transaction closure rolls back the entire transaction. We prove
// this at the db-layer level (more robust than any particular route
// implementation), AND separately prove that the route code is correct
// by having the audit_events table go broken mid-test so the real POST
// path exercises rollback.

describe('db.transaction — rollback on audit-inner failure', () => {
  it('throwing inside db.transaction rolls back the source insert', () => {
    const beforeTemp = countRows('temp_log');
    const beforeAudit = countAudit('temp_log');

    const run = testDb.transaction(() => {
      testDb.prepare(`
        INSERT INTO temp_log
          (shift_date, location_id, point_id, reading_f,
           required_min_f, required_max_f, corrective_action, cook_id, probe_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(todayISO(), 'default', 'walk_in_cooler', 38, null, 41, null, 'alice', null);
      // Insert looked fine. Now fail as postAuditEvent might.
      throw new Error('synthetic audit failure');
    });

    assert.throws(() => run(), /synthetic audit failure/);

    assert.strictEqual(countRows('temp_log'), beforeTemp, 'temp_log insert should roll back');
    assert.strictEqual(countAudit('temp_log'), beforeAudit, 'audit row should not exist');
  });

  it('route-level: if audit_events table is dropped mid-flight, the temp_log insert rolls back', async () => {
    // Break the audit_events INSERT path by renaming the table. The
    // route will attempt INSERT INTO audit_events inside the
    // transaction, throw, and the transaction must roll back.
    testDb.exec(`ALTER TABLE audit_events RENAME TO audit_events_stash`);
    try {
      const beforeTemp = countRows('temp_log');

      const res = await tempLog.POST(postReq('http://localhost/api/temp-log', {
        shift_date: todayISO(),
        point_id: 'walk_in_cooler',
        reading_f: 38,
        cook_id: 'alice',
      }));

      // The route catches and 500s. That's fine — what matters is no
      // stranded temp_log row.
      assert.strictEqual(res.status, 500, 'route must 500 when audit write fails');
      assert.strictEqual(countRows('temp_log'), beforeTemp, 'temp_log must be rolled back');
    } finally {
      testDb.exec(`ALTER TABLE audit_events_stash RENAME TO audit_events`);
    }
  });
});

// ─────────────────────────────────────────────────────────────────
// 3. Happy-path insert+audit commit pairs per route category
// ─────────────────────────────────────────────────────────────────

describe('HACCP routes — insert + audit commit together (happy path)', () => {
  it('POST /api/temp-log commits both temp_log and audit_events', async () => {
    const res = await tempLog.POST(postReq('http://localhost/api/temp-log', {
      shift_date: todayISO(),
      point_id: 'walk_in_cooler',
      reading_f: 38,
      cook_id: 'alice',
    }));
    assert.strictEqual(res.status, 200);
    assert.strictEqual(countRows('temp_log'), 1);
    assert.strictEqual(countAudit('temp_log'), 1);
  });

  it('POST /api/temp-log emits NO warn (audit is inside the transaction)', async () => {
    const { captured } = await captureWarnsAsync(async () => {
      await tempLog.POST(postReq('http://localhost/api/temp-log', {
        shift_date: todayISO(),
        point_id: 'walk_in_cooler',
        reading_f: 38,
        cook_id: 'alice',
      }));
    });
    const auditWarns = captured.filter((m) => /postAuditEvent called outside/.test(m));
    assert.strictEqual(auditWarns.length, 0, `unexpected audit warns: ${auditWarns.join(' | ')}`);
  });

  it('POST /api/receiving commits both receiving_log and audit_events', async () => {
    const res = await receiving.POST(postReq('http://localhost/api/receiving', {
      shift_date: todayISO(),
      vendor: 'Shamrock',
      invoice_ref: 'INV-1001',
      category: 'refrigerated',
      item: 'chicken breast 40lb CS',
      reading_f: 38,
      package_ok: true,
      cook_id: 'alice',
    }));
    assert.strictEqual(res.status, 200);
    assert.strictEqual(countRows('receiving_log'), 1);
    assert.strictEqual(countAudit('receiving_log'), 1);
  });

  it('POST /api/thermometer-calibrations commits both rows', async () => {
    const res = await calibrations.POST(postReq('http://localhost/api/thermometer-calibrations', {
      location_id: 'default',
      thermometer_id: 'probe-1',
      method: 'ice_point',
      reading_f: 32,
      cook_id: 'alice',
    }));
    assert.strictEqual(res.status, 200);
    assert.strictEqual(countRows('thermometer_calibrations'), 1);
    assert.strictEqual(countAudit('thermometer_calibrations'), 1);
  });

  it('POST /api/cooling commits both cooling_log and audit_events', async () => {
    const res = await cooling.POST(postReq('http://localhost/api/cooling', {
      shift_date: todayISO(),
      location_id: 'default',
      item: 'chili',
      station_id: 'cold_line',
      started_at: new Date().toISOString(),
      start_reading_f: 140,
      cook_id: 'alice',
    }));
    assert.strictEqual(res.status, 200);
    assert.strictEqual(countRows('cooling_log'), 1);
    assert.strictEqual(countAudit('cooling_log'), 1);
  });

  it('POST /api/sanitizer-check commits both sanitizer_checks and audit_events', async () => {
    const res = await sanitizer.POST(postReq('http://localhost/api/sanitizer-check', {
      shift_date: todayISO(),
      location_id: 'default',
      station_id: 'dish_3comp',
      point_label: 'bar-3comp',
      chemistry: 'quat',
      concentration_ppm: 300,
      water_temp_f: 75,
      cook_id: 'alice',
    }));
    assert.strictEqual(res.status, 200);
    assert.strictEqual(countRows('sanitizer_checks'), 1);
    assert.strictEqual(countAudit('sanitizer_checks'), 1);
  });

  it('POST /api/date-marks commits both date_marks and audit_events', async () => {
    const res = await dateMarks.POST(postReq('http://localhost/api/date-marks', {
      location_id: 'default',
      item: 'cooked rice',
      prepared_on: todayISO(),
      cook_id: 'alice',
    }));
    assert.strictEqual(res.status, 200);
    assert.strictEqual(countRows('date_marks'), 1);
    assert.strictEqual(countAudit('date_marks'), 1);
  });

  it('POST /api/sick-worker commits both sick_worker_reports and audit_events', async () => {
    const res = await sickWorker.POST(postReq('http://localhost/api/sick-worker', {
      shift_date: todayISO(),
      location_id: 'default',
      cook_id: 'bob',
      reported_by_pic_id: 'alice',
      symptoms: ['vomiting'],
      action: 'excluded',
      started_at: new Date().toISOString(),
    }, { pin: true }));
    assert.strictEqual(res.status, 200);
    assert.strictEqual(countRows('sick_worker_reports'), 1);
    assert.strictEqual(countAudit('sick_worker_reports'), 1);
  });

  it('POST /api/breaks commits both shift_breaks and audit_events', async () => {
    const res = await breaks.POST(postReq('http://localhost/api/breaks', {
      shift_date: todayISO(),
      location_id: 'default',
      cook_id: 'alice',
      kind: 'meal',
      started_at: new Date().toISOString(),
    }));
    assert.strictEqual(res.status, 200);
    assert.strictEqual(countRows('shift_breaks'), 1);
    assert.strictEqual(countAudit('shift_breaks'), 1);
  });

  it('POST /api/certifications commits both staff_certifications and audit_events', async () => {
    const res = await certifications.POST(postReq('http://localhost/api/certifications', {
      location_id: 'default',
      cook_id: 'alice',
      cert_type: 'food_handler',
      cert_label: 'CO Food Handler',
      issuer: 'CDPHE',
      cert_number: 'FH-12345',
      issued_on: '2026-01-01',
      expires_on: '2029-01-01',
    }, { pin: true }));
    assert.strictEqual(res.status, 200);
    assert.strictEqual(countRows('staff_certifications'), 1);
    assert.strictEqual(countAudit('staff_certifications'), 1);
  });
});

// §8 P1 Task 3 — temp-log + receiving idempotency replay.
// Closes the "on-reconnect sync never duplicates rows" doctrine for
// the highest-volume regulated routes. Same pattern as the signoff +
// box-office retrofit in #119.

describe('POST /api/temp-log — idempotency replay', () => {
  const samePayload = () => ({
    shift_date: todayISO(),
    point_id: 'walk_in_cooler',
    reading_f: 38,
    cook_id: 'alice',
  });

  it('same key replay writes ONE temp_log row + ONE audit row', async () => {
    const KEY = 'tlog-key-aaaaaaaaaaaa';
    const r1 = await tempLog.POST(
      postReq('http://localhost/api/temp-log', samePayload(), { idempotencyKey: KEY }),
    );
    assert.strictEqual(r1.status, 200);
    const body1 = await r1.json();

    const r2 = await tempLog.POST(
      postReq('http://localhost/api/temp-log', samePayload(), { idempotencyKey: KEY }),
    );
    assert.strictEqual(r2.status, 200);
    const body2 = await r2.json();

    assert.deepStrictEqual(body1, body2);
    assert.strictEqual(countRows('temp_log'), 1);
    assert.strictEqual(countAudit('temp_log'), 1);
  });

  it('distinct keys for the same point write two rows', async () => {
    await tempLog.POST(
      postReq('http://localhost/api/temp-log', samePayload(), { idempotencyKey: 'k-aaaaaaaaaaaaaaaa' }),
    );
    await tempLog.POST(
      postReq('http://localhost/api/temp-log', samePayload(), { idempotencyKey: 'k-bbbbbbbbbbbbbbbb' }),
    );
    assert.strictEqual(countRows('temp_log'), 2);
  });

  it('same key + different reading_f returns 409 without writing', async () => {
    const KEY = 'tlog-409-aaaaaaaaaaaa';
    const r1 = await tempLog.POST(
      postReq('http://localhost/api/temp-log', samePayload(), { idempotencyKey: KEY }),
    );
    assert.strictEqual(r1.status, 200, `r1 must succeed; got ${r1.status}: ${await r1.clone().text()}`);
    assert.strictEqual(countRows('temp_log'), 1);

    const r2 = await tempLog.POST(
      postReq(
        'http://localhost/api/temp-log',
        { ...samePayload(), reading_f: 39 },
        { idempotencyKey: KEY },
      ),
    );
    assert.strictEqual(
      r2.status, 409,
      `r2 must 409 on hash mismatch; got ${r2.status}: ${await r2.clone().text()}`,
    );
    assert.strictEqual(countRows('temp_log'), 1);
  });
});

describe('POST /api/receiving — idempotency replay', () => {
  const samePayload = () => ({
    shift_date: todayISO(),
    vendor: 'Shamrock',
    invoice_ref: 'INV-1001',
    category: 'refrigerated',
    item: 'chicken breast 40lb CS',
    reading_f: 38,
    package_ok: true,
    cook_id: 'alice',
  });

  it('same key replay writes ONE receiving_log + ONE audit', async () => {
    const KEY = 'recv-key-aaaaaaaaaaaa';
    const r1 = await receiving.POST(
      postReq('http://localhost/api/receiving', samePayload(), { idempotencyKey: KEY }),
    );
    assert.strictEqual(r1.status, 200);
    const body1 = await r1.json();

    const r2 = await receiving.POST(
      postReq('http://localhost/api/receiving', samePayload(), { idempotencyKey: KEY }),
    );
    assert.strictEqual(r2.status, 200);
    const body2 = await r2.json();

    assert.deepStrictEqual(body1, body2);
    assert.strictEqual(countRows('receiving_log'), 1);
    assert.strictEqual(countAudit('receiving_log'), 1);
  });

  it('distinct keys for same delivery write two rows', async () => {
    await receiving.POST(
      postReq('http://localhost/api/receiving', samePayload(), { idempotencyKey: 'k-aaaaaaaaaaaaaaaa' }),
    );
    await receiving.POST(
      postReq('http://localhost/api/receiving', samePayload(), { idempotencyKey: 'k-bbbbbbbbbbbbbbbb' }),
    );
    assert.strictEqual(countRows('receiving_log'), 2);
  });

  it('same key + different temp returns 409 without writing', async () => {
    const KEY = 'recv-409-aaaaaaaaaaaa';
    await receiving.POST(
      postReq('http://localhost/api/receiving', samePayload(), { idempotencyKey: KEY }),
    );
    assert.strictEqual(countRows('receiving_log'), 1);

    const r2 = await receiving.POST(
      postReq(
        'http://localhost/api/receiving',
        { ...samePayload(), reading_f: 99 },
        { idempotencyKey: KEY },
      ),
    );
    assert.strictEqual(r2.status, 409);
    assert.strictEqual(countRows('receiving_log'), 1);
  });
});

// Async variant of captureWarns — same contract.
async function captureWarnsAsync(fn) {
  const captured = [];
  const original = console.warn;
  console.warn = (...args) => { captured.push(args.map(String).join(' ')); };
  try {
    const out = await fn();
    return { captured, out };
  } finally {
    console.warn = original;
  }
}
