#!/usr/bin/env node
// Integration tests for /api/signoff regulatory gates: L5 (minor +
// hazardous station). L6 (sick-worker exclusion) cases are appended
// in the L6 commit.
// Run: node --experimental-strip-types --test tests/js/test-signoff-gates-api.mjs

import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

register(new URL('./resolver.mjs', import.meta.url));

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-signoff-gates-'));
const TMP_DB = path.join(TMP_DIR, 'lariat-test.db');

const db = await import('../../lib/db.ts');
const route = await import('../../app/api/signoff/route.js');

db.setDbPathForTest(TMP_DB);
const testDb = db.getDb();

const { POST } = route;

after(() => {
  db.setDbPathForTest(null);
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

beforeEach(() => {
  testDb.exec(`
    DELETE FROM station_signoffs;
    DELETE FROM staff_flags;
    DELETE FROM sick_worker_reports;
    DELETE FROM line_check_entries;
    DELETE FROM audit_events;
  `);
});

const SHIFT = '2026-05-05';
const LOC = 'default';

function postReq(body) {
  return new Request('http://localhost/api/signoff', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function setMinorFlag({ cook_id, effective_to = null, location_id = LOC }) {
  testDb.prepare(`
    INSERT INTO staff_flags (location_id, cook_id, flag, effective_from, effective_to)
    VALUES (?, ?, 'minor', ?, ?)
  `).run(location_id, cook_id, '2026-01-01', effective_to);
}

function countSignoffs() {
  return testDb.prepare('SELECT COUNT(*) AS c FROM station_signoffs').get().c;
}

// ── L5 ───────────────────────────────────────────────────────────

describe('POST /api/signoff — L5 minor on prohibited station', () => {
  it('blocks active minor flag + slicer station with 422 + citation', async () => {
    setMinorFlag({ cook_id: 'cook-teen' });
    const res = await POST(postReq({
      shift_date: SHIFT,
      station_id: 'slicer',
      cook_id: 'cook-teen',
    }));
    assert.strictEqual(res.status, 422);
    const body = await res.json();
    assert.match(body.error, /minor/i);
    assert.ok(body.citation && body.citation.length > 0);
    assert.match(body.citation, /YEOA|Hazardous Orders/);
    assert.strictEqual(body.station_id, 'slicer');
    assert.strictEqual(countSignoffs(), 0);
  });

  it('blocks minor on prep-cold (prep-* prefix)', async () => {
    setMinorFlag({ cook_id: 'cook-teen' });
    const res = await POST(postReq({
      shift_date: SHIFT,
      station_id: 'prep-cold',
      cook_id: 'cook-teen',
    }));
    assert.strictEqual(res.status, 422);
    assert.strictEqual(countSignoffs(), 0);
  });

  it('allows minor on the line (no hazardous equipment)', async () => {
    setMinorFlag({ cook_id: 'cook-teen' });
    const res = await POST(postReq({
      shift_date: SHIFT,
      station_id: 'line',
      cook_id: 'cook-teen',
    }));
    assert.strictEqual(res.status, 200);
    assert.strictEqual(countSignoffs(), 1);
  });

  it('allows non-minor on prohibited station', async () => {
    // No staff_flag inserted — cook is not a minor.
    const res = await POST(postReq({
      shift_date: SHIFT,
      station_id: 'slicer',
      cook_id: 'cook-adult',
    }));
    assert.strictEqual(res.status, 200);
    assert.strictEqual(countSignoffs(), 1);
  });

  it('allows minor on prohibited station when minor flag is INACTIVE (effective_to in past)', async () => {
    setMinorFlag({ cook_id: 'cook-grown', effective_to: '2025-01-01' });
    const res = await POST(postReq({
      shift_date: SHIFT,
      station_id: 'slicer',
      cook_id: 'cook-grown',
    }));
    assert.strictEqual(res.status, 200);
    assert.strictEqual(countSignoffs(), 1);
  });

  it('only blocks minor flag in the same location', async () => {
    setMinorFlag({ cook_id: 'cook-teen', location_id: 'other-site' });
    const res = await POST(postReq({
      shift_date: SHIFT,
      station_id: 'slicer',
      cook_id: 'cook-teen',
      location_id: LOC,
    }));
    assert.strictEqual(res.status, 200);
    assert.strictEqual(countSignoffs(), 1);
  });
});

describe('POST /api/signoff — clean path baseline', () => {
  it('clean cook + line + no fails → 200 + audit row', async () => {
    const res = await POST(postReq({
      shift_date: SHIFT,
      station_id: 'line',
      cook_id: 'cook-clean',
    }));
    assert.strictEqual(res.status, 200);
    assert.strictEqual(countSignoffs(), 1);
    const audits = testDb
      .prepare(`SELECT COUNT(*) AS c FROM audit_events WHERE entity='station_signoffs'`)
      .get().c;
    assert.strictEqual(audits, 1);
  });
});
