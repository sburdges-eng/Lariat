#!/usr/bin/env node
// Gold stars — PIN-gated awarding, daily board reset, permanent
// per-employee leaderboard (operator direction, 2026-06-12):
//   - POST requires the manager PIN (board GET stays open for cooks)
//   - GET /api/gold-stars (the board) shows TODAY's stars only
//   - GET ?view=leaderboard is the all-time per-employee record that
//     survives the daily reset
// Run: node --experimental-strip-types --test tests/js/test-gold-stars-api.mjs

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

register(new URL('./resolver.mjs', import.meta.url));

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-gold-stars-'));
const TMP_DB = path.join(TMP_DIR, 'test.db');

// Force the PIN gate ON; with LARIAT_PIN_SECRET unset the legacy
// unsigned 'lariat_pin_ok=1' cookie is accepted by hasPinCookie.
const SAVED_PIN = process.env.LARIAT_PIN;
const SAVED_PIN_SECRET = process.env.LARIAT_PIN_SECRET;
process.env.LARIAT_PIN = '0000';
delete process.env.LARIAT_PIN_SECRET;

const db = await import('../../lib/db.ts');
const route = await import('../../app/api/gold-stars/route.ts');

db.setDbPathForTest(TMP_DB);
const testDb = db.getDb();
const { GET, POST } = route;

after(() => {
  db.setDbPathForTest(null);
  if (SAVED_PIN === undefined) delete process.env.LARIAT_PIN;
  else process.env.LARIAT_PIN = SAVED_PIN;
  if (SAVED_PIN_SECRET !== undefined) process.env.LARIAT_PIN_SECRET = SAVED_PIN_SECRET;
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

beforeEach(() => {
  testDb.exec('DELETE FROM gold_stars; DELETE FROM audit_events;');
});

function postReq(body, { pin = true } = {}) {
  return new Request('http://localhost/api/gold-stars', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(pin ? { cookie: 'lariat_pin_ok=1' } : {}),
    },
    body: JSON.stringify(body),
  });
}

function getReq(qs = '') {
  return new Request(`http://localhost/api/gold-stars${qs}`);
}

/** Insert a star dated `daysAgo` local days back (0 = today). */
function seedStar(cook, stars, daysAgo) {
  testDb
    .prepare(
      `INSERT INTO gold_stars (cook_name, reason, stars, location_id, awarded_date, created_at)
       VALUES (?, 'seed', ?, 'default',
               date('now', 'localtime', ?),
               datetime('now', 'localtime', ?))`,
    )
    .run(cook, stars, `-${daysAgo} days`, `-${daysAgo} days`);
}

describe('POST /api/gold-stars — manager PIN gate', () => {
  it('rejects an un-PIN’d award and writes nothing', async () => {
    const res = await POST(postReq({ cook_name: 'Alex', reason: 'rush', stars: 2 }, { pin: false }));
    assert.equal(res.status, 401);
    assert.equal(testDb.prepare('SELECT COUNT(*) c FROM gold_stars').get().c, 0);
  });

  it('accepts a PIN’d award and posts the audit row', async () => {
    const res = await POST(postReq({ cook_name: 'Alex', reason: 'rush', stars: 2 }));
    assert.equal(res.status, 200);
    assert.equal(testDb.prepare('SELECT COUNT(*) c FROM gold_stars').get().c, 1);
    const audit = testDb
      .prepare("SELECT COUNT(*) c FROM audit_events WHERE entity = 'gold_stars'")
      .get().c;
    assert.equal(audit, 1);
  });
});

describe('GET /api/gold-stars — daily board reset', () => {
  it('shows today’s stars and hides yesterday’s', async () => {
    seedStar('Alex', 2, 0);
    seedStar('Blair', 3, 1);
    seedStar('Casey', 1, 7);

    const rows = await (await GET(getReq())).json();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].cook_name, 'Alex');
  });

  it('excludes soft-deleted rows from the board', async () => {
    seedStar('Alex', 2, 0);
    testDb.exec("UPDATE gold_stars SET deleted_at = datetime('now')");
    const rows = await (await GET(getReq())).json();
    assert.equal(rows.length, 0);
  });
});

describe('GET ?view=leaderboard — permanent per-employee record', () => {
  it('aggregates all-time per cook, surviving the daily reset', async () => {
    seedStar('Alex', 2, 0);   // today
    seedStar('Alex', 1, 30);  // a month ago
    seedStar('Blair', 3, 1);  // yesterday

    const rows = await (await GET(getReq('?view=leaderboard'))).json();
    assert.equal(rows.length, 2);
    assert.deepEqual(
      rows.map((r) => [r.cook_name, r.total_stars, r.awards]),
      [['Alex', 3, 2], ['Blair', 3, 1]], // tie broken by name ASC
    );
    assert.ok(rows[0].last_awarded, 'leaderboard carries the last award date');
  });

  it('soft-deleted stars leave the record too', async () => {
    seedStar('Alex', 2, 5);
    testDb.exec("UPDATE gold_stars SET deleted_at = datetime('now')");
    const rows = await (await GET(getReq('?view=leaderboard'))).json();
    assert.equal(rows.length, 0);
  });
});
