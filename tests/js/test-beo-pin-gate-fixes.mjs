#!/usr/bin/env node
// Integration test for the temp-PIN scope adoption across BEO + shows routes.
// Specifically guards the bug fix: /api/beo update_line with course_id-only
// patches must accept a temp-PIN scoped 'beo.fire_at_edit' (so a sous chef
// can bind line items to courses via CoursePanel/PrepSheetTable).
//
// Run: node --experimental-strip-types --test tests/js/test-beo-pin-gate-fixes.mjs

import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register(new URL('./resolver.mjs', import.meta.url));

const ORIGINAL_PIN = process.env.LARIAT_PIN;
const ORIGINAL_SECRET = process.env.LARIAT_PIN_SECRET;
process.env.LARIAT_PIN = '4242';
delete process.env.LARIAT_PIN_SECRET; // unsigned cookie path

const db = await import('../../lib/db.ts');
const tempPin = await import('../../lib/tempPin.ts');
const tempPinCookie = await import('../../lib/tempPinCookie.ts');
const beoRoute = await import('../../app/api/beo/route.js');
const prepHistoryRoute = await import('../../app/api/beo/prep-history/route.js');

db.setDbPathForTest(':memory:');
const conn = db.getDb();

after(() => {
  db.setDbPathForTest(null);
  process.env.LARIAT_PIN = ORIGINAL_PIN;
  if (ORIGINAL_SECRET !== undefined) process.env.LARIAT_PIN_SECRET = ORIGINAL_SECRET;
});

beforeEach(() => {
  conn.exec(
    `DELETE FROM beo_line_items;
     DELETE FROM beo_courses;
     DELETE FROM beo_events;
     DELETE FROM temp_pins;
     DELETE FROM audit_events;`,
  );
});

const futureIso = (mins = 60) => new Date(Date.now() + mins * 60_000).toISOString();

async function tempPinCookieHeader(scopes) {
  const id = Number(
    conn
      .prepare(
        `INSERT INTO temp_pins (location_id, pin_hash, label, scopes_json, expires_at)
         VALUES ('default', ?, ?, ?, ?)`,
      )
      .run(tempPin.hashPin('5678'), 'Test', tempPin.serializeScopes(scopes), futureIso())
      .lastInsertRowid,
  );
  const value = await tempPinCookie.signTempPinCookieValue(id, undefined); // legacy unsigned
  return `${tempPinCookie.TEMP_PIN_COOKIE_NAME}=${value}`;
}

function makeReq({ method = 'GET', path = '/', body, cookie } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (cookie) headers.cookie = cookie;
  const init = { method, headers };
  if (body !== undefined) init.body = JSON.stringify(body);
  return new Request(`http://localhost${path}`, init);
}

function seedEventAndLine(courseId = null) {
  const eventId = Number(
    conn.prepare(`INSERT INTO beo_events (title, event_date, location_id) VALUES ('T','2026-05-04','default')`).run().lastInsertRowid,
  );
  const lineId = Number(
    conn.prepare(`INSERT INTO beo_line_items (event_id, item_name, quantity, course_id) VALUES (?,?,?,?)`).run(eventId, 'Brisket', 80, courseId).lastInsertRowid,
  );
  const cId = Number(
    conn.prepare(`INSERT INTO beo_courses (event_id, location_id, course_label, fire_at) VALUES (?,'default','Entree',?)`).run(eventId, futureIso()).lastInsertRowid,
  );
  return { eventId, lineId, courseId: cId };
}

// ── BEO update_line course_id-only ─────────────────────────────────

describe('POST /api/beo update_line — course_id-only patches accept temp PIN', () => {
  it('200 when temp PIN holds beo.fire_at_edit and patch is course_id only', async () => {
    const { lineId, courseId } = seedEventAndLine();
    const cookie = await tempPinCookieHeader(['beo.fire_at_edit']);
    const res = await beoRoute.POST(
      makeReq({
        method: 'POST',
        path: '/api/beo',
        body: { action: 'update_line', id: lineId, course_id: courseId, location_id: 'default' },
        cookie,
      }),
    );
    assert.equal(res.status, 200);
    const row = conn.prepare(`SELECT course_id FROM beo_line_items WHERE id = ?`).get(lineId);
    assert.equal(row.course_id, courseId);
  });

  it('401 when patch includes any other data field (e.g. item_name)', async () => {
    const { lineId, courseId } = seedEventAndLine();
    const cookie = await tempPinCookieHeader(['beo.fire_at_edit']);
    const res = await beoRoute.POST(
      makeReq({
        method: 'POST',
        path: '/api/beo',
        body: {
          action: 'update_line',
          id: lineId,
          course_id: courseId,
          item_name: 'Cheating',          // disallowed under the relaxed gate
          location_id: 'default',
        },
        cookie,
      }),
    );
    assert.equal(res.status, 401);
  });

  it('401 when temp PIN lacks beo.fire_at_edit scope', async () => {
    const { lineId, courseId } = seedEventAndLine();
    const cookie = await tempPinCookieHeader(['menu.prep_history']);
    const res = await beoRoute.POST(
      makeReq({
        method: 'POST',
        path: '/api/beo',
        body: { action: 'update_line', id: lineId, course_id: courseId, location_id: 'default' },
        cookie,
      }),
    );
    assert.equal(res.status, 401);
  });

  it('401 for action=event (different action, master required)', async () => {
    const cookie = await tempPinCookieHeader(['beo.fire_at_edit']);
    const res = await beoRoute.POST(
      makeReq({
        method: 'POST',
        path: '/api/beo',
        body: { action: 'event', title: 'Test', location_id: 'default' },
        cookie,
      }),
    );
    assert.equal(res.status, 401);
  });

  it('200 with master PIN cookie still works for any action', async () => {
    const { lineId, courseId } = seedEventAndLine();
    const res = await beoRoute.POST(
      makeReq({
        method: 'POST',
        path: '/api/beo',
        body: { action: 'update_line', id: lineId, course_id: courseId, item_name: 'Allowed', location_id: 'default' },
        cookie: 'lariat_pin_ok=1',
      }),
    );
    assert.equal(res.status, 200);
  });
});

// ── prep-history accepts menu.prep_history scope ───────────────────

describe('GET /api/beo/prep-history — temp PIN scope adoption', () => {
  it('200 with temp PIN scoped menu.prep_history', async () => {
    const cookie = await tempPinCookieHeader(['menu.prep_history']);
    const res = await prepHistoryRoute.GET(
      makeReq({ method: 'GET', path: '/api/beo/prep-history?item=Brisket', cookie }),
    );
    assert.equal(res.status, 200);
  });

  it('401 with temp PIN of WRONG scope', async () => {
    const cookie = await tempPinCookieHeader(['event.box_office']);
    const res = await prepHistoryRoute.GET(
      makeReq({ method: 'GET', path: '/api/beo/prep-history?item=Brisket', cookie }),
    );
    assert.equal(res.status, 401);
  });

  it('200 with master PIN cookie (no regression)', async () => {
    const res = await prepHistoryRoute.GET(
      makeReq({ method: 'GET', path: '/api/beo/prep-history?item=Brisket', cookie: 'lariat_pin_ok=1' }),
    );
    assert.equal(res.status, 200);
  });
});
