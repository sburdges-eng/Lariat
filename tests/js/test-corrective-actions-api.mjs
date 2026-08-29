#!/usr/bin/env node
// Integration tests for /api/corrective-actions (F13 / FDA §8-405.11).
// Run: node --experimental-strip-types --test tests/js/test-corrective-actions-api.mjs

import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

register(new URL('./resolver.mjs', import.meta.url));

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-corrective-actions-api-'));
const TMP_DB = path.join(TMP_DIR, 'lariat-test.db');

const db = await import('../../lib/db.ts');
const route = await import('../../app/api/corrective-actions/route.js');

db.setDbPathForTest(TMP_DB);
const testDb = db.getDb();

const { GET } = route;

after(() => {
  db.setDbPathForTest(null);
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

beforeEach(() => {
  testDb.exec(`
    DELETE FROM temp_log;
    DELETE FROM line_check_entries;
    DELETE FROM cooling_log;
    DELETE FROM sanitizer_checks;
    DELETE FROM receiving_log;
    DELETE FROM pest_control_log;
  `);
});

const SHIFT = '2026-05-05';
const LOC = 'default';

function getReq(qs = '') {
  return new Request(`http://localhost/api/corrective-actions${qs}`);
}

function insertTempLog({ point_id, corrective_action, cook_id = 'alice', created_at = '2026-05-05T10:00:00Z' }) {
  testDb.prepare(`
    INSERT INTO temp_log (shift_date, location_id, point_id, reading_f,
                          required_min_f, required_max_f, corrective_action,
                          cook_id, created_at)
    VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?)
  `).run(SHIFT, LOC, point_id, 43.0, 41.0, corrective_action, cook_id, created_at);
}

function insertLineCheck({ station_id, item, status, note, cook_id = 'cara', created_at = '2026-05-05T11:00:00Z' }) {
  testDb.prepare(`
    INSERT INTO line_check_entries
      (shift_date, station_id, item, status, par, have, need, note, cook_id, location_id, created_at)
    VALUES (?, ?, ?, ?, NULL, NULL, NULL, ?, ?, ?, ?)
  `).run(SHIFT, station_id, item, status, note, cook_id, LOC, created_at);
}

describe('GET /api/corrective-actions — happy path', () => {
  it('aggregates one temp_log corrective + one line_check fail+note', async () => {
    insertTempLog({
      point_id: 'walk_in_cooler',
      corrective_action: 'thermostat reset, settled at 39F',
      created_at: '2026-05-05T09:00:00Z',
    });
    insertLineCheck({
      station_id: 'fryer',
      item: 'oil quality',
      status: 'fail',
      note: 'filtered + topped up',
      created_at: '2026-05-05T11:00:00Z',
    });

    const res = await GET(getReq(`?date=${SHIFT}`));
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.date, SHIFT);
    assert.strictEqual(body.location_id, LOC);
    assert.strictEqual(body.station_id, null);
    assert.strictEqual(body.entries.length, 2);

    // Newest first.
    assert.strictEqual(body.entries[0].source, 'line_check');
    assert.strictEqual(body.entries[0].subject, 'fryer: oil quality');
    assert.strictEqual(body.entries[1].source, 'temp_log');
    assert.strictEqual(body.entries[1].subject, 'walk_in_cooler');
  });
});

describe('GET /api/corrective-actions — filtering rules', () => {
  it('skips temp_log row with NULL corrective_action', async () => {
    insertTempLog({
      point_id: 'walk_in_cooler',
      corrective_action: null,  // NULL → filtered out by SQL
    });
    const res = await GET(getReq(`?date=${SHIFT}`));
    const body = await res.json();
    assert.strictEqual(body.entries.length, 0);
  });

  it('skips temp_log row with whitespace-only corrective_action', async () => {
    insertTempLog({
      point_id: 'walk_in_cooler',
      corrective_action: '   ',
    });
    const res = await GET(getReq(`?date=${SHIFT}`));
    const body = await res.json();
    assert.strictEqual(body.entries.length, 0);
  });

  it('skips line_check row that PASSED (status=pass) even with a note', async () => {
    insertLineCheck({
      station_id: 'cold-line',
      item: 'lettuce par',
      status: 'pass',
      note: 'restocked',
    });
    const res = await GET(getReq(`?date=${SHIFT}`));
    const body = await res.json();
    assert.strictEqual(body.entries.length, 0);
  });

  it('skips line_check row that failed but has no note', async () => {
    insertLineCheck({
      station_id: 'cold-line',
      item: 'lettuce par',
      status: 'fail',
      note: null,
    });
    const res = await GET(getReq(`?date=${SHIFT}`));
    const body = await res.json();
    assert.strictEqual(body.entries.length, 0);
  });

  it('skips rows from a different shift_date', async () => {
    testDb.prepare(`
      INSERT INTO line_check_entries
        (shift_date, station_id, item, status, note, cook_id, location_id)
      VALUES ('2026-05-04', 'fryer', 'oil', 'fail', 'fixed', 'cara', ?)
    `).run(LOC);
    const res = await GET(getReq(`?date=${SHIFT}`));
    const body = await res.json();
    assert.strictEqual(body.entries.length, 0);
  });

  it('skips rows from a different location', async () => {
    insertLineCheck({ station_id: 'fryer', item: 'oil', status: 'fail', note: 'fixed' });
    // overwrite to other location
    testDb.exec(`UPDATE line_check_entries SET location_id='other-site'`);
    const res = await GET(getReq(`?date=${SHIFT}`));
    const body = await res.json();
    assert.strictEqual(body.entries.length, 0);
  });
});

describe('GET /api/corrective-actions — station_id narrowing', () => {
  it('filters to one station and drops the temp_log union', async () => {
    insertTempLog({
      point_id: 'walk_in_cooler',
      corrective_action: 'reset thermostat',
    });
    insertLineCheck({
      station_id: 'fryer',
      item: 'oil',
      status: 'fail',
      note: 'filtered',
    });
    insertLineCheck({
      station_id: 'cold-line',
      item: 'lettuce',
      status: 'fail',
      note: 'restocked',
      created_at: '2026-05-05T11:30:00Z',
    });

    const res = await GET(getReq(`?date=${SHIFT}&station_id=fryer`));
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.station_id, 'fryer');
    assert.strictEqual(body.entries.length, 1);
    assert.strictEqual(body.entries[0].source, 'line_check');
    assert.strictEqual(body.entries[0].station_id, 'fryer');
  });
});

