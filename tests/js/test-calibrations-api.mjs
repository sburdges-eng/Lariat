#!/usr/bin/env node
// Integration tests for /api/thermometer-calibrations.
//
// Spin up a temp SQLite DB, import the route in-process, assert on
// the Response objects. Covers:
//   - Happy POST (pass + fail both persisted).
//   - 400 validation (missing probe id, bad method, bad reading).
//   - Audit row emitted per insert — note='fail:<probe>:<method>' on fail.
//   - GET summary shape with multiple probes.
//   - GET ?probe_id= filter.
//   - temp-log integration: POST /api/temp-log with a probe_id whose
//     last cal was failed surfaces a calibration_warning.
//
// Run: node --test tests/js/test-calibrations-api.mjs

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

register(new URL('./resolver.mjs', import.meta.url));

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-calib-api-'));
const TMP_DB = path.join(TMP_DIR, 'lariat-test.db');

const db = await import('../../lib/db.ts');
const route = await import('../../app/api/thermometer-calibrations/route.js');
const tempLogRoute = await import('../../app/api/temp-log/route.js');

db.setDbPathForTest(TMP_DB);
const testDb = db.getDb();

const { POST, GET } = route;
const { POST: POST_TEMP } = tempLogRoute;
const { todayISO } = db;

after(() => {
  db.setDbPathForTest(null);
  try {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
});

beforeEach(() => {
  testDb.exec(
    'DELETE FROM thermometer_calibrations; DELETE FROM temp_log; DELETE FROM audit_events;',
  );
});

function postReq(body) {
  return new Request('http://localhost/api/thermometer-calibrations', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function getReq(qs = '') {
  return new Request(`http://localhost/api/thermometer-calibrations${qs}`);
}

function postTempReq(body) {
  return new Request('http://localhost/api/temp-log', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function countCalibrations() {
  return testDb
    .prepare('SELECT COUNT(*) AS c FROM thermometer_calibrations')
    .get().c;
}

function countAudit(entity) {
  return testDb
    .prepare('SELECT COUNT(*) AS c FROM audit_events WHERE entity = ?')
    .get(entity).c;
}

// ── POST — happy path (pass) ─────────────────────────────────────

describe('POST /api/thermometer-calibrations — pass path', () => {
  it('accepts an ice_point 32°F reading — status pass, row persisted', async () => {
    const res = await POST(
      postReq({
        thermometer_id: 'probe-1',
        method: 'ice_point',
        reading_f: 32,
        cook_id: 'alice',
      }),
    );
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.ok, true);
    assert.strictEqual(body.decision.status, 'pass');
    assert.strictEqual(body.decision.expected_f, 32);
    assert.strictEqual(body.decision.tolerance_f, 2);
    assert.strictEqual(body.entry.passed, 1);
    assert.strictEqual(body.entry.before_reading_f, 32);
    assert.strictEqual(body.entry.thermometer_id, 'probe-1');
    assert.strictEqual(countCalibrations(), 1);
  });

  it('accepts a boiling_point reading at Lariat elevation (197.8°F)', async () => {
    const res = await POST(
      postReq({
        thermometer_id: 'probe-2',
        method: 'boiling_point',
        reading_f: 197.8,
      }),
    );
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.decision.status, 'pass');
    assert.strictEqual(body.entry.passed, 1);
  });

  it('elevation override is honored (sea level: 212°F passes)', async () => {
    const res = await POST(
      postReq({
        thermometer_id: 'probe-3',
        method: 'boiling_point',
        reading_f: 212,
        elevation_ft: 0,
      }),
    );
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.decision.status, 'pass');
    assert.strictEqual(body.decision.elevation_ft, 0);
  });
});

// ── POST — fail persists (the defining policy of this route) ─────

describe('POST /api/thermometer-calibrations — fail path persists', () => {
  it('ice_point reading of 37°F (5°F off) is saved with passed=0 and NO 422', async () => {
    const res = await POST(
      postReq({
        thermometer_id: 'probe-1',
        method: 'ice_point',
        reading_f: 37,
        note: 'retired probe-1; pulled spare from stock',
        cook_id: 'alice',
      }),
    );
    // No 422 — fails are recorded, not refused.
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.decision.status, 'fail');
    assert.match(body.decision.reason, /off the 32.0°F target/);
    assert.strictEqual(body.entry.passed, 0);
    assert.strictEqual(body.entry.action_taken, 'retired probe-1; pulled spare from stock');
    assert.strictEqual(countCalibrations(), 1);
  });

  it('boiling_point reading of 212°F at Lariat elevation is a fail (persisted)', async () => {
    const res = await POST(
      postReq({
        thermometer_id: 'probe-2',
        method: 'boiling_point',
        reading_f: 212,
        // elevation_ft omitted → defaults to 7800
      }),
    );
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.decision.status, 'fail');
    assert.strictEqual(body.entry.passed, 0);
  });
});

