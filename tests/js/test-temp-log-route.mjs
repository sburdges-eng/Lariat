#!/usr/bin/env node
// Integration tests for /api/temp-log + /api/temp-log/points.
//
// These tests import the App Router handlers directly, build `Request`
// objects, and assert on the `Response`. No live server is started —
// we exercise the route module in-process. Routes use extensionless
// relative imports (Next.js convention), so we register a resolve hook
// first that adds `.ts`/`.js` back on for Node.
//
// The database path is swapped to a temp SQLite file via
// `setDbPathForTest` so these tests don't write into `data/lariat.db`.
// We call it BEFORE loading the route module — once the route captures
// the `getDb` binding it still goes through the module instance we
// configured, since lib/db.ts caches a single connection.

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// ── Resolver + env setup ──────────────────────────────────────────
// Register the extension-adding loader BEFORE any dynamic imports
// below touch the route or lib modules. Using `new URL(...,
// import.meta.url)` makes this cwd-independent — the test works when
// run from anywhere, not just the repo root.
register(new URL('./resolver.mjs', import.meta.url));

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-temp-log-'));
const TMP_DB = path.join(TMP_DIR, 'lariat-test.db');

// PIN must be configured for the gate tests to exercise anything
// (middleware disables the gate when LARIAT_PIN is unset, and the route
// mirrors that logic).
const ORIGINAL_PIN = process.env.LARIAT_PIN;
process.env.LARIAT_PIN = '4242';

// Dynamic imports so the resolver hook is active when they load.
const db = await import('../../lib/db.ts');
const tempLog = await import('../../lib/tempLog.ts');
const route = await import('../../app/api/temp-log/route.js');
const pointsRoute = await import('../../app/api/temp-log/points/route.js');

db.setDbPathForTest(TMP_DB);
// Trigger schema creation before any test touches it.
const testDb = db.getDb();

const { POST, GET } = route;
const { GET: GET_POINTS } = pointsRoute;
const { todayISO } = db;

after(() => {
  db.setDbPathForTest(null);
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
  if (ORIGINAL_PIN === undefined) delete process.env.LARIAT_PIN;
  else process.env.LARIAT_PIN = ORIGINAL_PIN;
});

beforeEach(() => {
  testDb.exec('DELETE FROM temp_log');
});

// ── Request helpers ───────────────────────────────────────────────

function postReq(body, { cookie } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (cookie) headers.cookie = cookie;
  return new Request('http://localhost/api/temp-log', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

function getReq(qs = '') {
  return new Request(`http://localhost/api/temp-log${qs}`);
}

function countRows() {
  return testDb.prepare('SELECT COUNT(*) AS c FROM temp_log').get().c;
}

// ── POST — happy paths ────────────────────────────────────────────

describe('POST /api/temp-log — happy path', () => {
  it('in-range reading returns 200 with classification ok and the inserted row', async () => {
    const res = await POST(postReq({
      shift_date: todayISO(),
      point_id: 'walk_in_cooler',
      reading_f: 38,
      cook_id: 'alice',
    }));
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.ok, true);
    assert.strictEqual(body.classification, 'ok');
    assert.ok(typeof body.id === 'number' || typeof body.id === 'bigint');
    assert.ok(body.entry, 'response must include the inserted row');
    assert.strictEqual(body.entry.point_id, 'walk_in_cooler');
    assert.strictEqual(body.entry.reading_f, 38);
    assert.strictEqual(body.entry.point_label, 'Walk-in cooler');
    assert.strictEqual(body.entry.required_max_f, 41);
    assert.strictEqual(body.entry.required_min_f, null);
    assert.ok(body.entry.created_at, 'created_at must be set');
    assert.strictEqual(countRows(), 1);
  });

  it('out-of-range reading WITH corrective action returns 200, classification out_of_range, row stored', async () => {
    const res = await POST(postReq({
      shift_date: todayISO(),
      point_id: 'walk_in_cooler',
      reading_f: 44,
      corrective_action: 'moved product to reach-in and called tech',
      cook_id: 'alice',
    }));
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.classification, 'out_of_range');
    assert.strictEqual(body.entry.corrective_action, 'moved product to reach-in and called tech');
    assert.strictEqual(countRows(), 1);
  });

  it('reading_f of exactly 0 is NOT treated as missing (freezer at 0°F)', async () => {
    // Guard must not use falsiness — 0 is a legal freezer reading.
    const res = await POST(postReq({
      shift_date: todayISO(),
      point_id: 'freezer',
      reading_f: 0,
    }));
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.classification, 'ok');
    assert.strictEqual(body.entry.reading_f, 0);
  });

  it('rejects corrective_action over 500 chars with 400 and the length', async () => {
    const long = 'x'.repeat(800);
    const res = await POST(postReq({
      shift_date: todayISO(),
      point_id: 'walk_in_cooler',
      reading_f: 44,
      corrective_action: long,
    }));
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /corrective action too long/i);
    assert.strictEqual(body.length, 800);
    assert.strictEqual(countRows(), 0);
  });
});

