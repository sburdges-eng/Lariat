#!/usr/bin/env node
// Integration tests for /api/signoff regulatory gates: L5 (minor +
// hazardous station) and L6 (sick-worker exclusion).
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
const route = await import('../../app/api/signoff/route.ts');

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

function setSickReport({ cook_id, action, return_at = null, location_id = LOC }) {
  testDb.prepare(`
    INSERT INTO sick_worker_reports
      (shift_date, location_id, cook_id, reported_by_pic_id, symptoms,
       diagnosed_illness, action, started_at, return_at, clearance_source, note)
    VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?, NULL, NULL)
  `).run(SHIFT, location_id, cook_id, 'pic-1', 'vomiting', action, '2026-05-05T08:00:00Z', return_at);
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

// ── L6 ───────────────────────────────────────────────────────────

describe('POST /api/signoff — L6 sick-worker exclusion', () => {
  it('blocks active "excluded" report with 422 + FDA §2-201.12', async () => {
    setSickReport({ cook_id: 'cook-sick', action: 'excluded' });
    const res = await POST(postReq({
      shift_date: SHIFT,
      station_id: 'line',
      cook_id: 'cook-sick',
    }));
    assert.strictEqual(res.status, 422);
    const body = await res.json();
    assert.match(body.error, /exclusion|illness/i);
    assert.match(body.citation, /2-201\.12/);
    assert.strictEqual(countSignoffs(), 0);
  });

  it('allows signoff after clearance (return_at set)', async () => {
    setSickReport({
      cook_id: 'cook-was-sick',
      action: 'excluded',
      return_at: '2026-05-04T14:00:00Z',
    });
    const res = await POST(postReq({
      shift_date: SHIFT,
      station_id: 'line',
      cook_id: 'cook-was-sick',
    }));
    assert.strictEqual(res.status, 200);
    assert.strictEqual(countSignoffs(), 1);
  });

  it('allows signoff when action is "monitor" (informational only)', async () => {
    setSickReport({ cook_id: 'cook-monitor', action: 'monitor' });
    const res = await POST(postReq({
      shift_date: SHIFT,
      station_id: 'line',
      cook_id: 'cook-monitor',
    }));
    assert.strictEqual(res.status, 200);
    assert.strictEqual(countSignoffs(), 1);
  });

  it('blocks active "restricted" report (also blocking)', async () => {
    setSickReport({ cook_id: 'cook-restricted', action: 'restricted' });
    const res = await POST(postReq({
      shift_date: SHIFT,
      station_id: 'line',
      cook_id: 'cook-restricted',
    }));
    assert.strictEqual(res.status, 422);
    assert.strictEqual(countSignoffs(), 0);
  });

  it('only blocks sick reports in the same location', async () => {
    setSickReport({
      cook_id: 'cook-sick',
      action: 'excluded',
      location_id: 'other-site',
    });
    const res = await POST(postReq({
      shift_date: SHIFT,
      station_id: 'line',
      cook_id: 'cook-sick',
      location_id: LOC,
    }));
    assert.strictEqual(res.status, 200);
    assert.strictEqual(countSignoffs(), 1);
  });
});

// ── Combined / ordering ─────────────────────────────────────────

describe('POST /api/signoff — gate ordering', () => {
  it('L5 fires before L6 (minor + sick on slicer → minor citation)', async () => {
    setMinorFlag({ cook_id: 'cook-both' });
    setSickReport({ cook_id: 'cook-both', action: 'excluded' });
    const res = await POST(postReq({
      shift_date: SHIFT,
      station_id: 'slicer',
      cook_id: 'cook-both',
    }));
    assert.strictEqual(res.status, 422);
    const body = await res.json();
    // Both citations would be regulatory blocks; the route documents
    // L5 before L6, so the minor citation surfaces first (more
    // actionable: reassign the cook, don't wait on clearance).
    assert.match(body.citation, /YEOA|Hazardous Orders/);
    assert.strictEqual(countSignoffs(), 0);
  });

  it('sick on prohibited station with non-minor → L6 citation', async () => {
    // No minor flag — L5 short-circuit doesn't trigger, L6 does.
    setSickReport({ cook_id: 'cook-adult-sick', action: 'excluded' });
    const res = await POST(postReq({
      shift_date: SHIFT,
      station_id: 'slicer',
      cook_id: 'cook-adult-sick',
    }));
    assert.strictEqual(res.status, 422);
    const body = await res.json();
    assert.match(body.citation, /2-201\.12/);
  });
});