describe('GET /api/corrective-actions — defaults', () => {
  it('falls back to today when ?date is missing or malformed', async () => {
    const res = await GET(getReq(``));
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    // We only check shape — todayISO() is timezone-dependent; the
    // route just has to populate it.
    assert.match(body.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.strictEqual(Array.isArray(body.entries), true);
  });

  it('falls back to today when ?date is a malformed string', async () => {
    const res = await GET(getReq(`?date=yesterday`));
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.match(body.date, /^\d{4}-\d{2}-\d{2}$/);
  });
});

// ── The four sources the feed used to miss ────────────────────────
//
// Each of these routes REFUSES the write unless the cook documents the
// fix (cooling 422 'breach requires a corrective action note', sanitizer
// 422, receiving 422 'needs_rejection_note'), so a shift that blew a
// cooling window has a corrective action on record by construction. The
// feed simply never read the tables it was stored in.

function insertCooling({
  item,
  corrective_action,
  status = 'breach',
  station_id = 'saute',
  cook_id = 'dana',
  started_at = '2026-05-05T08:00:00Z',
  stage2_at = '2026-05-05T14:00:00Z',
  created_at = '2026-05-05T08:00:00Z',
}) {
  testDb.prepare(`
    INSERT INTO cooling_log
      (shift_date, location_id, item, station_id, started_at, start_reading_f,
       stage1_at, stage1_reading_f, stage2_at, stage2_reading_f,
       status, breach_reason, corrective_action, cook_id, created_at)
    VALUES (?, ?, ?, ?, ?, 135, NULL, NULL, ?, 45, ?, 'stage 2 over 4h', ?, ?, ?)
  `).run(SHIFT, LOC, item, station_id, started_at, stage2_at, status, corrective_action, cook_id, created_at);
}

function insertSanitizer({
  point_label,
  corrective_action,
  status = 'low',
  station_id = 'dish',
  cook_id = 'eli',
  created_at = '2026-05-05T12:00:00Z',
}) {
  testDb.prepare(`
    INSERT INTO sanitizer_checks
      (shift_date, location_id, station_id, point_label, chemistry,
       concentration_ppm, required_min_ppm, required_max_ppm, water_temp_f,
       status, corrective_action, cook_id, created_at)
    VALUES (?, ?, ?, ?, 'quat', 150, 200, 400, 75, ?, ?, ?, ?)
  `).run(SHIFT, LOC, station_id, point_label, status, corrective_action, cook_id, created_at);
}

function insertReceiving({
  vendor,
  item,
  rejection_reason,
  status = 'rejected',
  cook_id = 'finn',
  created_at = '2026-05-05T07:00:00Z',
}) {
  testDb.prepare(`
    INSERT INTO receiving_log
      (shift_date, location_id, vendor, invoice_ref, category, item,
       reading_f, required_max_f, status, rejection_reason, cook_id, created_at)
    VALUES (?, ?, ?, 'INV-1', 'refrigerated', ?, 52, 41, ?, ?, ?, ?)
  `).run(SHIFT, LOC, vendor, item, status, rejection_reason, cook_id, created_at);
}

function insertPest({
  pest,
  corrective_action,
  entry_type = 'sighting',
  cook_id = 'gus',
  created_at = '2026-05-05T13:00:00Z',
}) {
  testDb.prepare(`
    INSERT INTO pest_control_log
      (shift_date, location_id, entry_type, vendor, technician, findings,
       pest, severity, corrective_action, cook_id, created_at)
    VALUES (?, ?, ?, NULL, NULL, 'droppings by dry storage', ?, 'medium', ?, ?, ?)
  `).run(SHIFT, LOC, entry_type, pest, corrective_action, cook_id, created_at);
}

describe('GET /api/corrective-actions — every table that holds a fix', () => {
  it('reads cooling, sanitizer, receiving and pest, not just temp_log and line_check', async () => {
    insertTempLog({ point_id: 'walk_in_cooler', corrective_action: 'thermostat reset', created_at: '2026-05-05T09:00:00Z' });
    insertLineCheck({ station_id: 'fryer', item: 'oil quality', status: 'fail', note: 'filtered', created_at: '2026-05-05T11:00:00Z' });
    insertCooling({ item: 'pork green chile', corrective_action: 'split into hotel pans, back in the blast' });
    insertSanitizer({ point_label: 'dish machine final rinse', corrective_action: 'remade the bucket at 300ppm' });
    insertReceiving({ vendor: 'Shamrock', item: 'chicken thighs', rejection_reason: 'refused at 52F, credit requested' });
    insertPest({ pest: 'mouse', corrective_action: 'traps set, called the vendor' });

    const res = await GET(getReq(`?date=${SHIFT}`));
    assert.strictEqual(res.status, 200);
    const body = await res.json();

    const bySource = new Map(body.entries.map((e) => [e.source, e]));
    assert.deepEqual(
      [...bySource.keys()].sort(),
      ['cooling', 'line_check', 'pest', 'receiving', 'sanitizer', 'temp_log'],
      'every table that stores a corrective action must reach the feed',
    );
    assert.strictEqual(bySource.get('cooling').note, 'split into hotel pans, back in the blast');
    assert.strictEqual(bySource.get('cooling').subject, 'pork green chile');
    assert.strictEqual(bySource.get('sanitizer').note, 'remade the bucket at 300ppm');
    assert.strictEqual(bySource.get('sanitizer').subject, 'dish machine final rinse');
    assert.strictEqual(bySource.get('receiving').note, 'refused at 52F, credit requested');
    assert.strictEqual(bySource.get('receiving').subject, 'Shamrock: chicken thighs');
    assert.strictEqual(bySource.get('pest').note, 'traps set, called the vendor');
    assert.strictEqual(bySource.get('pest').subject, 'mouse');
  });

  it('times a cooling fix at the stage-2 reading, not the batch start', async () => {
    // The corrective action is entered when the cook closes the breach,
    // hours after the batch went in. Filing it at started_at would put it
    // before the breach it answers.
    insertCooling({
      item: 'beans',
      corrective_action: 'iced down',
      started_at: '2026-05-05T08:00:00Z',
      stage2_at: '2026-05-05T15:30:00Z',
      created_at: '2026-05-05T08:00:00Z',
    });
    const body = await (await GET(getReq(`?date=${SHIFT}`))).json();
    assert.strictEqual(body.entries[0].created_at, '2026-05-05T15:30:00Z');
  });

  it('narrows station-scoped sources and drops the ones with no station', async () => {
    insertCooling({ item: 'stock', corrective_action: 'ice wand', station_id: 'saute' });
    insertSanitizer({ point_label: 'bar sinks', corrective_action: 'refilled', station_id: 'bar' });
    insertReceiving({ vendor: 'Sysco', item: 'milk', rejection_reason: 'warm on arrival' });
    insertPest({ pest: 'fly', corrective_action: 'screen fixed' });

    const body = await (await GET(getReq(`?date=${SHIFT}&station_id=saute`))).json();
    const sources = body.entries.map((e) => e.source);
    assert.deepEqual(sources, ['cooling'], 'only the saute cooling row is station-scoped to saute');
  });

  it('ignores rows whose corrective action was never written', async () => {
    insertCooling({ item: 'rice', corrective_action: null, status: 'ok' });
    insertSanitizer({ point_label: 'three-comp', corrective_action: '   ', status: 'ok' });
    insertReceiving({ vendor: 'Sysco', item: 'lettuce', rejection_reason: null, status: 'accepted' });
    insertPest({ pest: null, corrective_action: null, entry_type: 'trap_check' });

    const body = await (await GET(getReq(`?date=${SHIFT}`))).json();
    assert.deepEqual(body.entries, []);
  });
});
