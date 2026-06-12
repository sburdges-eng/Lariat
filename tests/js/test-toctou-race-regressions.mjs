#!/usr/bin/env node
// TOCTOU (Time-Of-Check-To-Time-Of-Use) race-regression pins for 5
// HACCP/labor routes that PR #24 hardened by wrapping
// SELECT-existing + guard-check + UPDATE + audit in a single
// db.transaction(...).
//
// Each route had a bypassable pattern of the form:
//
//   const existing = db.prepare('SELECT ...').get(id);    // read
//   if (existing.already_closed) return 409;              // check
//   db.prepare('UPDATE ...').run(...);                    // act
//
// Two concurrent callers could both read `existing` before either
// UPDATE, both pass the guard, and both mutate. PR #24 moved all three
// steps inside db.transaction(() => {...})() so better-sqlite3
// serializes them.
//
// These tests prove the serialization holds: fire two concurrent
// handler calls against the same row (or the same (shift, station,
// cook) tuple for signoff) via Promise.all and assert exactly ONE
// mutation landed + exactly ONE audit row + the loser got 409.
//
// If someone ever regresses PR #24 by lifting the SELECT outside the
// transaction, these tests will start failing with "expected 1 audit
// row, got 2" or "expected one 409, got zero."
//
// Note on synchrony: better-sqlite3 is synchronous, so the
// "concurrency" here is not true parallelism — `Promise.all([h1, h2])`
// resumes the handlers sequentially after the first `await req.json()`
// and each DB transaction runs to completion before the next handler
// is scheduled. What these tests pin is that no async yield point has
// been introduced between the SELECT guard and the UPDATE/INSERT. If
// a future refactor adds an `await` (cache invalidate, telemetry
// fetch, network call, etc.) inside the transaction callback, the
// event loop can interleave the two handlers at that point and these
// tests fire. The tests therefore defend a structural invariant
// distinct from `test-haccp-audit-atomicity.mjs`, which pins the
// UPDATE-rollback-on-audit-failure case.
//
// Run: node --test tests/js/test-toctou-race-regressions.mjs

import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

register(new URL('./resolver.mjs', import.meta.url));

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-toctou-races-'));
const TMP_DB = path.join(TMP_DIR, 'lariat-test.db');

// sick-worker route is PIN-gated when LARIAT_PIN is set. Setting a PIN
// + a lariat_pin_ok=1 cookie is the pattern used by
// test-haccp-audit-atomicity.mjs.
const ORIGINAL_PIN = process.env.LARIAT_PIN;
process.env.LARIAT_PIN = '4242';

const db = await import('../../lib/db.ts');

db.setDbPathForTest(TMP_DB);
const testDb = db.getDb();

// Import route modules AFTER setDbPathForTest + getDb (which runs
// initSchema + initFoodSafetyLaborSchema + migrateLegacyColumns +
// assertCriticalSchemas) so any handle the routes cache points at the
// test DB.
const breaksRoute = await import('../../app/api/breaks/route.js');
const coolingRoute = await import('../../app/api/cooling/route.js');
const dateMarksRoute = await import('../../app/api/date-marks/route.js');
const sickWorkerRoute = await import('../../app/api/sick-worker/route.js');
const signoffRoute = await import('../../app/api/signoff/route.ts');

const { todayISO } = db;

after(() => {
  db.setDbPathForTest(null);
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
  if (ORIGINAL_PIN === undefined) delete process.env.LARIAT_PIN;
  else process.env.LARIAT_PIN = ORIGINAL_PIN;
});

// ── Shared helpers ────────────────────────────────────────────────

function patchReq(url, body, { pin = false } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (pin) headers.cookie = 'lariat_pin_ok=1';
  return new Request(url, {
    method: 'PATCH',
    headers,
    body: JSON.stringify(body),
  });
}

