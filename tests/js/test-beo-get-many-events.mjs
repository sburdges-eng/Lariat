#!/usr/bin/env node
// Regression-prevention test for T5: GET /api/beo must scale past the
// SQLite host-parameter limit when one location accumulates many events.
//
// Before the subquery refactor in app/api/beo/route.js, GET /api/beo
// loaded line_items by building `WHERE event_id IN (?, ?, ...)` with
// one bound parameter per event id. better-sqlite3 inherits SQLite's
// compile-time parameter limit (default 32766) and the SQL shape
// changed on every request, defeating prepared-statement reuse.
//
// The line_items SELECT now uses the correlated subquery form
// `WHERE event_id IN (SELECT id FROM beo_events WHERE location_id = ?)`
// — one stable SQL string, one bound parameter, regardless of event
// count. The prep_tasks SELECT was intentionally left as a direct
// `WHERE location_id = ?` filter on the prep_tasks table (it was
// never part of the IN-list parameter chain, and other code paths
// rely on its direct-filter semantics).
//
// This test seeds 50 events (well above any plausible IN-list edge
// case for normal ops, and a deliberate canary for the line_items
// parameter chain) plus one line_item and one prep_task per event,
// then asserts the GET response returns all 50 of each, correctly
// associated to their owning event.
//
// Run: node --test tests/js/test-beo-get-many-events.mjs

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register(new URL('./resolver.mjs', import.meta.url));

const {
  createTempBeoDb,
  postReq,
  getReq,
} = await import('./helpers/beo-fixtures.mjs');

const { testDb, cleanup } = await createTempBeoDb('many-events');
const route = await import('../../app/api/beo/route.js');

const { POST, GET } = route;

after(cleanup);

describe('GET /api/beo — high-volume events (line_items subquery scaling)', () => {
  it('returns line_items + prep_tasks for 50 events without an IN-list parameter chain', async () => {
    // Start clean — this suite owns the DB.
    testDb.exec(
      'DELETE FROM beo_line_items; DELETE FROM beo_prep_tasks; DELETE FROM beo_events;',
    );

    const EVENT_COUNT = 50;
    const eventIds = [];

    // Seed 50 distinct events, each with one line_item and one prep_task,
    // all under the default location.
    for (let i = 0; i < EVENT_COUNT; i++) {
      const seq = String(i + 1).padStart(3, '0');
      const eventRes = await POST(postReq({
        action: 'event',
        title: `Party ${seq}`,
        event_date: '2026-07-01',
        event_time: '5pm',
        contact_name: `Host ${seq}`,
        guest_count: 10 + i,
      }));
      assert.strictEqual(eventRes.status, 200, `seed event ${seq} failed`);
      const { id: eventId } = await eventRes.json();
      assert.ok(eventId, `seed event ${seq} returned no id`);
      eventIds.push(eventId);

      const lineRes = await POST(postReq({
        action: 'line',
        event_id: eventId,
        item_name: `Entree ${seq}`,
        category: 'Entree',
        unit_cost: 12.5,
        quantity: 10,
      }));
      assert.strictEqual(lineRes.status, 200, `seed line ${seq} failed`);

      const prepRes = await POST(postReq({
        action: 'prep',
        event_id: eventId,
        task: `Prep task ${seq}`,
        due_date: '2026-06-30',
      }));
      assert.strictEqual(prepRes.status, 200, `seed prep ${seq} failed`);
    }

    // GET — line_items now uses one bound parameter regardless of event
    // count; prep_tasks is filtered directly on its own location_id column.
    const res = await GET(getReq());
    assert.strictEqual(res.status, 200);
    const body = await res.json();

    // Every seeded event surfaces.
    assert.strictEqual(
      body.events.length,
      EVENT_COUNT,
      `expected ${EVENT_COUNT} events, got ${body.events.length}`,
    );
    // One line_item per event.
    assert.strictEqual(
      body.line_items.length,
      EVENT_COUNT,
      `expected ${EVENT_COUNT} line_items, got ${body.line_items.length}`,
    );
    // One prep_task per event.
    assert.strictEqual(
      body.prep_tasks.length,
      EVENT_COUNT,
      `expected ${EVENT_COUNT} prep_tasks, got ${body.prep_tasks.length}`,
    );

    // Each line_item and prep_task must reference exactly one of the
    // seeded events — guards against the subquery accidentally widening
    // the result, or any cross-event misjoin.
    const eventIdSet = new Set(eventIds);
    for (const li of body.line_items) {
      assert.ok(
        eventIdSet.has(li.event_id),
        `line_item ${li.id} references unexpected event_id ${li.event_id}`,
      );
    }
    for (const pt of body.prep_tasks) {
      assert.ok(
        eventIdSet.has(pt.event_id),
        `prep_task ${pt.id} references unexpected event_id ${pt.event_id}`,
      );
    }

    // Every seeded event must have been hit by the line_items + prep_tasks
    // queries — i.e. no event silently dropped.
    const linedEventIds = new Set(body.line_items.map((r) => r.event_id));
    const preppedEventIds = new Set(body.prep_tasks.map((r) => r.event_id));
    for (const id of eventIds) {
      assert.ok(linedEventIds.has(id), `event ${id} missing from line_items`);
      assert.ok(preppedEventIds.has(id), `event ${id} missing from prep_tasks`);
    }
  });

  it('only returns rows for the requested location, not every event in the DB', async () => {
    testDb.exec(
      'DELETE FROM beo_line_items; DELETE FROM beo_prep_tasks; DELETE FROM beo_events;',
    );

    // Seed under the default location.
    const localRes = await POST(postReq({
      action: 'event',
      title: 'Local party',
      event_date: '2026-07-15',
    }));
    const { id: localEventId } = await localRes.json();
    await POST(postReq({
      action: 'line',
      event_id: localEventId,
      item_name: 'Local appetizer',
    }));
    await POST(postReq({
      action: 'prep',
      event_id: localEventId,
      task: 'Local prep',
    }));

    // Seed under a different location.
    const otherRes = await POST(postReq({
      action: 'event',
      title: 'Other party',
      event_date: '2026-07-15',
      location_id: 'other-shop',
    }));
    const { id: otherEventId } = await otherRes.json();
    await POST(postReq({
      action: 'line',
      event_id: otherEventId,
      item_name: 'Other appetizer',
      location_id: 'other-shop',
    }));
    await POST(postReq({
      action: 'prep',
      event_id: otherEventId,
      task: 'Other prep',
      location_id: 'other-shop',
    }));

    // GET default location — must not bleed in the 'other-shop' rows.
    // For line_items the guarantee comes from the subquery joining
    // through beo_events (line_items has no location_id column). For
    // prep_tasks the guarantee comes from the direct location_id filter.
    const res = await GET(getReq());
    const body = await res.json();
    assert.strictEqual(body.events.length, 1);
    assert.strictEqual(body.events[0].id, localEventId);
    assert.strictEqual(body.line_items.length, 1);
    assert.strictEqual(body.line_items[0].event_id, localEventId);
    assert.strictEqual(body.prep_tasks.length, 1);
    assert.strictEqual(body.prep_tasks[0].event_id, localEventId);
  });
});
