#!/usr/bin/env node
// Tests for T4 (Bundle-H follow-up): BEO line-item ops MUST scope by
// location_id via the parent event.
//
// `beo_line_items` does NOT carry its own location_id — it inherits via
// the FK to `beo_events`. So a `delete_line` / `update_line` request
// with the wrong location_id must NOT be able to mutate a foreign
// event's lines. The fix is the subquery pattern:
//   WHERE id = ? AND event_id IN (SELECT id FROM beo_events WHERE location_id = ?)
//
// Pins:
//   - delete_line scoped to matching location: row is deleted.
//   - delete_line targeting a foreign-location line: foreign data is
//     untouched. (Existing route returns 200/no-op style; we assert by
//     checking the row is still present, which is the load-bearing
//     property — a multi-tenant attacker mutating someone else's data
//     is the actual concern.)
//   - update_line scoped to matching location: fields are updated.
//   - update_line targeting a foreign-location line: foreign data is
//     untouched.
//
// Run: node --experimental-strip-types --test tests/js/test-beo-line-location-scope.mjs

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

const { testDb, cleanup } = await createTempBeoDb('line-loc');
const route = await import('../../app/api/beo/route.js');

const { POST } = route;

after(cleanup);

beforeEach(() => {
  // Cascade through children first so FK-enforced DELETE can't choke.
  clearBeoTables(testDb);
});

// ── delete_line: scoped to parent event's location_id ──────────────

describe("POST /api/beo action='delete_line' — location-scoped via parent event", () => {
  it('deletes the line when location_id matches the parent event', async () => {
    const { LOC_A, lineA } = await setupTwoLocations(POST);
    const res = await POST(postReq({
      action: 'delete_line',
      location_id: LOC_A,
      id: lineA,
    }));
    assert.strictEqual(res.status, 200);
    const row = testDb.prepare(
      `SELECT * FROM beo_line_items WHERE id = ?`,
    ).get(lineA);
    assert.strictEqual(row, undefined, 'matching-location delete_line should remove the row');
  });

  it('does NOT delete a line whose parent event lives in a different location', async () => {
    const { LOC_A, lineB } = await setupTwoLocations(POST);
    // LOC_A request targeting LOC_B's line. Pre-fix: SQL ignores
    // location_id and the row is destroyed. Post-fix: the subquery
    // filters event_id by location and the row survives.
    await POST(postReq({
      action: 'delete_line',
      location_id: LOC_A,
      id: lineB,
    }));
    const row = testDb.prepare(
      `SELECT * FROM beo_line_items WHERE id = ?`,
    ).get(lineB);
    assert.ok(row, 'foreign-location line must NOT be deleted');
    assert.strictEqual(row.item_name, 'Site B Salmon', 'foreign-location line content must be unchanged');
    assert.strictEqual(row.unit_cost, 22.0);
    assert.strictEqual(row.quantity, 30);
  });
});

// ── update_line: scoped to parent event's location_id ──────────────

describe("POST /api/beo action='update_line' — location-scoped via parent event", () => {
  it('updates the line when location_id matches the parent event', async () => {
    const { LOC_A, lineA } = await setupTwoLocations(POST);
    const res = await POST(postReq({
      action: 'update_line',
      location_id: LOC_A,
      id: lineA,
      item_name: 'Site A Brisket (deluxe)',
      unit_cost: 21.5,
      quantity: 55,
    }));
    assert.strictEqual(res.status, 200);
    const row = testDb.prepare(
      `SELECT * FROM beo_line_items WHERE id = ?`,
    ).get(lineA);
    assert.strictEqual(row.item_name, 'Site A Brisket (deluxe)');
    assert.strictEqual(row.unit_cost, 21.5);
    assert.strictEqual(row.quantity, 55);
  });

  it('does NOT mutate a line whose parent event lives in a different location', async () => {
    const { LOC_A, lineB } = await setupTwoLocations(POST);
    // LOC_A request trying to mutate LOC_B's line. Pre-fix: SQL ignores
    // location and the row is rewritten. Post-fix: the subquery filters
    // and the row's content stays exactly as LOC_B set it.
    await POST(postReq({
      action: 'update_line',
      location_id: LOC_A,
      id: lineB,
      item_name: 'HIJACKED',
      unit_cost: 0.01,
      quantity: 999,
    }));
    const row = testDb.prepare(
      `SELECT * FROM beo_line_items WHERE id = ?`,
    ).get(lineB);
    assert.ok(row);
    assert.strictEqual(row.item_name, 'Site B Salmon', 'foreign-location item_name must be unchanged');
    assert.strictEqual(row.unit_cost, 22.0, 'foreign-location unit_cost must be unchanged');
    assert.strictEqual(row.quantity, 30, 'foreign-location quantity must be unchanged');
  });
});

// ── Sanity: own-location operations leave foreign data alone ───────

describe('BEO line ops — cross-location isolation', () => {
  it("LOC_A's delete_line on its own line leaves LOC_B's line untouched", async () => {
    const { LOC_A, lineA, lineB } = await setupTwoLocations(POST);
    await POST(postReq({
      action: 'delete_line',
      location_id: LOC_A,
      id: lineA,
    }));
    const stillB = testDb.prepare(
      `SELECT * FROM beo_line_items WHERE id = ?`,
    ).get(lineB);
    assert.ok(stillB, 'LOC_B line must survive a LOC_A delete');
    assert.strictEqual(stillB.item_name, 'Site B Salmon');
  });
});