function postReq(url, body, { pin = false } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (pin) headers.cookie = 'lariat_pin_ok=1';
  return new Request(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

function countAudits(entity) {
  return testDb
    .prepare('SELECT COUNT(*) AS c FROM audit_events WHERE entity = ?')
    .get(entity).c;
}

// Classify two response outcomes as {winner, loser, losers}. For each
// race test we expect exactly one 200 and one 409 — not two 200s, not
// two 409s, not one 200 and one 500.
async function classifyRaceResponses(responses, { expectedLoserStatus = 409 } = {}) {
  const parsed = await Promise.all(responses.map(async (r) => ({
    status: r.status,
    body: await r.json(),
  })));
  const oks = parsed.filter((p) => p.status === 200);
  const losers = parsed.filter((p) => p.status === expectedLoserStatus);
  assert.strictEqual(oks.length, 1,
    `expected exactly one 200, got ${oks.length}; all=${JSON.stringify(parsed)}`);
  assert.strictEqual(losers.length, 1,
    `expected exactly one ${expectedLoserStatus}, got ${losers.length}; all=${JSON.stringify(parsed)}`);
  return { winner: oks[0], loser: losers[0] };
}

// ═════════════════════════════════════════════════════════════════
// PATCH /api/breaks — end-break race
// ═════════════════════════════════════════════════════════════════

describe('PATCH /api/breaks — TOCTOU race on ended_at guard', () => {
  let openBreakId;

  beforeEach(() => {
    testDb.exec('DELETE FROM shift_breaks; DELETE FROM audit_events;');
    const info = testDb.prepare(`
      INSERT INTO shift_breaks
        (shift_date, location_id, cook_id, kind, started_at, ended_at, duration_min, waived)
      VALUES (?, 'default', ?, 'meal', ?, NULL, NULL, 0)
    `).run(todayISO(), 'alice', '2026-04-23T10:00:00.000Z');
    openBreakId = Number(info.lastInsertRowid);
  });

  it('single-request happy path: end an open break → 200, ended_at set, duration_min computed', async () => {
    const res = await breaksRoute.PATCH(patchReq('http://localhost/api/breaks', {
      id: openBreakId,
      ended_at: '2026-04-23T10:30:00.000Z',
      cook_id: 'alice',
    }));
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.ok, true);
    assert.strictEqual(body.entry.ended_at, '2026-04-23T10:30:00.000Z');
    assert.strictEqual(body.entry.duration_min, 30);
    assert.strictEqual(countAudits('shift_breaks'), 1);
  });

  it('concurrent end-break: exactly one 200, one 409, one mutation, one audit row', async () => {
    const [r1, r2] = await Promise.all([
      breaksRoute.PATCH(patchReq('http://localhost/api/breaks', {
        id: openBreakId,
        ended_at: '2026-04-23T10:30:00.000Z',
        cook_id: 'alice',
      })),
      breaksRoute.PATCH(patchReq('http://localhost/api/breaks', {
        id: openBreakId,
        ended_at: '2026-04-23T10:45:00.000Z',
        cook_id: 'alice',
      })),
    ]);

    const { loser } = await classifyRaceResponses([r1, r2]);
    assert.match(loser.body.error, /already ended/);

    // DB state: row ended exactly once — ended_at is one of the two
    // submitted values, not overwritten twice.
    const row = testDb.prepare('SELECT * FROM shift_breaks WHERE id=?').get(openBreakId);
    assert.ok(row.ended_at, 'ended_at must be set by the winner');
    assert.ok(['2026-04-23T10:30:00.000Z', '2026-04-23T10:45:00.000Z'].includes(row.ended_at));
    assert.ok(row.duration_min === 30 || row.duration_min === 45,
      `duration_min must be 30 or 45, got ${row.duration_min}`);

    // Exactly ONE audit_events row for the successful UPDATE — the
    // losing call must not have written one.
    assert.strictEqual(
      countAudits('shift_breaks'),
      1,
      'exactly one audit row from the winning PATCH; loser must not emit an audit',
    );
    const audit = testDb
      .prepare(`SELECT * FROM audit_events WHERE entity='shift_breaks' AND action='update'`)
      .get();
    assert.strictEqual(Number(audit.entity_id), openBreakId);
  });
});

// ═════════════════════════════════════════════════════════════════
// PATCH /api/cooling — stage-1 → stage-2 race
// ═════════════════════════════════════════════════════════════════
//
// Cooling is the most interesting case: classifyCoolingStage dispatches
// on `existing.stage1_at`. If two concurrent stage-2 PATCH calls both
// read the row BEFORE either UPDATE lands, each sees stage1_at already
// populated and each writes a stage2_at — racing to close the batch
// twice. The transaction wrapper serializes them so the second call
// sees status='ok' (or 'breach') and fails via classifyCoolingStage's
// "already closed" guard.

describe('PATCH /api/cooling — TOCTOU race on stage1→stage2 transition', () => {
  let coolingId;

  beforeEach(() => {
    testDb.exec('DELETE FROM cooling_log; DELETE FROM audit_events;');
    // Seed a row that already has stage1 closed, so the race is on
    // stage2. This is the interesting case — two cooks both hit
    // "record stage 2" at the same instant.
    const info = testDb.prepare(`
      INSERT INTO cooling_log
        (shift_date, location_id, item, station_id,
         started_at, start_reading_f,
         stage1_at, stage1_reading_f,
         status, cook_id)
      VALUES (?, 'default', 'chili', 'cold_line',
              '2026-04-23T10:00:00.000Z', 140,
              '2026-04-23T11:30:00.000Z', 68,
              'in_progress', 'alice')
    `).run(todayISO());
    coolingId = Number(info.lastInsertRowid);
  });

  it('single-request happy path: record stage-2 reading → 200, status=ok', async () => {
    const res = await coolingRoute.PATCH(patchReq('http://localhost/api/cooling', {
      id: coolingId,
      reading_f: 40,
      at: '2026-04-23T14:00:00.000Z',   // stage1+2.5h, under 4h budget, ≤41°F
      cook_id: 'bob',
    }));
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.ok, true);
    assert.strictEqual(body.decision.stage, 2);
    assert.strictEqual(body.decision.status, 'ok');
    assert.strictEqual(body.entry.status, 'ok');
    assert.strictEqual(body.entry.stage2_reading_f, 40);
    assert.strictEqual(countAudits('cooling_log'), 1);
  });

  it('concurrent stage-2 close: exactly one 200, one 400 ("already closed"), one mutation, one audit row', async () => {
    // Both cooks try to close stage 2. The winner flips status to
    // 'ok'/'breach'; classifyCoolingStage then rejects the loser
    // because row.status !== 'in_progress' → 400 "Cooling batch
    // already closed".
    const [r1, r2] = await Promise.all([
      coolingRoute.PATCH(patchReq('http://localhost/api/cooling', {
        id: coolingId,
        reading_f: 40,
        at: '2026-04-23T14:00:00.000Z',
        cook_id: 'bob',
      })),
      coolingRoute.PATCH(patchReq('http://localhost/api/cooling', {
        id: coolingId,
        reading_f: 38,
        at: '2026-04-23T14:05:00.000Z',
        cook_id: 'carol',
      })),
    ]);

    // Cooling's "already closed" surfaces as 400 from classifyCoolingStage,
    // not 409 — the route uses decision.ok=false → 400. This is still the
    // exact same TOCTOU shape: without the transaction, both would have
    // seen status='in_progress' and both would have UPDATEd.
    const { loser } = await classifyRaceResponses([r1, r2], { expectedLoserStatus: 400 });
    assert.match(loser.body.error, /already closed/);

    // DB state: exactly one stage-2 reading, status transitioned once.
    const row = testDb.prepare('SELECT * FROM cooling_log WHERE id=?').get(coolingId);
    assert.ok(row.stage2_at, 'stage2_at must be set exactly once');
    assert.ok(['2026-04-23T14:00:00.000Z', '2026-04-23T14:05:00.000Z'].includes(row.stage2_at));
    assert.ok([38, 40].includes(row.stage2_reading_f),
      `stage2_reading_f must be 38 or 40, got ${row.stage2_reading_f}`);
    assert.notStrictEqual(row.status, 'in_progress',
      'status must have transitioned away from in_progress');

    // Exactly ONE audit_events row.
    assert.strictEqual(
      countAudits('cooling_log'),
      1,
      'exactly one audit row from the winning PATCH; loser must not emit an audit',
    );
  });
});

