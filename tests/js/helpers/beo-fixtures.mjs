// Shared seed fixtures for BEO test suites.
//
// Four sibling test files (`test-beo-worksheet`,
// `test-beo-update-event-partial-patch`, `test-beo-line-location-scope`,
// `test-beo-get-many-events`) had near-identical local copies of:
//
//   - mkdtempSync + setDbPathForTest + after-hook cleanup
//   - postReq() / getReq() Request builders for /api/beo
//   - the three-line `DELETE FROM beo_line_items; … beo_prep_tasks; … beo_events;`
//     beforeEach reset
//   - seedEvent() / setupTwoLocations() seed shapes
//
// Code-quality reviews of T3, T4, T5 flagged the duplication. This module
// is the single home for that setup. Tests still own their assertions and
// any unique fixture data; only the boilerplate moves here.
//
// Resolver note: `tests/js/resolver.mjs` only remaps relative specifiers,
// so we import the route + lib via `../../../app/...` and `../../../lib/...`
// (one extra `../` because this file lives one directory deeper than the
// test files).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// ── DB lifecycle ────────────────────────────────────────────────────

/**
 * Spin up an isolated on-disk SQLite DB for a BEO test suite, point the
 * shared `lib/db` module at it, and return the live connection.
 *
 * Returns a `cleanup` function that the caller passes to `after(...)`
 * — it unbinds the test path and removes the temp directory.
 *
 * @param {string} label - short tag baked into the temp dir name (visible
 *   if a leak surfaces in `/tmp`); use the test file's slug.
 */
export async function createTempBeoDb(label) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), `lariat-beo-${label}-`));
  const tmpDbPath = path.join(tmpDir, 'lariat-test.db');

  const db = await import('../../../lib/db.ts');
  db.setDbPathForTest(tmpDbPath);
  const testDb = db.getDb();

  function cleanup() {
    db.setDbPathForTest(null);
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }

  return { db, testDb, tmpDir, tmpDbPath, cleanup };
}

/**
 * Cascade-aware reset for BEO tables. Children first so an FK-enforced
 * DELETE on `beo_events` can't choke on dangling line_items / prep_tasks.
 * Use inside `beforeEach(...)`.
 */
export function clearBeoTables(testDb) {
  testDb.exec(
    'DELETE FROM beo_line_items; DELETE FROM beo_prep_tasks; DELETE FROM beo_events;',
  );
}

// ── Request builders ────────────────────────────────────────────────

/** Build a POST /api/beo Request with a JSON body. */
export function postReq(body) {
  return new Request('http://localhost/api/beo', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** Build a GET /api/beo Request, optionally with a query string. */
export function getReq(qs = '') {
  return new Request(`http://localhost/api/beo${qs}`);
}

// ── Seed helpers ────────────────────────────────────────────────────

/**
 * Default invoice-header shape used by the partial-patch suite. Every
 * column is populated so a partial PATCH can be observed leaving the
 * untouched columns intact.
 */
const DEFAULT_EVENT_PAYLOAD = {
  action: 'event',
  title: 'Wallace anniversary',
  event_date: '2026-07-04',
  event_time: '6-9pm',
  contact_name: 'Marie Wallace',
  guest_count: 32,
  notes: 'two vegetarians, one tree-nut allergy',
  tax_rate: 0.08,
  service_fee_pct: 22,
};

/**
 * Seed one beo_events row through POST /api/beo.
 *
 * Returns the new event's id. Pass `overrides` to swap any field
 * (including `location_id`, `title`, etc.). `action: 'event'` is always
 * forced so callers can't accidentally hand in the wrong action verb.
 */
export async function seedEvent(POST, overrides = {}) {
  const res = await POST(
    postReq({ ...DEFAULT_EVENT_PAYLOAD, ...overrides, action: 'event' }),
  );
  const body = await res.json();
  return body.id;
}

/**
 * Build a two-location two-event fixture: one event at LOC_A with one
 * line, one event at LOC_B with one line. Used by the line-location
 * scope tests to attempt cross-location attacks.
 *
 * Returns the seeded handles: `{ LOC_A, LOC_B, eventA, eventB, lineA, lineB }`.
 */
export async function setupTwoLocations(POST, opts = {}) {
  const LOC_A = opts.locA ?? 'site-a';
  const LOC_B = opts.locB ?? 'site-b';

  const evA = await POST(postReq({
    action: 'event',
    location_id: LOC_A,
    title: 'Site A Wedding',
    event_date: '2026-07-04',
  }));
  const { id: eventA } = await evA.json();

  const evB = await POST(postReq({
    action: 'event',
    location_id: LOC_B,
    title: 'Site B Anniversary',
    event_date: '2026-07-04',
  }));
  const { id: eventB } = await evB.json();

  const lineA_res = await POST(postReq({
    action: 'line',
    location_id: LOC_A,
    event_id: eventA,
    item_name: 'Site A Brisket',
    category: 'Entree',
    unit_cost: 18.0,
    quantity: 50,
  }));
  const { id: lineA } = await lineA_res.json();

  const lineB_res = await POST(postReq({
    action: 'line',
    location_id: LOC_B,
    event_id: eventB,
    item_name: 'Site B Salmon',
    category: 'Entree',
    unit_cost: 22.0,
    quantity: 30,
  }));
  const { id: lineB } = await lineB_res.json();

  return { LOC_A, LOC_B, eventA, eventB, lineA, lineB };
}