// ── POST — out-of-range without note ──────────────────────────────

describe('POST /api/temp-log — out-of-range without note', () => {
  it('returns 422 with needs_corrective_action flag and inserts NO row', async () => {
    const res = await POST(postReq({
      shift_date: todayISO(),
      point_id: 'walk_in_cooler',
      reading_f: 44,
    }));
    assert.strictEqual(res.status, 422);
    const body = await res.json();
    assert.strictEqual(body.needs_corrective_action, true);
    assert.match(body.error, /walk-in cooler/i);
    assert.match(body.error, /note on the fix/i);
    assert.strictEqual(countRows(), 0);
  });

  it('whitespace-only corrective_action is treated as absent → 422', async () => {
    const res = await POST(postReq({
      shift_date: todayISO(),
      point_id: 'walk_in_cooler',
      reading_f: 44,
      corrective_action: '    ',
    }));
    assert.strictEqual(res.status, 422);
    assert.strictEqual(countRows(), 0);
  });
});

// ── POST — bad input → 400 ────────────────────────────────────────

describe('POST /api/temp-log — bad input is 400, not 422', () => {
  it('reading_f of null (JSON round-trip of NaN) → 400, not 500', async () => {
    // JSON.stringify({r: NaN}) produces '{"r":null}', so a NaN travelling
    // through JSON arrives as null on the server. That must be a clean 400,
    // not a 500 from a parse failure and not a 422 pretending the reading
    // was a compliance miss.
    const req = new Request('http://localhost/api/temp-log', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        shift_date: todayISO(),
        point_id: 'walk_in_cooler',
        reading_f: NaN,
      }),
    });
    const res = await POST(req);
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /reading_f is required/i);
    assert.strictEqual(countRows(), 0);
  });

  it('reading_f as string "42" is bad input → 400', async () => {
    const res = await POST(postReq({
      shift_date: todayISO(),
      point_id: 'walk_in_cooler',
      reading_f: '42',
    }));
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /number/i);
    assert.notStrictEqual(body.needs_corrective_action, true);
    assert.strictEqual(countRows(), 0);
  });

  it('reading_f of 600 is off the charts → 400', async () => {
    const res = await POST(postReq({
      shift_date: todayISO(),
      point_id: 'cook_poultry',
      reading_f: 600,
      corrective_action: 'does not matter',
    }));
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /probe|off the charts/i);
    assert.strictEqual(countRows(), 0);
  });

  it('reading_f undefined → 400 with "reading_f is required"', async () => {
    const res = await POST(postReq({
      shift_date: todayISO(),
      point_id: 'walk_in_cooler',
    }));
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /reading_f is required/i);
    assert.strictEqual(countRows(), 0);
  });
});

// ── POST — missing fields ─────────────────────────────────────────

describe('POST /api/temp-log — missing fields', () => {
  it('missing shift_date → 400', async () => {
    const res = await POST(postReq({
      point_id: 'walk_in_cooler',
      reading_f: 38,
    }));
    assert.strictEqual(res.status, 400);
    assert.match((await res.json()).error, /missing fields/i);
    assert.strictEqual(countRows(), 0);
  });

  it('missing point_id → 400', async () => {
    const res = await POST(postReq({
      shift_date: todayISO(),
      reading_f: 38,
    }));
    assert.strictEqual(res.status, 400);
    assert.match((await res.json()).error, /missing fields/i);
    assert.strictEqual(countRows(), 0);
  });

  it('whitespace-only shift_date → 400', async () => {
    const res = await POST(postReq({
      shift_date: '   ',
      point_id: 'walk_in_cooler',
      reading_f: 38,
    }));
    assert.strictEqual(res.status, 400);
    assert.strictEqual(countRows(), 0);
  });
});

// ── POST — unknown point_id ───────────────────────────────────────