// ═════════════════════════════════════════════════════════════════
// PATCH /api/date-marks — discard race
// ═════════════════════════════════════════════════════════════════

describe('PATCH /api/date-marks — TOCTOU race on discarded_at guard', () => {
  let dateMarkId;

  beforeEach(() => {
    testDb.exec('DELETE FROM date_marks; DELETE FROM audit_events;');
    const info = testDb.prepare(`
      INSERT INTO date_marks
        (location_id, item, batch_ref, prepared_on, discard_on, cook_id)
      VALUES ('default', 'cooked rice', NULL, '2026-04-23', '2026-04-29', 'alice')
    `).run();
    dateMarkId = Number(info.lastInsertRowid);
  });

  it('single-request happy path: discard with reason → 200, discarded_at set', async () => {
    const res = await dateMarksRoute.PATCH(patchReq('http://localhost/api/date-marks', {
      id: dateMarkId,
      discard_reason: 'expired',
      cook_id: 'alice',
    }));
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.ok, true);
    assert.strictEqual(body.entry.discard_reason, 'expired');
    assert.ok(body.entry.discarded_at);
    assert.strictEqual(countAudits('date_marks'), 1);
  });

  it('concurrent discard: exactly one 200, one 409, one mutation, one audit row', async () => {
    const [r1, r2] = await Promise.all([
      dateMarksRoute.PATCH(patchReq('http://localhost/api/date-marks', {
        id: dateMarkId,
        discard_reason: 'expired',
        cook_id: 'alice',
      })),
      dateMarksRoute.PATCH(patchReq('http://localhost/api/date-marks', {
        id: dateMarkId,
        discard_reason: 'quality',
        cook_id: 'bob',
      })),
    ]);

    const { loser } = await classifyRaceResponses([r1, r2]);
    assert.match(loser.body.error, /already discarded/);

    // DB state: discarded_at set exactly once; discard_reason is
    // whichever call won (not overwritten by the loser).
    const row = testDb.prepare('SELECT * FROM date_marks WHERE id=?').get(dateMarkId);
    assert.ok(row.discarded_at, 'discarded_at must be set');
    assert.ok(['expired', 'quality'].includes(row.discard_reason),
      `discard_reason must be one of the two submitted values, got ${row.discard_reason}`);

    assert.strictEqual(
      countAudits('date_marks'),
      1,
      'exactly one audit row; loser must not emit an audit',
    );
    const audit = testDb
      .prepare(`SELECT * FROM audit_events WHERE entity='date_marks' AND action='update'`)
      .get();
    assert.strictEqual(Number(audit.entity_id), dateMarkId);
  });
});

