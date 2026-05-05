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