describe('POST /api/temp-log — unknown point', () => {
  it('unknown point_id → 400 and the offending id in the error body', async () => {
    const res = await POST(postReq({
      shift_date: todayISO(),
      point_id: 'not_a_real_point',
      reading_f: 38,
    }));
    assert.strictEqual(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /unknown temp point/i);
    assert.strictEqual(body.point_id, 'not_a_real_point');
    assert.strictEqual(countRows(), 0);
  });
});

// ── POST — PIN gate on past dates ─────────────────────────────────

describe('POST /api/temp-log — PIN gate for past-dated writes', () => {
  const yesterday = () => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
  };

  it('past shift_date WITHOUT PIN cookie → 403', async () => {
    const res = await POST(postReq({
      shift_date: yesterday(),
      point_id: 'walk_in_cooler',
      reading_f: 38,
    }));
    assert.strictEqual(res.status, 403);
    const body = await res.json();
    assert.match(body.error, /pin/i);
    assert.strictEqual(countRows(), 0);
  });

  it('past shift_date WITH PIN cookie → 200', async () => {
    const res = await POST(postReq(
      {
        shift_date: yesterday(),
        point_id: 'walk_in_cooler',
        reading_f: 38,
      },
      { cookie: 'lariat_pin_ok=1' },
    ));
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.ok, true);
    assert.strictEqual(countRows(), 1);
  });

  it('today with no PIN cookie is fine (cooks shouldn\'t have to log in)', async () => {
    const res = await POST(postReq({
      shift_date: todayISO(),
      point_id: 'walk_in_cooler',
      reading_f: 38,
    }));
    assert.strictEqual(res.status, 200);
    assert.strictEqual(countRows(), 1);
  });

  it('past shift_date WITH temp PIN scoped haccp.back_date → 200', async () => {
    const tempPin = await import('../../lib/tempPin.ts');
    const tempPinCookie = await import('../../lib/tempPinCookie.ts');
    const future = new Date(Date.now() + 60 * 60_000).toISOString();
    const id = Number(
      db.getDb()
        .prepare(
          `INSERT INTO temp_pins (location_id, pin_hash, label, scopes_json, expires_at)
           VALUES ('default', ?, ?, ?, ?)`,
        )
        .run(tempPin.hashPin('5678'), 'PIC delegate', tempPin.serializeScopes(['haccp.back_date']), future)
        .lastInsertRowid,
    );
    const value = await tempPinCookie.signTempPinCookieValue(id, undefined);
    const res = await POST(postReq(
      { shift_date: yesterday(), point_id: 'walk_in_cooler', reading_f: 38 },
      { cookie: `${tempPinCookie.TEMP_PIN_COOKIE_NAME}=${value}` },
    ));
    assert.strictEqual(res.status, 200);
    assert.strictEqual(countRows(), 1);
  });

  it('past shift_date WITH temp PIN of WRONG scope → 403', async () => {
    const tempPin = await import('../../lib/tempPin.ts');
    const tempPinCookie = await import('../../lib/tempPinCookie.ts');
    const future = new Date(Date.now() + 60 * 60_000).toISOString();
    const id = Number(
      db.getDb()
        .prepare(
          `INSERT INTO temp_pins (location_id, pin_hash, label, scopes_json, expires_at)
           VALUES ('default', ?, ?, ?, ?)`,
        )
        .run(tempPin.hashPin('9999'), 'Wrong scope', tempPin.serializeScopes(['menu.specials_edit']), future)
        .lastInsertRowid,
    );
    const value = await tempPinCookie.signTempPinCookieValue(id, undefined);
    const res = await POST(postReq(
      { shift_date: yesterday(), point_id: 'walk_in_cooler', reading_f: 38 },
      { cookie: `${tempPinCookie.TEMP_PIN_COOKIE_NAME}=${value}` },
    ));
    assert.strictEqual(res.status, 403);
    assert.strictEqual(countRows(), 0);
  });

  it('PIN cookie with wrong value does not open the gate', async () => {
    // Only value '1' counts. Anything else is still gated.
    const res = await POST(postReq(
      {
        shift_date: yesterday(),
        point_id: 'walk_in_cooler',
        reading_f: 38,
      },
      { cookie: 'lariat_pin_ok=0; other_cookie=x' },
    ));
    assert.strictEqual(res.status, 403);
    assert.strictEqual(countRows(), 0);
  });
});

// ── GET — listing ─────────────────────────────────────────────────

