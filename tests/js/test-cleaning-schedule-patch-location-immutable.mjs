#!/usr/bin/env node
// Security regression: cleaning_schedule.location_id must be immutable
// across PATCH. The route is not PIN-gated, so accepting body.location_id
// on PATCH would let any LAN client move a row into another site's UI
// (cross-tenant leak + data poisoning).
//
// Contract pinned here:
//   - PATCH silently ignores body.location_id (no error, no move).
//   - PATCH with ONLY {id, location_id} returns 400 "no editable fields supplied".
//   - POST still honors body.location_id (initial creation IS the right
//     place to set location).
//   - GET ?location=other-site does not surface a row whose location was
//     attempted-but-blocked from being changed.
//
// Audit: docs/audit/2026-05-08-codebase-audit.md §1, Tier-1 HIGH #4.
//
// Run: node --test tests/js/test-cleaning-schedule-patch-location-immutable.mjs

import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

register(new URL('./resolver.mjs', import.meta.url));

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-cleansched-loc-'));
const TMP_DB = path.join(TMP_DIR, 'lariat-test.db');

const db = await import('../../lib/db.ts');
db.setDbPathForTest(TMP_DB);
const testDb = db.getDb();

const route = await import('../../app/api/cleaning-schedule/route.js');

after(() => {
  db.setDbPathForTest(null);
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

beforeEach(() => {
  testDb.exec(`DELETE FROM cleaning_schedule;`);
});

function jsonReq(method, url, body) {
  return new Request(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function getReq(url) {
  return new Request(url, { method: 'GET' });
}

async function postRow(payload) {
  const res = await route.POST(
    jsonReq('POST', 'http://localhost/api/cleaning-schedule', payload),
  );
  assert.strictEqual(res.status, 200, `POST expected 200, got ${res.status}`);
  const j = await res.json();
  return j.row;
}

function selectById(id) {
  return testDb.prepare('SELECT * FROM cleaning_schedule WHERE id = ?').get(id);
}

const base = (over = {}) => ({
  area: 'Line',
  task: 'Deep clean flat-top',
  frequency: 'weekly',
  ...over,
});

describe('PATCH /api/cleaning-schedule — location_id is immutable', () => {
  it('silently ignores body.location_id while updating other fields', async () => {
    const row = await postRow(base({ location_id: 'site-a', task: 'updated task before' }));
    assert.strictEqual(row.location_id, 'site-a');

    const res = await route.PATCH(jsonReq(
      'PATCH', 'http://localhost/api/cleaning-schedule', {
        id: row.id,
        location_id: 'other-site',
        task: 'updated task',
      },
    ));
    assert.strictEqual(res.status, 200, `PATCH expected 200, got ${res.status}`);
    const j = await res.json();

    // The valid editable field went through.
    assert.strictEqual(j.row.task, 'updated task');
    // The location_id stays identity — the malicious field was dropped silently.
    assert.strictEqual(
      j.row.location_id,
      'site-a',
      'location_id must not be mutated by PATCH',
    );

    // DB confirms.
    const raw = selectById(row.id);
    assert.strictEqual(raw.location_id, 'site-a');
    assert.strictEqual(raw.task, 'updated task');
  });

  it('returns 400 when body has ONLY {id, location_id} (no editable fields supplied)', async () => {
    const row = await postRow(base({ location_id: 'site-a' }));

    const res = await route.PATCH(jsonReq(
      'PATCH', 'http://localhost/api/cleaning-schedule', {
        id: row.id,
        location_id: 'other-site',
      },
    ));
    assert.strictEqual(res.status, 400);
    const j = await res.json();
    assert.match(
      String(j.error || ''),
      /no editable fields supplied/,
      'error message must reflect that location_id is not editable',
    );

    // Row untouched.
    const raw = selectById(row.id);
    assert.strictEqual(raw.location_id, 'site-a');
  });

  it('POST still honors body.location_id (creation is the right place to set location)', async () => {
    const row = await postRow(base({ location_id: 'site-b' }));
    assert.strictEqual(row.location_id, 'site-b');

    // Confirm in DB too.
    const raw = selectById(row.id);
    assert.strictEqual(raw.location_id, 'site-b');
  });

  it('GET ?location=other-site does NOT surface a row whose PATCH-attempt to move was blocked', async () => {
    const row = await postRow(base({ location_id: 'site-a', task: 'sweep' }));

    // Attacker attempts to relocate the row to site-b via PATCH.
    await route.PATCH(jsonReq(
      'PATCH', 'http://localhost/api/cleaning-schedule', {
        id: row.id,
        location_id: 'site-b',
        notes: 'attacker note',
      },
    ));

    // GET on site-b must not surface the row.
    const resB = await route.GET(getReq(
      'http://localhost/api/cleaning-schedule?location=site-b',
    ));
    const jB = await resB.json();
    assert.ok(
      !jB.rows.some((r) => r.id === row.id),
      'row must not appear under site-b after PATCH attempt',
    );

    // GET on the original site still surfaces it.
    const resA = await route.GET(getReq(
      'http://localhost/api/cleaning-schedule?location=site-a',
    ));
    const jA = await resA.json();
    assert.ok(
      jA.rows.some((r) => r.id === row.id),
      'row must still appear under its original location',
    );
  });
});
