#!/usr/bin/env node
// Integration tests for /api/beo/courses (POST + [id] PATCH/DELETE) and
// the /api/beo update_line course_id extension.
// Run: node --experimental-strip-types --test tests/js/test-beo-courses-api.mjs

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register(new URL('./resolver.mjs', import.meta.url));

const ORIGINAL_PIN = process.env.LARIAT_PIN;
const ORIGINAL_SECRET = process.env.LARIAT_PIN_SECRET;
process.env.LARIAT_PIN = '4242';
delete process.env.LARIAT_PIN_SECRET;

const db = await import('../../lib/db.ts');
const courseRoute = await import('../../app/api/beo/courses/route.js');
const courseIdRoute = await import('../../app/api/beo/courses/[id]/route.js');
const beoRoute = await import('../../app/api/beo/route.js');

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
     DELETE FROM audit_events;`,
  );
});

const PIN_COOKIE = 'lariat_pin_ok=1';
const futureIso = (mins = 60) => new Date(Date.now() + mins * 60_000).toISOString();

function makeReq({ method = 'GET', path = '/', body, withPin = true } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (withPin) headers.cookie = PIN_COOKIE;
  const init = { method, headers };
  if (body !== undefined) init.body = JSON.stringify(body);
  return new Request(`http://localhost${path}`, init);
}

function seedEvent(title = 'Hendricks Wedding') {
  const r = conn
    .prepare(`INSERT INTO beo_events (title, event_date, location_id) VALUES (?, '2026-05-04', 'default')`)
    .run(title);
  return Number(r.lastInsertRowid);
}

function seedLineItem(eventId, item = 'Smoked Brisket', qty = 80) {
  const r = conn
    .prepare(`INSERT INTO beo_line_items (event_id, item_name, quantity) VALUES (?, ?, ?)`)
    .run(eventId, item, qty);
  return Number(r.lastInsertRowid);
}

// ── POST /api/beo/courses ──────────────────────────────────────────

describe('POST /api/beo/courses', () => {
  it('returns 401 without auth', async () => {
    const eventId = seedEvent();
    const res = await courseRoute.POST(
      makeReq({
        method: 'POST',
        path: '/api/beo/courses',
        body: { event_id: eventId, course_label: 'Entree', fire_at: futureIso() },
        withPin: false,
      }),
    );
    assert.equal(res.status, 401);
  });

  it('creates a course, persists, writes audit row', async () => {
    const eventId = seedEvent();
    const fireAt = futureIso();
    const res = await courseRoute.POST(
      makeReq({
        method: 'POST',
        path: '/api/beo/courses',
        body: { event_id: eventId, course_label: 'Entree', fire_at: fireAt, notes: 'no sauce on side' },
      }),
    );
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.ok(json.id > 0);
    assert.equal(json.event_id, eventId);
    assert.equal(json.course_label, 'Entree');
    assert.equal(json.fire_at, fireAt);
    assert.equal(json.sort_order, 0);

    const row = conn.prepare(`SELECT * FROM beo_courses WHERE id = ?`).get(json.id);
    assert.equal(row.course_label, 'Entree');
    assert.equal(row.fire_at, fireAt);
    assert.equal(row.notes, 'no sauce on side');

    const audit = conn
      .prepare(`SELECT entity, action FROM audit_events WHERE entity='beo_course' AND entity_id=?`)
      .get(json.id);
    assert.deepEqual(audit, { entity: 'beo_course', action: 'insert' });
  });

  it('appends sort_order on a second course of the same event', async () => {
    const eventId = seedEvent();
    const fireAt = futureIso();
    await courseRoute.POST(
      makeReq({
        method: 'POST',
        path: '/api/beo/courses',
        body: { event_id: eventId, course_label: 'Amuse', fire_at: fireAt },
      }),
    );
    const res = await courseRoute.POST(
      makeReq({
        method: 'POST',
        path: '/api/beo/courses',
        body: { event_id: eventId, course_label: 'Entree', fire_at: futureIso(120) },
      }),
    );
    const json = await res.json();
    assert.equal(json.sort_order, 10, 'second course should sort 10 above first');
  });

  it('returns 404 for unknown event_id', async () => {
    const res = await courseRoute.POST(
      makeReq({
        method: 'POST',
        path: '/api/beo/courses',
        body: { event_id: 99999, course_label: 'Entree', fire_at: futureIso() },
      }),
    );
    assert.equal(res.status, 404);
  });

  it('rejects non-canonical fire_at with 422', async () => {
    const eventId = seedEvent();
    const res = await courseRoute.POST(
      makeReq({
        method: 'POST',
        path: '/api/beo/courses',
        body: { event_id: eventId, course_label: 'Entree', fire_at: '2026-05-04 19:30' },
      }),
    );
    assert.equal(res.status, 422);
  });
});

