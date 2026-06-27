#!/usr/bin/env node
// Security regression tests for T1: delete_event and prep_done must not
// mutate rows owned by a different location_id.
//
// Run: node --experimental-strip-types --test \
//        tests/js/test-beo-event-location-scope.mjs

import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register(new URL('./resolver.mjs', import.meta.url));

const {
  createTempBeoDb,
  clearBeoTables,
  postReq,
} = await import('./helpers/beo-fixtures.mjs');

const { testDb, cleanup } = await createTempBeoDb('event-location-scope');
const route = await import('../../app/api/beo/route.js');

const { POST } = route;

after(cleanup);

beforeEach(() => {
  clearBeoTables(testDb);
});

describe("POST /api/beo location-scoping — delete_event and prep_done", () => {
  it('delete_event does not cross locations', async () => {
    // Seed a beo_events row owned by location 'A'
    const info = testDb
      .prepare(
        `INSERT INTO beo_events (title, event_date, location_id) VALUES ('Cross-loc test', '2026-09-01', 'A')`,
      )
      .run();
    const eventId = Number(info.lastInsertRowid);

    // POST delete_event with location_id='B' — should NOT delete the row
    const res = await POST(postReq({ action: 'delete_event', id: eventId, location_id: 'B' }));
    const body = await res.json();

    // Response must still be ok:true (no existence oracle)
    assert.strictEqual(body.ok, true, 'response ok should be true');

    // The event must still exist in the DB (location 'A' was not touched)
    const row = testDb.prepare(`SELECT id FROM beo_events WHERE id = ?`).get(eventId);
    assert.ok(row, `event ${eventId} should still exist in the DB after cross-location delete attempt`);
  });

  it('prep_done does not cross locations', async () => {
    // Seed a beo_events row in location 'A'
    const evInfo = testDb
      .prepare(
        `INSERT INTO beo_events (title, event_date, location_id) VALUES ('Prep scope test', '2026-09-02', 'A')`,
      )
      .run();
    const eventId = Number(evInfo.lastInsertRowid);

    // Seed a beo_prep_tasks row in location 'A', done=0
    const taskInfo = testDb
      .prepare(
        `INSERT INTO beo_prep_tasks (event_id, task, done, location_id) VALUES (?, 'Ice carving', 0, 'A')`,
      )
      .run(eventId);
    const taskId = Number(taskInfo.lastInsertRowid);

    // POST prep_done with location_id='B' — should NOT update done
    const res = await POST(postReq({ action: 'prep_done', id: taskId, done: 1, location_id: 'B' }));
    const body = await res.json();

    assert.strictEqual(body.ok, true, 'response ok should be true');

    // The task's done column must still be 0
    const row = testDb.prepare(`SELECT done FROM beo_prep_tasks WHERE id = ?`).get(taskId);
    assert.strictEqual(row.done, 0, `task ${taskId} done should remain 0 after cross-location prep_done`);
  });
});
