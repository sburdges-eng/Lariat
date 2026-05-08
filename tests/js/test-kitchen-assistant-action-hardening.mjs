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
     DELETE FROM audit_events;`,
  );
});

const LOC = 'default';

function postReq(action, message = 'log this update') {
  stubbedAction = action;
  return new Request('http://localhost/api/kitchen-assistant', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: COOKIE_HEADER,
    },
    body: JSON.stringify({ message, location_id: LOC }),
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
