#!/usr/bin/env node
// Integration test for GET /api/beo/fire-schedule (T7).
// Run: node --experimental-strip-types --test tests/js/test-beo-fire-schedule-api.mjs

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register(new URL('./resolver.mjs', import.meta.url));

const db = await import('../../lib/db.ts');
const route = await import('../../app/api/beo/fire-schedule/route.js');

db.setDbPathForTest(':memory:');
const conn = db.getDb();

after(() => db.setDbPathForTest(null));

beforeEach(() => {
  conn.exec(
    `DELETE FROM beo_line_items;
     DELETE FROM beo_courses;
     DELETE FROM beo_events;`,
  );
});

function makeReq(qs = '') {
  return new Request(`http://localhost/api/beo/fire-schedule${qs}`);
}

function seedEvent({ title, date, location = 'default' }) {
  const r = conn
    .prepare(`INSERT INTO beo_events (title, event_date, location_id) VALUES (?, ?, ?)`)
    .run(title, date, location);
  return Number(r.lastInsertRowid);
}

function seedCourse({ event_id, label, fire_at, station, location = 'default' }) {
  const r = conn
    .prepare(
      `INSERT INTO beo_courses (event_id, location_id, course_label, fire_at, station_id)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(event_id, location, label, fire_at, station);
  return Number(r.lastInsertRowid);
}

function seedLine({ event_id, course_id = null, item, qty = 1 }) {
  conn.prepare(
    `INSERT INTO beo_line_items (event_id, course_id, item_name, quantity) VALUES (?, ?, ?, ?)`,
  ).run(event_id, course_id, item, qty);
}

describe('GET /api/beo/fire-schedule', () => {
  it('returns empty stations for a day with no events', async () => {
    const res = await route.GET(makeReq('?date=2026-05-04'));
    assert.equal(res.status, 200);
    const j = await res.json();
    assert.equal(j.date, '2026-05-04');
    assert.deepEqual(j.stations, []);
  });

  it('groups across events by station and orders by fire_at', async () => {
    const ev1 = seedEvent({ title: 'Hendricks Wedding', date: '2026-05-04' });
    const ev2 = seedEvent({ title: 'Smith Birthday', date: '2026-05-04' });

    const c1 = seedCourse({ event_id: ev1, label: 'Entree',
      fire_at: '2026-05-04T19:30:00.000Z', station: 'grill' });
    const c2 = seedCourse({ event_id: ev2, label: 'App',
      fire_at: '2026-05-04T19:00:00.000Z', station: 'grill' });
    const c3 = seedCourse({ event_id: ev1, label: 'Dessert',
      fire_at: '2026-05-04T20:30:00.000Z', station: 'sides' });

    seedLine({ event_id: ev1, course_id: c1, item: 'Smoked Brisket', qty: 80 });
    seedLine({ event_id: ev2, course_id: c2, item: 'Bruschetta', qty: 30 });
    seedLine({ event_id: ev1, course_id: c3, item: 'Cheesecake', qty: 80 });

    const res = await route.GET(makeReq('?date=2026-05-04'));
    const j = await res.json();
    assert.equal(j.stations.length, 2);
    const grill = j.stations.find((s) => s.station_id === 'grill');
    assert.deepEqual(grill.courses.map((c) => c.course_label), ['App', 'Entree']);
    assert.equal(grill.courses[1].event_title, 'Hendricks Wedding');
    assert.equal(grill.courses[1].lines.length, 1);
    assert.equal(grill.courses[1].lines[0].item_name, 'Smoked Brisket');
  });

  it('ignores events on other dates', async () => {
    const evToday = seedEvent({ title: 'Today', date: '2026-05-04' });
    const evTomorrow = seedEvent({ title: 'Tomorrow', date: '2026-05-05' });
    seedCourse({ event_id: evToday, label: 'Entree', fire_at: '2026-05-04T19:00:00.000Z', station: 'grill' });
    seedCourse({ event_id: evTomorrow, label: 'Entree', fire_at: '2026-05-05T19:00:00.000Z', station: 'grill' });

    const res = await route.GET(makeReq('?date=2026-05-04'));
    const j = await res.json();
    assert.equal(j.stations[0].courses.length, 1);
  });

  it('scopes by location_id', async () => {
    const evA = seedEvent({ title: 'A', date: '2026-05-04', location: 'austin' });
    const evB = seedEvent({ title: 'B', date: '2026-05-04', location: 'denver' });
    seedCourse({ event_id: evA, label: 'X', fire_at: '2026-05-04T19:00:00.000Z', station: 'grill', location: 'austin' });
    seedCourse({ event_id: evB, label: 'Y', fire_at: '2026-05-04T19:00:00.000Z', station: 'grill', location: 'denver' });

    const res = await route.GET(makeReq('?date=2026-05-04&location=austin'));
    const j = await res.json();
    assert.equal(j.location_id, 'austin');
    assert.equal(j.stations[0].courses.length, 1);
    assert.equal(j.stations[0].courses[0].course_label, 'X');
  });

  it('puts NULL station_id courses in the unassigned bucket', async () => {
    const ev = seedEvent({ title: 'Pop-up', date: '2026-05-04' });
    seedCourse({ event_id: ev, label: 'Tasting', fire_at: '2026-05-04T19:00:00.000Z', station: null });
    const res = await route.GET(makeReq('?date=2026-05-04'));
    const j = await res.json();
    const ua = j.stations.find((s) => s.station_id === 'unassigned');
    assert.ok(ua, 'unassigned bucket should exist');
    assert.equal(ua.courses[0].course_label, 'Tasting');
  });

  it('does NOT require any authentication (PUBLIC endpoint)', async () => {
    // Just confirm a request with no cookie returns 200, not 401.
    const res = await route.GET(makeReq('?date=2026-05-04'));
    assert.notEqual(res.status, 401);
  });
});

describe('GET /api/beo/fire-schedule?event_id=N', () => {
  it('returns only that event\'s courses/lines in the same shape', async () => {
    const ev1 = seedEvent({ title: 'Target Event', date: '2026-06-01' });
    const ev2 = seedEvent({ title: 'Other Event', date: '2026-06-01' });

    const c1 = seedCourse({ event_id: ev1, label: 'Entree',
      fire_at: '2026-06-01T19:00:00.000Z', station: 'grill' });
    const c2 = seedCourse({ event_id: ev1, label: 'Dessert',
      fire_at: '2026-06-01T20:30:00.000Z', station: 'sides' });
    const c3 = seedCourse({ event_id: ev2, label: 'App',
      fire_at: '2026-06-01T18:30:00.000Z', station: 'grill' });

    seedLine({ event_id: ev1, course_id: c1, item: 'Salmon', qty: 50 });
    seedLine({ event_id: ev1, course_id: c2, item: 'Tart', qty: 50 });
    seedLine({ event_id: ev2, course_id: c3, item: 'Should Not Appear', qty: 10 });

    const res = await route.GET(makeReq(`?event_id=${ev1}&location=default`));
    assert.equal(res.status, 200);
    const j = await res.json();

    // Response shape matches the date path
    assert.ok('date' in j, 'payload must have a date field');
    assert.equal(typeof j.date, 'string');
    assert.equal(j.location_id, 'default');
    assert.ok(Array.isArray(j.stations), 'stations must be an array');

    // Only ev1's courses are present
    const allCourseLabels = j.stations.flatMap((s) => s.courses.map((c) => c.course_label));
    assert.ok(allCourseLabels.includes('Entree'), 'should include ev1 Entree');
    assert.ok(allCourseLabels.includes('Dessert'), 'should include ev1 Dessert');
    assert.ok(!allCourseLabels.includes('App'), 'should NOT include ev2 App');

    // Lines are attached
    const grill = j.stations.find((s) => s.station_id === 'grill');
    assert.ok(grill, 'grill station should exist');
    assert.equal(grill.courses[0].lines[0].item_name, 'Salmon');

    // event_date from the join is echoed back as the payload date
    assert.equal(j.date, '2026-06-01');
  });

  it('returns empty stations for an event in a different location (no cross-location leak)', async () => {
    const ev = seedEvent({ title: 'Austin Event', date: '2026-06-02', location: 'austin' });
    seedCourse({ event_id: ev, label: 'Entree', fire_at: '2026-06-02T19:00:00.000Z',
      station: 'grill', location: 'austin' });

    // Request event_id with location=denver — should not see austin's courses
    const res = await route.GET(makeReq(`?event_id=${ev}&location=denver`));
    assert.equal(res.status, 200);
    const j = await res.json();
    assert.equal(j.location_id, 'denver');
    assert.deepEqual(j.stations, []);
  });

  it('returns empty stations for a non-existent event_id', async () => {
    const res = await route.GET(makeReq('?event_id=99999&location=default'));
    assert.equal(res.status, 200);
    const j = await res.json();
    assert.deepEqual(j.stations, []);
  });

  it('falls through to the date path (does NOT 500) when event_id is non-integer', async () => {
    const ev = seedEvent({ title: 'Fallthrough', date: '2026-06-03' });
    seedCourse({ event_id: ev, label: 'Entree', fire_at: '2026-06-03T19:00:00.000Z', station: 'grill' });

    // Malformed event_id should be ignored, falling through to the date path
    const res = await route.GET(makeReq('?event_id=abc&date=2026-06-03'));
    assert.equal(res.status, 200);
    const j = await res.json();
    // Should return date-path results, not crash
    assert.equal(j.date, '2026-06-03');
    assert.ok(Array.isArray(j.stations));
    // The event seeded for 2026-06-03 should appear via the date path
    assert.equal(j.stations[0].courses[0].course_label, 'Entree');
  });
});