// ── POST — validation / 400 path ─────────────────────────────────

describe('POST /api/thermometer-calibrations — validation', () => {
  it('400 when thermometer_id is missing', async () => {
    const res = await POST(postReq({ method: 'ice_point', reading_f: 32 }));
    assert.strictEqual(res.status, 400);
    assert.strictEqual(countCalibrations(), 0);
  });

  it('400 when method is unknown', async () => {
    const res = await POST(
      postReq({ thermometer_id: 'probe-1', method: 'slurry', reading_f: 32 }),
    );
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /unknown calibration method/);
    assert.ok(Array.isArray(body.methods));
  });

  it('400 when reading_f is missing', async () => {
    const res = await POST(
      postReq({ thermometer_id: 'probe-1', method: 'ice_point' }),
    );
    assert.strictEqual(res.status, 400);
  });

  it('400 when reading_f is non-numeric', async () => {
    const res = await POST(
      postReq({
        thermometer_id: 'probe-1',
        method: 'ice_point',
        reading_f: 'cold',
      }),
    );
    assert.strictEqual(res.status, 400);
  });

  it('400 when reading_f is absurd (off the charts)', async () => {
    const res = await POST(
      postReq({
        thermometer_id: 'probe-1',
        method: 'ice_point',
        reading_f: 9999,
      }),
    );
    assert.strictEqual(res.status, 400);
  });

  it('400 when elevation_ft is non-numeric', async () => {
    const res = await POST(
      postReq({
        thermometer_id: 'probe-1',
        method: 'boiling_point',
        reading_f: 198,
        elevation_ft: 'high',
      }),
    );
    assert.strictEqual(res.status, 400);
  });

  it('400 when note is over 500 chars', async () => {
    const res = await POST(
      postReq({
        thermometer_id: 'probe-1',
        method: 'ice_point',
        reading_f: 32,
        note: 'x'.repeat(600),
      }),
    );
    assert.strictEqual(res.status, 400);
  });

  it('probe_id alias for thermometer_id is accepted', async () => {
    const res = await POST(
      postReq({ probe_id: 'probe-alias', method: 'ice_point', reading_f: 32 }),
    );
    assert.strictEqual(res.status, 200);
    const row = testDb
      .prepare('SELECT thermometer_id FROM thermometer_calibrations ORDER BY id DESC LIMIT 1')
      .get();
    assert.strictEqual(row.thermometer_id, 'probe-alias');
  });
});

// ── POST — audit trail ───────────────────────────────────────────

describe('POST /api/thermometer-calibrations — audit rows', () => {
  it('one audit row per calibration (pass → note=null)', async () => {
    await POST(
      postReq({
        thermometer_id: 'probe-1',
        method: 'ice_point',
        reading_f: 32,
        cook_id: 'alice',
      }),
    );
    assert.strictEqual(countAudit('thermometer_calibrations'), 1);
    const audit = testDb
      .prepare('SELECT * FROM audit_events WHERE entity=?')
      .get('thermometer_calibrations');
    assert.strictEqual(audit.entity, 'thermometer_calibrations');
    assert.strictEqual(audit.action, 'insert');
    assert.strictEqual(audit.actor_cook_id, 'alice');
    assert.strictEqual(audit.actor_source, 'cook_ui');
    assert.strictEqual(audit.note, null);
    assert.ok(audit.payload_json);
  });

  it('audit note carries "fail:<probe>:<method>" on fail', async () => {
    await POST(
      postReq({
        thermometer_id: 'probe-1',
        method: 'ice_point',
        reading_f: 37,
      }),
    );
    const audit = testDb
      .prepare('SELECT * FROM audit_events WHERE entity=?')
      .get('thermometer_calibrations');
    assert.strictEqual(audit.note, 'fail:probe-1:ice_point');
  });
});

// ── GET ─────────────────────────────────────────────────────────