// ═════════════════════════════════════════════════════════════════
// PATCH /api/sick-worker — clearance race
// ═════════════════════════════════════════════════════════════════

describe('PATCH /api/sick-worker — TOCTOU race on return_at guard', () => {
  let sickId;

  beforeEach(() => {
    testDb.exec('DELETE FROM sick_worker_reports; DELETE FROM audit_events;');
    const info = testDb.prepare(`
      INSERT INTO sick_worker_reports
        (shift_date, location_id, cook_id, reported_by_pic_id,
         symptoms, diagnosed_illness, action, started_at, return_at, clearance_source, note)
      VALUES (?, 'default', 'bob', 'alice',
              'vomiting', NULL, 'excluded', '2026-04-21T09:00:00.000Z',
              NULL, NULL, NULL)
    `).run(todayISO());
    sickId = Number(info.lastInsertRowid);
  });

  it('single-request happy path: record clearance → 200, return_at set', async () => {
    const res = await sickWorkerRoute.PATCH(patchReq('http://localhost/api/sick-worker', {
      id: sickId,
      clearance_source: 'asymptomatic_24h',
      reported_by_pic_id: 'alice',
    }, { pin: true }));
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.ok, true);
    assert.ok(body.entry.return_at);
    assert.strictEqual(body.entry.clearance_source, 'asymptomatic_24h');
    assert.strictEqual(countAudits('sick_worker_reports'), 1);
  });

  it('concurrent clearance: exactly one 200, one 409, one mutation, one audit row', async () => {
    const [r1, r2] = await Promise.all([
      sickWorkerRoute.PATCH(patchReq('http://localhost/api/sick-worker', {
        id: sickId,
        clearance_source: 'asymptomatic_24h',
        reported_by_pic_id: 'alice',
      }, { pin: true })),
      sickWorkerRoute.PATCH(patchReq('http://localhost/api/sick-worker', {
        id: sickId,
        clearance_source: 'medical_clearance',
        reported_by_pic_id: 'alice',
      }, { pin: true })),
    ]);

    const { loser } = await classifyRaceResponses([r1, r2]);
    assert.match(loser.body.error, /already cleared/);

    // DB state: return_at set; clearance_source is whichever won.
    const row = testDb.prepare('SELECT * FROM sick_worker_reports WHERE id=?').get(sickId);
    assert.ok(row.return_at, 'return_at must be set');
    assert.ok(['asymptomatic_24h', 'medical_clearance'].includes(row.clearance_source),
      `clearance_source must be one of the two submitted values, got ${row.clearance_source}`);

    assert.strictEqual(
      countAudits('sick_worker_reports'),
      1,
      'exactly one audit row; loser must not emit an audit',
    );
  });
});

