#!/usr/bin/env node
// Tests for the 2026-05-08 kitchen-assistant action-hardening pass.
//
// Pins four soft-reject behaviors added on top of the existing LLM
// action handlers in app/api/kitchen-assistant/route.js:
//
//   1. update_inventory: non-finite payload.delta is REJECTED (was
//      silently stored as a clipped string in inventory_updates.delta).
//   2. update_order_guide: non-finite payload.qty is REJECTED (was
//      coerced via `payload.qty || 1`, accepting strings like "5 lbs").
//   3. maintenance: equipment name partial-matches via LIKE %name%
//      (was exact-match only — the LIKE was effectively a strict =).
//   4. give_gold_star: cook_name not on the entities_employees active
//      roster is REJECTED (was unvalidated — LLM could invent names).
//      With an empty roster, the action is allowed through (legacy
//      fallback so a fresh DB doesn't block recognition entirely).
//
// Same fetch-stub pattern as test-kitchen-assistant-beo-add-prep-scope.mjs:
// the route's action handlers run deterministically post-LLM, so we only
// need to make `lib/ollama.ts::ollamaChat()` return a fenced JSON action
// shaped like the LLM would emit.
//
// Run:
//   node --experimental-strip-types --test tests/js/test-kitchen-assistant-action-hardening.mjs

