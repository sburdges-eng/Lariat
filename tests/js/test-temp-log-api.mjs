#!/usr/bin/env node
// Integration tests for the summary+audit additions to /api/temp-log.
//
// These tests are additive to tests/js/test-temp-log-route.mjs — that
// file covers happy path, validation, PIN gate, etc. This one focuses
// on the pieces bundle E added:
//
//   1. GET returns a per-point `summary` computed by classifyReadings.
//   2. POST writes one audit_events row per insert, with the correct
//      entity, entity_id, action, and actor_source.
//   3. 422 (needs_corrective_action) writes NEITHER a temp_log row
//      NOR an audit_events row.
//
// Run: node --test tests/js/test-temp-log-api.mjs

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

register(new URL('./resolver.mjs', import.meta.url));

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-temp-log-api-'));
const TMP_DB = path.join(TMP_DIR, 'lariat-test.db');

const ORIGINAL_PIN = process.env.LARIAT_PIN;
process.env.LARIAT_PIN = '4242';

const db = await import('../../lib/db.ts');
const route = await import('../../app/api/temp-log/route.js');

db.setDbPathForTest(TMP_DB);
const testDb = db.getDb();

const { POST, GET } = route;
const { todayISO } = db;

after(() => {
  db.setDbPathForTest(null);
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
  if (ORIGINAL_PIN === undefined) delete process.env.LARIAT_PIN;
  else process.env.LARIAT_PIN = ORIGINAL_PIN;
});

beforeEach(() => {
  testDb.exec('DELETE FROM temp_log; DELETE FROM audit_events;');
});

function postReq(body) {
  return new Request('http://localhost/api/temp-log', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function getReq(qs = '') {
  return new Request(`http://localhost/api/temp-log${qs}`);
}

function countTempLog() {
  return testDb.prepare('SELECT COUNT(*) AS c FROM temp_log').get().c;
}

function countAudit(entity) {
  return testDb
    .prepare('SELECT COUNT(*) AS c FROM audit_events WHERE entity = ?')
    .get(entity).c;
}

// ── GET /api/temp-log — summary payload ───────────────────────────

describe('GET /api/temp-log — includes per-CCP summary by default', () => {
  it('returns a summary array covering every registry point', async () => {
    const res = await GET(getReq());
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.summary), 'summary must be an array');
    // summary has at least 8 entries (the CCP coverage target)
    assert.ok(body.summary.length >= 8, `summary too short: ${body.summary.length}`);
    for (const s of body.summary) {
      assert.ok(s.point_id);
      assert.ok(s.ccp_id);
      assert.ok(['green', 'yellow', 'red', 'gray'].includes(s.status));
    }
  });

  it('a fresh day has every CCP gray (no readings logged yet)', async () => {
    const res = await GET(getReq());
    const body = await res.json();
    for (const s of body.summary) {
      assert.strictEqual(s.status, 'gray', `${s.point_id} should be gray on empty day`);
      assert.strictEqual(s.total_readings, 0);
    }
  });

  it('one ok reading flips that tile green; others stay gray', async () => {
    await POST(postReq({
      shift_date: todayISO(),
      point_id: 'walk_in_cooler',
      reading_f: 38,
    }));
    const res = await GET(getReq());
    const body = await res.json();
    const byId = Object.fromEntries(body.summary.map((s) => [s.point_id, s]));
    assert.strictEqual(byId.walk_in_cooler.status, 'green');
    assert.strictEqual(byId.walk_in_cooler.total_readings, 1);
    assert.strictEqual(byId.walk_in_cooler.last_reading_f, 38);
    assert.strictEqual(byId.freezer.status, 'gray');
  });

  it('out-of-range with a note is yellow; without a note would not be stored', async () => {
    await POST(postReq({
      shift_date: todayISO(),
      point_id: 'walk_in_cooler',
      reading_f: 44,
      corrective_action: 'moved to reach-in and called tech',
    }));
    const res = await GET(getReq());
    const body = await res.json();
    const s = body.summary.find((x) => x.point_id === 'walk_in_cooler');
    assert.strictEqual(s.status, 'yellow');
    assert.strictEqual(s.corrective_count, 1);
    assert.strictEqual(s.critical_count, 0);
  });

  it('?summary=0 opts out of the summary payload', async () => {
    const res = await GET(getReq('?summary=0'));
    const body = await res.json();
    assert.strictEqual(body.summary, null);
    // entries are still there
    assert.ok(Array.isArray(body.entries));
  });

  it('summary honors the location query param', async () => {
    await POST(postReq({
      shift_date: todayISO(),
      point_id: 'walk_in_cooler',
      reading_f: 38,
      location_id: 'downtown',
    }));
    const res = await GET(getReq('?location=downtown'));
    const body = await res.json();
    assert.strictEqual(body.location_id, 'downtown');
    const s = body.summary.find((x) => x.point_id === 'walk_in_cooler');
    assert.strictEqual(s.status, 'green');
    // Default location should still be gray
    const resDefault = await GET(getReq());
    const bodyDefault = await resDefault.json();
    const sDefault = bodyDefault.summary.find((x) => x.point_id === 'walk_in_cooler');
    assert.strictEqual(sDefault.status, 'gray');
  });
});

