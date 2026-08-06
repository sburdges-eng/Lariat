#!/usr/bin/env node
// Service-date migration — the two properties every migrated surface must hold.
//
// 1. CORRECTNESS. A row written at 23:30 local carries the service date of the
//    day that began that morning. This is the assertion that fails on the old
//    todayISO() code.
//
// 2. SYMMETRY, within a service day. The write default and the read default must
//    stay the same function. Note that symmetry ALONE proves nothing: under
//    todayISO() both sides were wrong together, which is precisely why the bug
//    survived — a cook saw their own records and nothing looked broken. Symmetry
//    is a property to preserve, not evidence of correctness.
//
// A static guard then covers every surface in the wave, because a future edit
// that moves one side back is the failure this migration is most exposed to.
//
// Run: node --experimental-strip-types --test tests/js/test-service-date-symmetry.mjs

import { describe, it, after, beforeEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

register(new URL('./resolver.mjs', import.meta.url));

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-service-date-symmetry-'));
const TMP_DB = path.join(TMP_DIR, 'lariat-test.db');

const db = await import('../../lib/db.ts');
const cooling = await import('../../app/api/cooling/route.js');

db.setDbPathForTest(TMP_DB);
const testDb = db.getDb();

after(() => {
  db.setDbPathForTest(null);
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

beforeEach(() => {
  testDb.exec('DELETE FROM sync_feed; DELETE FROM cooling_log; DELETE FROM audit_events;');
});

// 6 Aug 23:30 MDT — mid close-down. UTC already says the 7th.
const AT_2330 = new Date('2026-08-07T05:30:00Z');
// 7 Aug 01:30 MDT — same service day, two hours later.
const AT_0130 = new Date('2026-08-07T07:30:00Z');
// 7 Aug 02:30 MDT — the NEXT service day.
const AT_0230 = new Date('2026-08-07T08:30:00Z');

function at(when, fn) {
  mock.timers.enable({ apis: ['Date'], now: when });
  try { return fn(); } finally { mock.timers.reset(); }
}

function postCooling() {
  return cooling.POST(new Request('http://localhost/api/cooling', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      item: 'pulled pork',
      started_at: '2026-08-07T05:30:00.000Z',
      start_reading_f: 165,
      cook_id: 'alice',
    }),
  }));
}

/** GET with no ?date, so the route's read default decides which day it shows. */
function getCoolingDefault() {
  return cooling.GET(new Request('http://localhost/api/cooling'));
}

describe('cooling — the service date it stores', () => {
  it('stamps the service day that began that morning, not the UTC day', async () => {
    await at(AT_2330, () => postCooling());
    const row = testDb.prepare('SELECT shift_date FROM cooling_log LIMIT 1').get();
    assert.equal(
      row.shift_date, '2026-08-06',
      'a 23:30 write belongs to the service day that opened that morning',
    );
    // Guard the assertion itself: UTC really does disagree here, so this test
    // cannot pass by the two happening to coincide.
    assert.equal(AT_2330.toISOString().slice(0, 10), '2026-08-07');
  });
});

describe('cooling — the service date it reads', () => {
  // The route echoes the date it resolved, so the read default is observable
  // without having to close a batch first.
  it('resolves the same service day at 23:30 and at 01:30', async () => {
    const late = await (await at(AT_2330, () => getCoolingDefault())).json();
    const small = await (await at(AT_0130, () => getCoolingDefault())).json();
    assert.equal(late.date, '2026-08-06');
    assert.equal(small.date, '2026-08-06', 'past midnight is still the same service day');
  });

  it('rolls to the next service day at 02:00, matching the write side', async () => {
    const after = await (await at(AT_0230, () => getCoolingDefault())).json();
    assert.equal(after.date, '2026-08-07');
  });
});

describe('cooling — an in-progress batch is never date-filtered', () => {
  // Deliberate, and worth pinning while touching this route: a cooling batch's
  // stage-2 deadline is four hours past stage 1, so it routinely lives across
  // 02:00. The open list is filtered by status and location only. If the
  // service-date boundary ever started gating it, a cook would lose a live
  // HACCP obligation off their board at 2am.
  it('stays on the board after the service day rolls over', async () => {
    await at(AT_2330, () => postCooling());
    const res = await at(AT_0230, () => getCoolingDefault());
    const body = await res.json();
    assert.ok(
      body.open.some((r) => r.item === 'pulled pork'),
      'an unfinished cooling batch must survive the service-day boundary',
    );
  });
});

describe('every migrated surface keeps both sides on the same clock', () => {
  // The migration's central hazard: move a route's write default and leave its
  // read default (or its page) behind, and a cook's own entries vanish from
  // their screen mid-shift. A file holding both functions at once is that bug.
  const WAVE_1 = [
    'app/api/breaks/route.js', 'app/labor/breaks/page.jsx',
    'app/api/cleaning/route.ts', 'app/food-safety/cleaning/page.jsx',
    'app/api/cooling/route.js', 'app/food-safety/cooling/page.jsx',
    'app/api/eighty-six/route.ts', 'app/eighty-six/page.jsx',
    'app/api/receiving/route.js', 'app/food-safety/receiving/page.jsx',
    'app/api/sanitizer/route.ts', 'app/food-safety/sanitizer/page.jsx',
    'app/api/tip-pool/route.js', 'app/labor/tip-pool/page.jsx',
  ];

  it('no migrated file still calls todayISO()', () => {
    const stragglers = WAVE_1.filter((f) => fs.readFileSync(f, 'utf8').includes('todayISO'));
    assert.deepEqual(stragglers, [], 'these were migrated but still reference todayISO');
  });

  it('every migrated file actually uses serviceDate()', () => {
    const missing = WAVE_1.filter((f) => !fs.readFileSync(f, 'utf8').includes('serviceDate'));
    assert.deepEqual(missing, [], 'these are listed as migrated but never call serviceDate');
  });
});