import { describe, it, after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

register(new URL('./resolver.mjs', import.meta.url));

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-ka-action-hardening-'));
const TMP_DB = path.join(TMP_DIR, 'lariat-test.db');

// Pin gate: every action under test except give_gold_star (which is
// also gated) requires a valid `lariat_pin_ok` cookie. We mint a
// signed cookie at setup time using a fixed test secret.
const ORIGINAL_PIN = process.env.LARIAT_PIN;
const ORIGINAL_PIN_SECRET = process.env.LARIAT_PIN_SECRET;
process.env.LARIAT_PIN = '4242';
process.env.LARIAT_PIN_SECRET = 'test-secret-for-hardening-suite';

const { signPinCookieValue } = await import('../../lib/pinCookie');
const signedPinCookie = await signPinCookieValue(process.env.LARIAT_PIN_SECRET);
const COOKIE_HEADER = `lariat_pin_ok=${signedPinCookie}`;

const ORIGINAL_FETCH = globalThis.fetch;
let stubbedAction = null;
function installFetchStub() {
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.endsWith('/api/chat')) {
      const content =
        '```json\n' + JSON.stringify(stubbedAction) + '\n```\n' +
        'OK — action emitted.';
      return new Response(JSON.stringify({ message: { content } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response('not stubbed', { status: 404 });
  };
}

const db = await import('../../lib/db.ts');
const route = await import('../../app/api/kitchen-assistant/route.js');

db.setDbPathForTest(TMP_DB);
const testDb = db.getDb();

const { POST } = route;

after(() => {
  db.setDbPathForTest(null);
  globalThis.fetch = ORIGINAL_FETCH;
  if (ORIGINAL_PIN === undefined) delete process.env.LARIAT_PIN;
  else process.env.LARIAT_PIN = ORIGINAL_PIN;
  if (ORIGINAL_PIN_SECRET === undefined) delete process.env.LARIAT_PIN_SECRET;
  else process.env.LARIAT_PIN_SECRET = ORIGINAL_PIN_SECRET;
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

before(() => {
  installFetchStub();
});

beforeEach(() => {
  testDb.exec(
    `DELETE FROM inventory_updates;
     DELETE FROM order_guide_items;
     DELETE FROM equipment;
     DELETE FROM equipment_maintenance;
     DELETE FROM gold_stars;
     DELETE FROM entities_employees;
     DELETE FROM line_check_entries;
     DELETE FROM lari_conversation_turns;
     DELETE FROM audit_events;`,
  );
});

const LOC = 'default';
const SESSION = '55555555-5555-4555-8555-555555555555';
const COOK = 'cook-action-hardening';

function postReq(action, message = 'log this update') {
  stubbedAction = action;
  return new Request('http://localhost/api/kitchen-assistant', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: COOKIE_HEADER,
    },
    body: JSON.stringify({
      message,
      location_id: LOC,
      cook_id: COOK,
      conversation_session_id: SESSION,
    }),
  });
}

function countInventoryUpdates() {
  return testDb.prepare('SELECT COUNT(*) AS c FROM inventory_updates').get().c;
}
function countOrderGuide() {
  return testDb.prepare('SELECT COUNT(*) AS c FROM order_guide_items').get().c;
}
function countMaintenance() {
  return testDb.prepare('SELECT COUNT(*) AS c FROM equipment_maintenance').get().c;
}
function countGoldStars() {
  return testDb.prepare('SELECT COUNT(*) AS c FROM gold_stars').get().c;
}
function countLineCheckEntries() {
  return testDb.prepare('SELECT COUNT(*) AS c FROM line_check_entries').get().c;
}

function seedEquipment(name, category = 'cooking') {
  testDb
    .prepare('INSERT INTO equipment (location_id, name, category) VALUES (?, ?, ?)')
    .run(LOC, name, category);
}
function seedEmployee(displayName, active = 1) {
  testDb
    .prepare(
      `INSERT INTO entities_employees (uuid, display_name, active)
       VALUES (?, ?, ?)`,
    )
    .run(`uuid-${displayName}`, displayName, active);
}

// ── update_inventory: non-finite delta soft-rejects ──────────────

describe('kitchen-assistant update_inventory — non-finite delta soft-reject', () => {
  it('REJECTS a non-numeric delta and writes no inventory row', async () => {
    const res = await POST(postReq({
      action: 'update_inventory',
      item: 'cilantro',
      delta: '5 lbs',  // string with unit — looks plausible but is junk
      direction: 'out',
    }, 'log inventory: cilantro down 5 lbs'));
    assert.equal(res.status, 200, 'soft-reject pattern: 200 + blocked message');
    const body = await res.json();
    assert.match(
      body.answer || '',
      /update blocked/i,
      'response should surface the block',
    );
    assert.equal(countInventoryUpdates(), 0, 'no inventory_updates row landed');
  });

  it('ACCEPTS a finite numeric delta', async () => {
    const res = await POST(postReq({
      action: 'update_inventory',
      item: 'cilantro',
      delta: 3,
      unit: 'bunch',
      direction: 'out',
    }));
    assert.equal(res.status, 200);
    assert.equal(countInventoryUpdates(), 1);
    const row = testDb
      .prepare('SELECT delta FROM inventory_updates ORDER BY id DESC LIMIT 1')
      .get();
    assert.equal(row.delta, '3 bunch');
  });
});

// ── update_order_guide: non-finite qty soft-rejects ──────────────

describe('kitchen-assistant update_order_guide — non-finite qty soft-reject', () => {
  it('REJECTS a non-numeric qty and writes no order_guide row', async () => {
    const res = await POST(postReq({
      action: 'update_order_guide',
      item: 'shallots',
      qty: '5 lbs',  // not a clean number
      unit: 'lb',
    }));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.match(body.answer || '', /update blocked/i);
    assert.equal(countOrderGuide(), 0);
  });

  it('REJECTS qty <= 0', async () => {
    const res = await POST(postReq({
      action: 'update_order_guide',
      item: 'shallots',
      qty: 0,
    }));
    assert.equal(res.status, 200);
    assert.equal(countOrderGuide(), 0);
  });

  it('ACCEPTS a finite positive qty', async () => {
    const res = await POST(postReq({
      action: 'update_order_guide',
      item: 'shallots',
      qty: 5,
      unit: 'lb',
    }));
    assert.equal(res.status, 200);
    assert.equal(countOrderGuide(), 1);
    const row = testDb
      .prepare('SELECT base_qty, unit FROM order_guide_items ORDER BY id DESC LIMIT 1')
      .get();
    assert.equal(row.base_qty, 5);
    assert.equal(row.unit, 'lb');
  });
});

// ── maintenance: LIKE wildcard partial match ─────────────────────

describe('kitchen-assistant maintenance — LIKE wildcard partial match', () => {
  it('matches an equipment name as a substring (was exact-match-only pre-fix)', async () => {
    seedEquipment('Henny Penny Pressure Fryer');
    const res = await POST(postReq({
      action: 'maintenance',
      equipment: 'Pressure Fryer',  // partial — pre-fix this would not match
      issue: 'oil temp not reaching set point',
    }));
    assert.equal(res.status, 200);
    assert.equal(countMaintenance(), 1, 'maintenance row landed via partial match');
    const row = testDb
      .prepare('SELECT notes FROM equipment_maintenance ORDER BY id DESC LIMIT 1')
      .get();
    assert.match(row.notes || '', /oil temp/i);
  });

  it('still soft-rejects when no equipment matches at all', async () => {
    const res = await POST(postReq({
      action: 'maintenance',
      equipment: 'imaginary widget',
      issue: 'broken',
    }));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.match(body.answer || '', /could not find equipment/i);
    assert.equal(countMaintenance(), 0);
  });
});

// ── give_gold_star: roster validation ────────────────────────────

describe('kitchen-assistant give_gold_star — roster validation', () => {
  it('REJECTS a cook name that is not on the active roster', async () => {
    seedEmployee('Alice');
    seedEmployee('Bob');

    const res = await POST(postReq({
      action: 'give_gold_star',
      cook_name: 'Chuck',  // not on the roster
      stars: 2,
      reason: 'invented by the model',
    }));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.match(body.answer || '', /not on the active roster/i);
    assert.equal(countGoldStars(), 0);
  });

  it('ACCEPTS a roster name match (case-insensitive)', async () => {
    seedEmployee('Alice');
    const res = await POST(postReq({
      action: 'give_gold_star',
      cook_name: 'alice',  // lowercased
      stars: 1,
      reason: 'crushed Saturday brunch',
    }));
    assert.equal(res.status, 200);
    assert.equal(countGoldStars(), 1);
    const row = testDb
      .prepare('SELECT cook_name FROM gold_stars ORDER BY id DESC LIMIT 1')
      .get();
    assert.equal(row.cook_name, 'alice', 'stored as the LLM emitted it (clipped)');
  });

  it('REJECTS an inactive roster member when an active roster exists', async () => {
    // Need an active member so the roster is non-empty (otherwise the
    // empty-roster fallback fires and the action is allowed).
    seedEmployee('Alice');
    seedEmployee('Carol', 0);  // inactive

    const res = await POST(postReq({
      action: 'give_gold_star',
      cook_name: 'Carol',
      stars: 1,
    }));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.match(body.answer || '', /not on the active roster/i);
    assert.equal(countGoldStars(), 0);
  });

  it('ALLOWS the action through when the roster is empty (fresh-DB fallback)', async () => {
    // entities_employees has no rows → cannot validate, so we let it
    // through rather than block recognition entirely.
    const res = await POST(postReq({
      action: 'give_gold_star',
      cook_name: 'Whoever',
      stars: 1,
    }));
    assert.equal(res.status, 200);
    assert.equal(countGoldStars(), 1, 'fresh-DB fallback wrote the recognition row');
  });
});

// ── give_gold_star: stars-payload type guard (audit fix 1) ──────────
//
// Pre-fix the route used `Number(payload.stars) || 1`, so non-finite or
// non-numeric `stars` (null, "three", {}) silently coerced to 1 and a
// gold-star row landed. Inconsistent with the Number.isFinite guards on
// update_inventory.delta and update_order_guide.qty. Soft-reject those
// payloads via the same shape used by peer actions (eighty_six et al.).

describe('kitchen-assistant give_gold_star — stars payload type guard', () => {
  it('REJECTS stars: null and writes no gold_star row', async () => {
    seedEmployee('Alice');
    const res = await POST(postReq({
      action: 'give_gold_star',
      cook_name: 'Alice',
      stars: null,                 // pre-fix coerced to 1 silently
      reason: 'crushed Saturday brunch',
    }));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.match(
      body.answer || '',
      /must be a number/i,
      'response should call out the bad stars value',
    );
    assert.equal(countGoldStars(), 0, 'no gold_stars row should land');
  });

  it('REJECTS stars: "three" (non-numeric string) and writes no gold_star row', async () => {
    seedEmployee('Alice');
    const res = await POST(postReq({
      action: 'give_gold_star',
      cook_name: 'Alice',
      stars: 'three',              // pre-fix Number("three") || 1 = 1
      reason: 'crushed Saturday brunch',
    }));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.match(body.answer || '', /must be a number/i);
    assert.equal(countGoldStars(), 0);
  });
});

// ── line_check: object reading_f doesn't trip validate-temp branch ──
//
// Pre-fix `let readingF = Number(payload.reading_f)` ran unconditionally;
// `Number({foo:1})` returns NaN which the downstream isFinite check
// catches, but the inconsistency with haccp_receive's typeof guard was a
// footgun. Pin the post-fix behavior: object payloads do NOT crash, do
// NOT trip the validate-temp path, and the row still writes with the
// no-reading default ('na' unless the LLM supplies a status).

describe('kitchen-assistant line_check — non-numeric reading_f type guard', () => {
  it('treats reading_f: {foo:1} as no reading; row writes with status na', async () => {
    const res = await POST(postReq({
      action: 'line_check',
      station: 'grill',
      item: 'walk-in cooler probe',
      reading_f: { foo: 1 },        // garbage object payload
      temp_point_id: 'walk_in_cooler',
      // no explicit status → falls back to 'na'
    }));
    assert.equal(res.status, 200, 'request must not crash on garbage reading_f');
    assert.equal(countLineCheckEntries(), 1, 'line_check row still writes');
    const row = testDb
      .prepare('SELECT status, item FROM line_check_entries ORDER BY id DESC LIMIT 1')
      .get();
    // The validate-temp branch must be skipped (status would be pass/fail
    // if it ran). Default is 'na' — the no-reading sentinel.
    assert.equal(row.status, 'na', 'no usable reading → no validate-temp branch');
    assert.equal(row.item, 'walk-in cooler probe');
  });
});

// ── action-engine outer try/catch surfaces handler exceptions ──────
//
// Pre-fix a thrown handler (e.g. a DB schema mismatch on a new table)
// was swallowed by the outer catch — response went 200 with the
// stripped LLM answer and no `actionExecuted` flag, so the caller
// silently saw a successful inference and the failed action was
// invisible. Post-fix: an `actionError: true` flag rides in the
// response body, `actionExecuted` is true, and `actionMsg` carries
// an operator-actionable string (no underlying exception text).

describe('kitchen-assistant action-engine — handler exception surfaces actionError', () => {
  it('surfaces actionError + actionExecuted when an action handler throws', async () => {
    // Inject a CHECK-constraint violation through the line_check
    // handler's INSERT. `clip(payload.status, 16) || 'na'` preserves
    // any short string the LLM emits, but line_check_entries.status
    // has CHECK(status IN ('pass','fail','na')). With a temp_point_id
    // of null (so the validate-temp branch is skipped) the INSERT
    // throws SQLITE_CONSTRAINT_CHECK inside the action engine.
    //
    // This avoids touching grounded-context-read tables (equipment,
    // gold_stars, inventory_updates) — buildGroundedContext is the
    // wrong system under test here. We want the outer try/catch
    // around the action handlers (route.js ~L644) to be exercised.
    const res = await POST(postReq({
      action: 'line_check',
      station: 'grill',
      item: 'walk-in cooler probe',
      status: 'INVALID_STATUS',     // violates CHECK(status IN (...))
      // no temp_point_id → validate-temp branch skipped; raw status hits INSERT
    }));
    assert.equal(res.status, 200, 'route still returns 200; the failure is in the body');
    const body = await res.json();
    assert.equal(body.actionExecuted, true, 'action attempt must be flagged');
    assert.equal(body.actionError, true, 'actionError flag must be set');
    assert.match(
      body.answer || '',
      /action failed/i,
      'answer should carry an operator-actionable failure note',
    );
    // Guardrail: don't leak the raw SQLite error text into the
    // cook-facing answer. PII / secret leak risk per audit fix 3.
    assert.doesNotMatch(
      body.answer || '',
      /CHECK constraint|SQLITE_/i,
      'underlying exception text must not leak to the cook-facing answer',
    );
    // And no line_check_entries row should land — the transaction
    // rolled back when the INSERT threw.
    assert.equal(countLineCheckEntries(), 0, 'transaction rolled back; no row');
  });
});