describe('GET /api/temp-log', () => {
  beforeEach(async () => {
    // Seed three entries today at different points. We want a stable
    // order assertion, and sqlite's `datetime('now')` has 1-second
    // resolution — using the `id DESC` tiebreaker in the route query
    // is what makes the ordering deterministic here.
    await POST(postReq({ shift_date: todayISO(), point_id: 'walk_in_cooler', reading_f: 38, cook_id: 'a' }));
    await POST(postReq({ shift_date: todayISO(), point_id: 'cook_poultry', reading_f: 170, cook_id: 'b' }));
    await POST(postReq({ shift_date: todayISO(), point_id: 'walk_in_cooler', reading_f: 39, cook_id: 'c' }));
  });

  it('returns today\'s entries for default location, newest first', async () => {
    const res = await GET(getReq());
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.date, todayISO());
    assert.strictEqual(body.location_id, 'default');
    assert.strictEqual(body.entries.length, 3);
    // Newest first — the 3rd insert (reading_f=39, cook_id=c) should be index 0.
    assert.strictEqual(body.entries[0].cook_id, 'c');
    assert.strictEqual(body.entries[2].cook_id, 'a');
  });

  it('includes point_label from the live registry', async () => {
    const res = await GET(getReq());
    const body = await res.json();
    for (const e of body.entries) {
      if (e.point_id === 'walk_in_cooler') assert.strictEqual(e.point_label, 'Walk-in cooler');
      if (e.point_id === 'cook_poultry') assert.strictEqual(e.point_label, 'Cook — poultry');
    }
  });

  it('point_label is null when the point was retired from the registry', async () => {
    // Simulate by inserting a row with an id that isn't in TempPoints.
    testDb.prepare(`
      INSERT INTO temp_log (shift_date, location_id, point_id, reading_f, required_min_f, required_max_f, corrective_action, cook_id)
      VALUES (?, 'default', 'retired_point', 33, NULL, 41, NULL, 'd')
    `).run(todayISO());
    const res = await GET(getReq('?point_id=retired_point'));
    const body = await res.json();
    assert.strictEqual(body.entries.length, 1);
    assert.strictEqual(body.entries[0].point_label, null);
  });

  it('filters by point_id', async () => {
    const res = await GET(getReq('?point_id=walk_in_cooler'));
    const body = await res.json();
    assert.strictEqual(body.entries.length, 2);
    for (const e of body.entries) assert.strictEqual(e.point_id, 'walk_in_cooler');
  });

  it('explicit date narrows the result set', async () => {
    // Use PIN cookie to post to yesterday.
    const yd = (() => {
      const d = new Date(); d.setUTCDate(d.getUTCDate() - 1);
      return d.toISOString().slice(0, 10);
    })();
    await POST(postReq(
      { shift_date: yd, point_id: 'hot_hold', reading_f: 150 },
      { cookie: 'lariat_pin_ok=1' },
    ));
    const res = await GET(getReq(`?date=${yd}`));
    const body = await res.json();
    assert.strictEqual(body.date, yd);
    assert.strictEqual(body.entries.length, 1);
    assert.strictEqual(body.entries[0].point_id, 'hot_hold');
  });

  it('honors the location query param', async () => {
    // Insert an entry at a non-default location.
    await POST(postReq({
      shift_date: todayISO(),
      point_id: 'freezer',
      reading_f: -10,
      location_id: 'downtown',
    }));
    const res = await GET(getReq('?location=downtown'));
    const body = await res.json();
    assert.strictEqual(body.location_id, 'downtown');
    assert.strictEqual(body.entries.length, 1);
    assert.strictEqual(body.entries[0].location_id, 'downtown');
    assert.strictEqual(body.entries[0].point_id, 'freezer');
  });
});

// ── GET /api/temp-log/points ──────────────────────────────────────

describe('GET /api/temp-log/points', () => {
  it('returns the static TempPoints registry', async () => {
    const res = await GET_POINTS(new Request('http://localhost/api/temp-log/points'));
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.points));
    assert.strictEqual(body.points.length, tempLog.TempPoints.length);
    const ids = body.points.map((p) => p.id);
    assert.ok(ids.includes('walk_in_cooler'));
    assert.ok(ids.includes('cook_poultry'));
    for (const p of body.points) {
      assert.ok(p.id && p.label && p.ccp_id, `point missing fields: ${JSON.stringify(p)}`);
    }
  });
});