// ── POST — audit trail ────────────────────────────────────────────

describe('POST /api/temp-log — writes an audit_events row per insert', () => {
  it('creates exactly one audit row for an accepted in-range POST', async () => {
    const res = await POST(postReq({
      shift_date: todayISO(),
      point_id: 'walk_in_cooler',
      reading_f: 38,
      cook_id: 'alice',
    }));
    assert.strictEqual(res.status, 200);
    assert.strictEqual(countTempLog(), 1);
    assert.strictEqual(countAudit('temp_log'), 1);

    const audit = testDb.prepare('SELECT * FROM audit_events WHERE entity=? ORDER BY id DESC').get('temp_log');
    assert.strictEqual(audit.entity, 'temp_log');
    assert.strictEqual(audit.action, 'insert');
    assert.strictEqual(audit.actor_cook_id, 'alice');
    assert.strictEqual(audit.actor_source, 'cook_ui');
    assert.ok(audit.payload_json, 'payload_json must be populated');
    const payload = JSON.parse(audit.payload_json);
    assert.strictEqual(payload.point_id, 'walk_in_cooler');
    assert.strictEqual(payload.reading_f, 38);
    assert.strictEqual(audit.entity_id, payload.id);
    // In-range reading: note should be null (no breach context).
    assert.strictEqual(audit.note, null);
  });

  it('creates an audit row WITH note="out_of_range:<point_id>" for an accepted out-of-range POST', async () => {
    const res = await POST(postReq({
      shift_date: todayISO(),
      point_id: 'walk_in_cooler',
      reading_f: 44,
      corrective_action: 'moved to reach-in',
    }));
    assert.strictEqual(res.status, 200);
    assert.strictEqual(countAudit('temp_log'), 1);
    const audit = testDb.prepare('SELECT * FROM audit_events WHERE entity=? ORDER BY id DESC').get('temp_log');
    assert.strictEqual(audit.note, 'out_of_range:walk_in_cooler');
  });

  it('does NOT write an audit row when POST is rejected (422 out-of-range without note)', async () => {
    const res = await POST(postReq({
      shift_date: todayISO(),
      point_id: 'walk_in_cooler',
      reading_f: 44,
    }));
    assert.strictEqual(res.status, 422);
    assert.strictEqual(countTempLog(), 0);
    assert.strictEqual(countAudit('temp_log'), 0);
  });

  it('does NOT write an audit row when POST is rejected (400 bad input)', async () => {
    const res = await POST(postReq({
      shift_date: todayISO(),
      point_id: 'walk_in_cooler',
      reading_f: '42',
    }));
    assert.strictEqual(res.status, 400);
    assert.strictEqual(countAudit('temp_log'), 0);
  });

  it('does NOT write an audit row for an unknown point_id', async () => {
    const res = await POST(postReq({
      shift_date: todayISO(),
      point_id: 'not_a_point',
      reading_f: 38,
    }));
    assert.strictEqual(res.status, 400);
    assert.strictEqual(countAudit('temp_log'), 0);
  });

  it('N accepted POSTs produce exactly N audit rows', async () => {
    for (let i = 0; i < 5; i++) {
      await POST(postReq({
        shift_date: todayISO(),
        point_id: 'freezer',
        reading_f: -10 - i,
      }));
    }
    assert.strictEqual(countTempLog(), 5);
    assert.strictEqual(countAudit('temp_log'), 5);
  });

  it('audit.shift_date and location_id match the request', async () => {
    await POST(postReq({
      shift_date: todayISO(),
      point_id: 'cook_poultry',
      reading_f: 172,
      location_id: 'downtown',
    }));
    const audit = testDb.prepare('SELECT * FROM audit_events WHERE entity=? ORDER BY id DESC').get('temp_log');
    assert.strictEqual(audit.location_id, 'downtown');
    assert.strictEqual(audit.shift_date, todayISO());
  });
});