// ── PATCH /api/beo/courses/:id ─────────────────────────────────────

describe('PATCH /api/beo/courses/:id', () => {
  async function seedCourse(eventId) {
    const res = await courseRoute.POST(
      makeReq({
        method: 'POST',
        path: '/api/beo/courses',
        body: { event_id: eventId, course_label: 'Entree', fire_at: futureIso() },
      }),
    );
    return res.json();
  }

  it('updates fire_at + writes audit row', async () => {
    const eventId = seedEvent();
    const course = await seedCourse(eventId);
    const newFire = futureIso(120);
    const res = await courseIdRoute.PATCH(
      makeReq({
        method: 'PATCH',
        path: `/api/beo/courses/${course.id}`,
        body: { fire_at: newFire },
      }),
      { params: { id: String(course.id) } },
    );
    assert.equal(res.status, 200);
    const row = conn.prepare(`SELECT fire_at FROM beo_courses WHERE id = ?`).get(course.id);
    assert.equal(row.fire_at, newFire);
    const audit = conn
      .prepare(`SELECT action FROM audit_events WHERE entity='beo_course' AND entity_id=? AND action='update'`)
      .get(course.id);
    assert.ok(audit);
  });

  it('rejects empty course_label with 422', async () => {
    const eventId = seedEvent();
    const course = await seedCourse(eventId);
    const res = await courseIdRoute.PATCH(
      makeReq({
        method: 'PATCH',
        path: `/api/beo/courses/${course.id}`,
        body: { course_label: '   ' },
      }),
      { params: { id: String(course.id) } },
    );
    assert.equal(res.status, 422);
  });

  it('returns 404 for unknown id', async () => {
    const res = await courseIdRoute.PATCH(
      makeReq({
        method: 'PATCH',
        path: `/api/beo/courses/99999`,
        body: { fire_at: futureIso() },
      }),
      { params: { id: '99999' } },
    );
    assert.equal(res.status, 404);
  });
});

// ── DELETE /api/beo/courses/:id ────────────────────────────────────

describe('DELETE /api/beo/courses/:id', () => {
  it('deletes the course, sets line_items.course_id to NULL via FK', async () => {
    const eventId = seedEvent();
    // Enable foreign key enforcement in this test session — better-sqlite3
    // has FKs OFF by default. Production runs with PRAGMA foreign_keys=ON.
    conn.exec('PRAGMA foreign_keys = ON');

    const courseRes = await courseRoute.POST(
      makeReq({
        method: 'POST',
        path: '/api/beo/courses',
        body: { event_id: eventId, course_label: 'Entree', fire_at: futureIso() },
      }),
    );
    const course = await courseRes.json();
    const lineId = seedLineItem(eventId);
    conn.prepare(`UPDATE beo_line_items SET course_id = ? WHERE id = ?`).run(course.id, lineId);

    const res = await courseIdRoute.DELETE(
      makeReq({ method: 'DELETE', path: `/api/beo/courses/${course.id}` }),
      { params: { id: String(course.id) } },
    );
    assert.equal(res.status, 200);

    // Course gone
    const row = conn.prepare(`SELECT id FROM beo_courses WHERE id = ?`).get(course.id);
    assert.equal(row, undefined);

    // Line item still exists, course_id = NULL via ON DELETE SET NULL
    const line = conn.prepare(`SELECT course_id FROM beo_line_items WHERE id = ?`).get(lineId);
    assert.ok(line);
    assert.equal(line.course_id, null);
  });

  it('returns 404 for unknown id', async () => {
    const res = await courseIdRoute.DELETE(
      makeReq({ method: 'DELETE', path: `/api/beo/courses/99999` }),
      { params: { id: '99999' } },
    );
    assert.equal(res.status, 404);
  });
});

