#!/usr/bin/env node
// Tests: BEO `prep_done` + `delete_event` mutations MUST scope by
// location_id.
//
// `beo_prep_tasks` and `beo_events` both carry their own `location_id`
// column. A `prep_done` / `delete_event` request that supplies a foreign
// location_id must NOT be able to toggle that prep task or delete that
// event — the same cross-location integrity property already enforced for
// update_event / update_line / delete_line.
//
// Pre-fix: `UPDATE beo_prep_tasks SET done = ? WHERE id = ?` and
//   `DELETE FROM beo_events WHERE id = ?` ignore location, so a caller in
//   location A can mutate location B's rows by id.
// Post-fix: `... AND location_id = ?` bound to the already-derived `loc`.
//
// Run: node --experimental-strip-types --test tests/js/test-beo-prep-delete-location-scope.mjs

import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register(new URL('./resolver.mjs', import.meta.url));

const {
  createTempBeoDb,
  clearBeoTables,
  postReq,
  setupTwoLocations,
} = await import('./helpers/beo-fixtures.mjs');

const { testDb, cleanup } = await createTempBeoDb('prep-del-loc');
const route = await import('../../app/api/beo/route.js');

const { POST } = route;

after(cleanup);

beforeEach(() => {
  clearBeoTables(testDb);
});

/** Seed one prep task at a location via the `prep` action; return its id. */
async function seedPrep(POST_, { location_id, event_id, task }) {
  const res = await POST_(postReq({ action: 'prep', location_id, event_id, task }));
  const body = await res.json();
  return body.id;
}

// ── delete_event: location-scoped ──────────────────────────────────

describe("POST /api/beo action='delete_event' — location-scoped", () => {
  it('deletes the event when location_id matches', async () => {
    const { LOC_A, eventA } = await setupTwoLocations(POST);
    const res = await POST(postReq({ action: 'delete_event', location_id: LOC_A, id: eventA }));
    assert.strictEqual(res.status, 200);
    const row = testDb.prepare(`SELECT * FROM beo_events WHERE id = ?`).get(eventA);
    assert.strictEqual(row, undefined, 'matching-location delete_event should remove the event');
  });

  it('does NOT delete an event that lives in a different location', async () => {
    const { LOC_A, eventB } = await setupTwoLocations(POST);
    // LOC_A request targeting LOC_B's event. Pre-fix: SQL ignores
    // location_id and the event is destroyed. Post-fix: the AND clause
    // filters by location and the event survives.
    await POST(postReq({ action: 'delete_event', location_id: LOC_A, id: eventB }));
    const row = testDb.prepare(`SELECT * FROM beo_events WHERE id = ?`).get(eventB);
    assert.ok(row, 'foreign-location event must NOT be deleted');
    assert.strictEqual(row.title, 'Site B Anniversary', 'foreign-location event content must be unchanged');
  });
});

// ── prep_done: location-scoped ─────────────────────────────────────

describe("POST /api/beo action='prep_done' — location-scoped", () => {
  it('toggles done when location_id matches', async () => {
    const { LOC_A, eventA } = await setupTwoLocations(POST);
    const prepA = await seedPrep(POST, { location_id: LOC_A, event_id: eventA, task: 'Brine turkey' });
    const res = await POST(postReq({ action: 'prep_done', location_id: LOC_A, id: prepA, done: true }));
    assert.strictEqual(res.status, 200);
    const row = testDb.prepare(`SELECT done FROM beo_prep_tasks WHERE id = ?`).get(prepA);
    assert.strictEqual(row.done, 1, 'matching-location prep_done should set done=1');
  });

  it('does NOT toggle a prep task that lives in a different location', async () => {
    const { LOC_A, LOC_B, eventB } = await setupTwoLocations(POST);
    const prepB = await seedPrep(POST, { location_id: LOC_B, event_id: eventB, task: 'Slice salmon' });
    // LOC_A request toggling LOC_B's prep task. Pre-fix: toggled. Post-fix: stays 0.
    await POST(postReq({ action: 'prep_done', location_id: LOC_A, id: prepB, done: true }));
    const row = testDb.prepare(`SELECT done FROM beo_prep_tasks WHERE id = ?`).get(prepB);
    assert.strictEqual(row.done, 0, 'foreign-location prep task must NOT be toggled');
  });
});

// ── Sanity: own-location ops leave foreign data alone ──────────────

describe('BEO prep/event ops — cross-location isolation', () => {
  it("LOC_A's delete_event on its own event leaves LOC_B's event untouched", async () => {
    const { LOC_A, eventA, eventB } = await setupTwoLocations(POST);
    await POST(postReq({ action: 'delete_event', location_id: LOC_A, id: eventA }));
    const stillB = testDb.prepare(`SELECT * FROM beo_events WHERE id = ?`).get(eventB);
    assert.ok(stillB, 'LOC_B event must survive a LOC_A delete');
    assert.strictEqual(stillB.title, 'Site B Anniversary');
  });
});