describe('GET /api/thermometer-calibrations', () => {
  it('empty DB returns empty summary + config', async () => {
    const res = await GET(getReq());
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.deepStrictEqual(body.summary, []);
    assert.strictEqual(body.tolerance_f, 2);
    assert.strictEqual(body.default_elevation_ft, 7800);
    assert.strictEqual(body.default_frequency_days, 30);
  });

  it('summary has one entry per probe with status', async () => {
    await POST(postReq({ thermometer_id: 'probe-1', method: 'ice_point', reading_f: 32 }));
    await POST(postReq({ thermometer_id: 'probe-2', method: 'ice_point', reading_f: 37 }));
    const res = await GET(getReq());
    const body = await res.json();
    assert.strictEqual(body.summary.length, 2);
    const byId = Object.fromEntries(body.summary.map((s) => [s.thermometer_id, s]));
    assert.strictEqual(byId['probe-1'].status, 'ok');
    assert.strictEqual(byId['probe-2'].status, 'failed');
  });

  it('?probe_id= filters entries + summary to that probe', async () => {
    await POST(postReq({ thermometer_id: 'probe-1', method: 'ice_point', reading_f: 32 }));
    await POST(postReq({ thermometer_id: 'probe-2', method: 'ice_point', reading_f: 32 }));
    const res = await GET(getReq('?probe_id=probe-1'));
    const body = await res.json();
    assert.strictEqual(body.summary.length, 1);
    assert.strictEqual(body.summary[0].thermometer_id, 'probe-1');
    assert.ok(Array.isArray(body.entries));
    assert.strictEqual(body.entries.length, 1);
  });

  it('most recent fail takes precedence over earlier pass (status=failed)', async () => {
    await POST(postReq({ thermometer_id: 'probe-1', method: 'ice_point', reading_f: 32 }));
    await POST(postReq({ thermometer_id: 'probe-1', method: 'ice_point', reading_f: 40 }));
    const res = await GET(getReq('?probe_id=probe-1'));
    const body = await res.json();
    assert.strictEqual(body.summary[0].status, 'failed');
  });
});

// ── temp-log integration: calibration_warning ────────────────────

describe('POST /api/temp-log with probe_id surfaces calibration_warning', () => {
  it('no warning when probe has a recent passing calibration', async () => {
    await POST(postReq({ thermometer_id: 'probe-1', method: 'ice_point', reading_f: 32 }));
    const res = await POST_TEMP(
      postTempReq({
        shift_date: todayISO(),
        point_id: 'walk_in_cooler',
        reading_f: 38,
        probe_id: 'probe-1',
      }),
    );
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.calibration_warning, null);
    // The write landed and the probe_id was persisted.
    const row = testDb.prepare('SELECT probe_id FROM temp_log ORDER BY id DESC LIMIT 1').get();
    assert.strictEqual(row.probe_id, 'probe-1');
  });

  it('warning when probe has no calibration (unknown) — write still succeeds', async () => {
    const res = await POST_TEMP(
      postTempReq({
        shift_date: todayISO(),
        point_id: 'walk_in_cooler',
        reading_f: 38,
        probe_id: 'probe-new',
      }),
    );
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.match(body.calibration_warning, /no calibration on record/);
    // The warning is advisory — the temp_log row is persisted anyway.
    assert.strictEqual(
      testDb.prepare('SELECT COUNT(*) AS c FROM temp_log').get().c,
      1,
    );
  });

  it('warning when probe last cal was a fail', async () => {
    await POST(postReq({ thermometer_id: 'probe-bad', method: 'ice_point', reading_f: 37 }));
    const res = await POST_TEMP(
      postTempReq({
        shift_date: todayISO(),
        point_id: 'walk_in_cooler',
        reading_f: 38,
        probe_id: 'probe-bad',
      }),
    );
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.match(body.calibration_warning, /failed its last calibration/);
  });

  it('omitting probe_id leaves calibration_warning null (no lookup)', async () => {
    const res = await POST_TEMP(
      postTempReq({
        shift_date: todayISO(),
        point_id: 'walk_in_cooler',
        reading_f: 38,
      }),
    );
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.calibration_warning, null);
  });

  it('audit row carries "calibration_warning:<probe>" when warning fires', async () => {
    const res = await POST_TEMP(
      postTempReq({
        shift_date: todayISO(),
        point_id: 'walk_in_cooler',
        reading_f: 38,
        probe_id: 'probe-new',
      }),
    );
    assert.strictEqual(res.status, 200);
    const audit = testDb
      .prepare('SELECT * FROM audit_events WHERE entity=? ORDER BY id DESC LIMIT 1')
      .get('temp_log');
    assert.match(audit.note, /calibration_warning:probe-new/);
  });
});