// ── update_line accepts course_id ──────────────────────────────────

describe('POST /api/beo update_line — course_id binding', () => {
  it('binds a line item to a course', async () => {
    const eventId = seedEvent();
    const lineId = seedLineItem(eventId);
    const courseRes = await courseRoute.POST(
      makeReq({
        method: 'POST',
        path: '/api/beo/courses',
        body: { event_id: eventId, course_label: 'Entree', fire_at: futureIso() },
      }),
    );
    const course = await courseRes.json();

    const res = await beoRoute.POST(
      makeReq({
        method: 'POST',
        path: '/api/beo',
        body: { action: 'update_line', id: lineId, course_id: course.id, location_id: 'default' },
      }),
    );
    assert.equal(res.status, 200);
    const row = conn.prepare(`SELECT course_id FROM beo_line_items WHERE id = ?`).get(lineId);
    assert.equal(row.course_id, course.id);
  });

  it('clears the binding when course_id is explicit null', async () => {
    const eventId = seedEvent();
    const courseRes = await courseRoute.POST(
      makeReq({
        method: 'POST',
        path: '/api/beo/courses',
        body: { event_id: eventId, course_label: 'Entree', fire_at: futureIso() },
      }),
    );
    const course = await courseRes.json();
    const lineId = seedLineItem(eventId);
    conn.prepare(`UPDATE beo_line_items SET course_id = ? WHERE id = ?`).run(course.id, lineId);

    const res = await beoRoute.POST(
      makeReq({
        method: 'POST',
        path: '/api/beo',
        body: { action: 'update_line', id: lineId, course_id: null, location_id: 'default' },
      }),
    );
    assert.equal(res.status, 200);
    const row = conn.prepare(`SELECT course_id FROM beo_line_items WHERE id = ?`).get(lineId);
    assert.equal(row.course_id, null);
  });

  it('leaves course_id alone when key is absent from body', async () => {
    const eventId = seedEvent();
    const courseRes = await courseRoute.POST(
      makeReq({
        method: 'POST',
        path: '/api/beo/courses',
        body: { event_id: eventId, course_label: 'Entree', fire_at: futureIso() },
      }),
    );
    const course = await courseRes.json();
    const lineId = seedLineItem(eventId);
    conn.prepare(`UPDATE beo_line_items SET course_id = ? WHERE id = ?`).run(course.id, lineId);

    const res = await beoRoute.POST(
      makeReq({
        method: 'POST',
        path: '/api/beo',
        body: { action: 'update_line', id: lineId, item_name: 'Renamed', location_id: 'default' },
      }),
    );
    assert.equal(res.status, 200);
    const row = conn.prepare(`SELECT course_id, item_name FROM beo_line_items WHERE id = ?`).get(lineId);
    assert.equal(row.course_id, course.id, 'course binding should be preserved when key not in body');
    assert.equal(row.item_name, 'Renamed');
  });

  it('rejects malformed course_id with 422', async () => {
    const eventId = seedEvent();
    const lineId = seedLineItem(eventId);
    const res = await beoRoute.POST(
      makeReq({
        method: 'POST',
        path: '/api/beo',
        body: { action: 'update_line', id: lineId, course_id: 'not a number', location_id: 'default' },
      }),
    );
    assert.equal(res.status, 422);
  });
});