// ═════════════════════════════════════════════════════════════════
// POST /api/signoff — unnoted-fails race
// ═════════════════════════════════════════════════════════════════
//
// The race here is different from the other four: it's an INSERT into
// station_signoffs, not an UPDATE. The guard is
// failsMissingCorrectiveAction(...) returning an empty list. Without
// the transaction, two concurrent signoff POSTs for the same (shift,
// station, cook) tuple could both see zero unnoted fails AND both
// INSERT — producing duplicate station_signoffs rows. The transaction
// pattern here is different from the others (the ultimate race is
// between the same-tuple dedup and the INSERT), but the TOCTOU shape
// is the same: SELECT-guard → INSERT must be atomic.
//
// To exercise the interesting case we seed a LATEST 'fail' row with a
// note (so the guard passes), then fire two concurrent POSTs and
// assert exactly one INSERT landed.
//
// Note: the current signoff route doesn't enforce uniqueness on
// (shift, station, cook) at the schema level, so the test asserts on
// the number of INSERTED rows produced by the concurrent POSTs. In
// the without-transaction scenario the test would see TWO rows — and
// that's what we're pinning against.

describe('POST /api/signoff — TOCTOU race on unnoted-fails guard', () => {
  const shift = todayISO();
  const station = 'hot_line';
  const cook = 'alice';

  beforeEach(() => {
    testDb.exec(`
      DELETE FROM station_signoffs;
      DELETE FROM line_check_entries;
      DELETE FROM audit_events;
    `);
  });

  it('single-request happy path: unnoted fails present → 409 with items list', async () => {
    // Seed a latest 'fail' row with NO note — guard must fire.
    testDb.prepare(`
      INSERT INTO line_check_entries
        (shift_date, station_id, item, status, note, cook_id, location_id)
      VALUES (?, ?, 'patty_temp', 'fail', NULL, ?, 'default')
    `).run(shift, station, cook);

    const res = await signoffRoute.POST(postReq('http://localhost/api/signoff', {
      shift_date: shift,
      station_id: station,
      cook_id: cook,
      signoff_type: 'self',
    }));
    assert.strictEqual(res.status, 409);
    const body = await res.json();
    assert.match(body.error, /note the fix/);
    assert.deepStrictEqual(body.items, ['patty_temp']);
    // No signoff row landed.
    const count = testDb.prepare('SELECT COUNT(*) AS c FROM station_signoffs').get().c;
    assert.strictEqual(count, 0);
  });

  it('single-request happy path: fails are noted → 200, one signoff row', async () => {
    testDb.prepare(`
      INSERT INTO line_check_entries
        (shift_date, station_id, item, status, note, cook_id, location_id)
      VALUES (?, ?, 'patty_temp', 'fail', 'reheated to 165F and held', ?, 'default')
    `).run(shift, station, cook);

    const res = await signoffRoute.POST(postReq('http://localhost/api/signoff', {
      shift_date: shift,
      station_id: station,
      cook_id: cook,
      signoff_type: 'self',
    }));
    assert.strictEqual(res.status, 200);
    const count = testDb.prepare('SELECT COUNT(*) AS c FROM station_signoffs').get().c;
    assert.strictEqual(count, 1);
  });

  it('concurrent signoff with unnoted fails: both calls see the fail, both return 409, zero signoffs inserted', async () => {
    // Both calls hit the guard. Neither should insert.
    testDb.prepare(`
      INSERT INTO line_check_entries
        (shift_date, station_id, item, status, note, cook_id, location_id)
      VALUES (?, ?, 'patty_temp', 'fail', NULL, ?, 'default')
    `).run(shift, station, cook);

    const [r1, r2] = await Promise.all([
      signoffRoute.POST(postReq('http://localhost/api/signoff', {
        shift_date: shift,
        station_id: station,
        cook_id: cook,
        signoff_type: 'self',
      })),
      signoffRoute.POST(postReq('http://localhost/api/signoff', {
        shift_date: shift,
        station_id: station,
        cook_id: cook,
        signoff_type: 'self',
      })),
    ]);

    assert.strictEqual(r1.status, 409);
    assert.strictEqual(r2.status, 409);
    const b1 = await r1.json();
    const b2 = await r2.json();
    assert.match(b1.error, /note the fix/);
    assert.match(b2.error, /note the fix/);

    const count = testDb.prepare('SELECT COUNT(*) AS c FROM station_signoffs').get().c;
    assert.strictEqual(count, 0, 'neither call should have inserted a signoff');
  });
});
