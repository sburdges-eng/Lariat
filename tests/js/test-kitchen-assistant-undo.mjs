#!/usr/bin/env node
// Tests for slice 2.7 — kitchen-assistant 30-second undo surface.
//
// Pins the server half of the undo contract:
//
//   1. Successful single-row write actions (eighty_six, update_inventory,
//      line_check, maintenance, update_order_guide, give_gold_star) return
//      `undo` metadata: the audit row id, entity, entity id, a label, and
//      an expires_at exactly 30s after the write.
//   2. POST /api/kitchen-assistant/undo on an 86 marks the eighty_six row
//      resolved and writes an `action='correction'` audit row whose
//      `replaces_id` points at the original kitchen_assistant audit row.
//      The original audit row is never mutated (append-only trail).
//   3. Undo on a line check DELETEs the just-created line_check_entries row
//      inside the same transaction as the correction row.
//   4. Undo after the 30-second window is rejected cleanly (409).
//   5. A second undo of the same action is rejected cleanly (409) and does
//      not write a second correction row.
//   6. Batch-style actions (scale_recipe, beo_add_prep, generate_prep) that
//      do not create one concrete row never offer undo metadata.
//
// Same fetch-stub pattern as test-kitchen-assistant-action-hardening.mjs:
// the route's action handlers run deterministically post-LLM, so we only
// need `lib/ollama.ts::ollamaChat()` to return a fenced JSON action.
//
// Run:
//   node --experimental-strip-types --test tests/js/test-kitchen-assistant-undo.mjs

import { describe, it, after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

register(new URL('./resolver.mjs', import.meta.url));

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-ka-undo-'));
const TMP_DB = path.join(TMP_DIR, 'lariat-test.db');

// Every write action under test is PIN-gated, and so is the undo route.
// Mint a signed cookie at setup time using a fixed test secret.
const ORIGINAL_PIN = process.env.LARIAT_PIN;
const ORIGINAL_PIN_SECRET = process.env.LARIAT_PIN_SECRET;
process.env.LARIAT_PIN = '4242';
process.env.LARIAT_PIN_SECRET = 'test-secret-for-undo-suite';

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
const assistantRoute = await import('../../app/api/kitchen-assistant/route.js');
const undoRoute = await import('../../app/api/kitchen-assistant/undo/route.js');

db.setDbPathForTest(TMP_DB);
const testDb = db.getDb();

const POST = assistantRoute.POST;
const UNDO_POST = undoRoute.POST;

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
    `DELETE FROM eighty_six;
     DELETE FROM inventory_updates;
     DELETE FROM line_check_entries;
     DELETE FROM equipment;
     DELETE FROM equipment_maintenance;
     DELETE FROM order_guide_items;
     DELETE FROM gold_stars;
     DELETE FROM entities_employees;
     DELETE FROM beo_events;
     DELETE FROM beo_prep_tasks;
     DELETE FROM lari_conversation_turns;
     DELETE FROM audit_events;
     DELETE FROM idempotency_keys;`,
  );
});

const LOC = 'default';
const SESSION = '77777777-7777-4777-8777-777777777777';
const COOK = 'cook-undo-suite';
const UNDO_WINDOW_MS = 30_000;

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

function undoReq(body) {
  return new Request('http://localhost/api/kitchen-assistant/undo', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: COOKIE_HEADER,
    },
    body: JSON.stringify(body),
  });
}

async function runAction(action, message) {
  const res = await POST(postReq(action, message));
  assert.equal(res.status, 200);
  return res.json();
}

function getCorrections(originalAuditId) {
  return testDb
    .prepare("SELECT * FROM audit_events WHERE action = 'correction' AND replaces_id = ?")
    .all(originalAuditId);
}

function getAuditRow(id) {
  return testDb.prepare('SELECT * FROM audit_events WHERE id = ?').get(id);
}

function backdateAuditRow(id, seconds) {
  testDb
    .prepare("UPDATE audit_events SET created_at = datetime('now', ?) WHERE id = ?")
    .run(`-${seconds} seconds`, id);
}

function assertUndoMeta(undo, entity, { t0, t1 }) {
  assert.ok(undo && typeof undo === 'object', `undo metadata must be present for ${entity}`);
  assert.ok(Number.isInteger(undo.audit_event_id) && undo.audit_event_id > 0, 'audit_event_id is a positive integer');
  assert.equal(undo.entity, entity);
  assert.ok(Number.isInteger(undo.entity_id) && undo.entity_id > 0, 'entity_id is a positive integer');
  assert.ok(typeof undo.label === 'string' && undo.label.trim().length > 0, 'label is non-empty');
  const expiresMs = Date.parse(undo.expires_at);
  assert.ok(Number.isFinite(expiresMs), 'expires_at parses');
  assert.ok(
    expiresMs >= t0 + UNDO_WINDOW_MS && expiresMs <= t1 + UNDO_WINDOW_MS,
    `expires_at is exactly 30s after the write (got ${undo.expires_at}, window [${new Date(t0 + UNDO_WINDOW_MS).toISOString()}, ${new Date(t1 + UNDO_WINDOW_MS).toISOString()}])`,
  );
}

// ── 1. undo metadata on single-row write actions ─────────────────

describe('kitchen-assistant — undo metadata on single-row write actions', () => {
  it('eighty_six returns undo metadata pointing at the audit + source rows', async () => {
    const t0 = Date.now();
    const body = await runAction(
      { action: 'eighty_six', item: 'salmon', reason: 'out for the night' },
      '86 the salmon',
    );
    const t1 = Date.now();

    assert.equal(body.actionExecuted, true);
    assertUndoMeta(body.undo, 'eighty_six', { t0, t1 });

    const row = testDb.prepare('SELECT * FROM eighty_six WHERE id = ?').get(body.undo.entity_id);
    assert.ok(row, 'undo.entity_id points at the created eighty_six row');
    assert.equal(row.item, 'salmon');
    assert.equal(row.resolved_at, null, 'fresh 86 is unresolved');

    const audit = getAuditRow(body.undo.audit_event_id);
    assert.ok(audit, 'undo.audit_event_id points at a real audit row');
    assert.equal(audit.entity, 'eighty_six');
    assert.equal(audit.action, 'insert');
    assert.equal(audit.actor_source, 'kitchen_assistant');
  });

  it('line_check returns undo metadata for the created entry', async () => {
    const t0 = Date.now();
    const body = await runAction(
      { action: 'line_check', station: 'grill', item: 'cooler gasket', status: 'pass' },
      'log a line check for the cooler gasket',
    );
    const t1 = Date.now();

    assert.equal(body.actionExecuted, true);
    assertUndoMeta(body.undo, 'line_check_entries', { t0, t1 });

    const row = testDb
      .prepare('SELECT * FROM line_check_entries WHERE id = ?')
      .get(body.undo.entity_id);
    assert.ok(row, 'undo.entity_id points at the created line_check_entries row');
    assert.equal(row.item, 'cooler gasket');
  });

  it('update_inventory, update_order_guide, give_gold_star, maintenance all return undo metadata', async () => {
    // maintenance needs a resolvable equipment row.
    testDb
      .prepare('INSERT INTO equipment (location_id, name, category) VALUES (?, ?, ?)')
      .run(LOC, 'Walk-in Cooler', 'refrigeration');

    const cases = [
      {
        action: { action: 'update_inventory', item: 'cilantro', delta: 3, unit: 'bunch', direction: 'out' },
        entity: 'inventory_updates',
        table: 'inventory_updates',
      },
      {
        action: { action: 'update_order_guide', item: 'shallots', qty: 5, unit: 'lb' },
        entity: 'order_guide_items',
        table: 'order_guide_items',
      },
      {
        // entities_employees is empty → fresh-DB roster fallback lets it through.
        action: { action: 'give_gold_star', cook_name: 'Alice', stars: 2, reason: 'crushed brunch' },
        entity: 'gold_stars',
        table: 'gold_stars',
      },
      {
        action: { action: 'maintenance', equipment: 'Walk-in Cooler', issue: 'door seal torn' },
        entity: 'equipment_maintenance',
        table: 'equipment_maintenance',
      },
    ];

    for (const c of cases) {
      const t0 = Date.now();
      const body = await runAction(c.action);
      const t1 = Date.now();
      assert.equal(body.actionExecuted, true, `${c.entity}: action executed`);
      assertUndoMeta(body.undo, c.entity, { t0, t1 });
      const row = testDb
        .prepare(`SELECT id FROM ${c.table} WHERE id = ?`)
        .get(body.undo.entity_id);
      assert.ok(row, `${c.entity}: undo.entity_id points at the created source row`);
    }
  });
});

// ── 2. 86 undo: resolve + correction row ─────────────────────────

describe('POST /api/kitchen-assistant/undo — eighty_six', () => {
  it('resolves the 86 row and writes a correction audit row linked by replaces_id', async () => {
    const body = await runAction(
      { action: 'eighty_six', item: 'salmon', reason: 'out' },
      '86 the salmon',
    );
    const { audit_event_id: auditId, entity_id: rowId } = body.undo;

    const res = await UNDO_POST(undoReq({ undo_audit_id: auditId, location_id: LOC, cook_id: COOK }));
    assert.equal(res.status, 200);
    const undoBody = await res.json();
    assert.equal(undoBody.ok, true);
    assert.match(undoBody.message || '', /back on/i, 'kitchen-native success copy');

    // Source row is resolved, not deleted — the 86 board history stays.
    const row = testDb.prepare('SELECT * FROM eighty_six WHERE id = ?').get(rowId);
    assert.ok(row, '86 row still exists');
    assert.ok(row.resolved_at, '86 row is marked resolved');

    // Append-only audit trail: correction row with replaces_id, original untouched.
    const corrections = getCorrections(auditId);
    assert.equal(corrections.length, 1, 'exactly one correction row');
    const correction = corrections[0];
    assert.equal(correction.entity, 'eighty_six');
    assert.equal(correction.entity_id, rowId);
    assert.equal(correction.replaces_id, auditId);
    assert.equal(correction.actor_source, 'kitchen_assistant_undo');
    assert.equal(Number.isInteger(undoBody.correctedAuditId) ? undoBody.correctedAuditId : null, correction.id);

    const original = getAuditRow(auditId);
    assert.equal(original.action, 'insert', 'original audit row is never mutated');
  });
});

// ── 3. line check undo: delete + correction row ──────────────────

describe('POST /api/kitchen-assistant/undo — line_check_entries', () => {
  it('deletes the created row and writes a correction audit row in the same transaction', async () => {
    const body = await runAction(
      { action: 'line_check', station: 'grill', item: 'cooler gasket', status: 'pass' },
      'log a line check',
    );
    const { audit_event_id: auditId, entity_id: rowId } = body.undo;

    const res = await UNDO_POST(undoReq({ undo_audit_id: auditId, location_id: LOC, cook_id: COOK }));
    assert.equal(res.status, 200);
    const undoBody = await res.json();
    assert.equal(undoBody.ok, true);

    const row = testDb.prepare('SELECT * FROM line_check_entries WHERE id = ?').get(rowId);
    assert.equal(row, undefined, 'line check row is removed');

    const corrections = getCorrections(auditId);
    assert.equal(corrections.length, 1, 'exactly one correction row');
    assert.equal(corrections[0].entity, 'line_check_entries');
    assert.equal(corrections[0].entity_id, rowId);
    // The correction payload preserves what was removed — the inspector
    // can still reconstruct the entry from the audit trail alone.
    const payload = JSON.parse(corrections[0].payload_json);
    assert.equal(payload.before.item, 'cooler gasket');
    assert.equal(payload.after, null);
  });
});

// ── 4. 30s expiry ────────────────────────────────────────────────

describe('POST /api/kitchen-assistant/undo — expiry', () => {
  it('rejects an undo after the 30-second window with 409 and no state change', async () => {
    const body = await runAction(
      { action: 'eighty_six', item: 'brisket', reason: 'gone' },
      '86 the brisket',
    );
    const { audit_event_id: auditId, entity_id: rowId } = body.undo;

    backdateAuditRow(auditId, 61);

    const res = await UNDO_POST(undoReq({ undo_audit_id: auditId, location_id: LOC, cook_id: COOK }));
    assert.equal(res.status, 409);
    const undoBody = await res.json();
    assert.match(undoBody.error || '', /time ran out/i);

    const row = testDb.prepare('SELECT * FROM eighty_six WHERE id = ?').get(rowId);
    assert.equal(row.resolved_at, null, '86 row stays unresolved');
    assert.equal(getCorrections(auditId).length, 0, 'no correction row written');
  });
});

// ── 5. double undo ───────────────────────────────────────────────

describe('POST /api/kitchen-assistant/undo — double undo', () => {
  it('rejects a second undo of the same action with 409 and a single correction row', async () => {
    const body = await runAction(
      { action: 'line_check', station: 'grill', item: 'gasket', status: 'pass' },
      'log a line check',
    );
    const auditId = body.undo.audit_event_id;

    const first = await UNDO_POST(undoReq({ undo_audit_id: auditId, location_id: LOC, cook_id: COOK }));
    assert.equal(first.status, 200);

    const second = await UNDO_POST(undoReq({ undo_audit_id: auditId, location_id: LOC, cook_id: COOK }));
    assert.equal(second.status, 409);
    const secondBody = await second.json();
    assert.match(secondBody.error || '', /already/i);

    assert.equal(getCorrections(auditId).length, 1, 'still exactly one correction row');
  });
});

// ── 6. batch actions never offer undo ────────────────────────────

describe('kitchen-assistant — batch actions offer no undo metadata', () => {
  it('generate_prep (multi-row insert) returns undo: null', async () => {
    const body = await runAction(
      {
        action: 'generate_prep',
        station: 'grill',
        tasks: [{ item: 'dice onions', need: '2 qt' }, { item: 'pickle shallots', need: '1 qt' }],
      },
      'generate prep for the grill',
    );
    assert.equal(body.actionExecuted, true);
    assert.equal(body.undo, null, 'no undo metadata for generate_prep');
    const c = testDb.prepare('SELECT COUNT(*) AS c FROM line_check_entries').get().c;
    assert.equal(c, 2, 'prep rows landed — success path, not a soft-reject');
  });

  it('beo_add_prep (multi-row insert) returns undo: null', async () => {
    const info = testDb
      .prepare('INSERT INTO beo_events (title, guest_count, location_id) VALUES (?, ?, ?)')
      .run('Test Wedding', 50, LOC);
    const eventId = Number(info.lastInsertRowid);

    const body = await runAction(
      { action: 'beo_add_prep', event_id: eventId, tasks: ['Sheet trays of focaccia'] },
      'add prep to the BEO',
    );
    assert.equal(body.actionExecuted, true);
    assert.equal(body.undo, null, 'no undo metadata for beo_add_prep');
    const c = testDb.prepare('SELECT COUNT(*) AS c FROM beo_prep_tasks WHERE event_id = ?').get(eventId).c;
    assert.equal(c, 1, 'prep task landed — success path, not a soft-reject');
  });

  it('scale_recipe returns undo: null', async () => {
    // multiplier 0 takes the deterministic soft-reject path (no python
    // subprocess); the scale_recipe handler never builds undo metadata
    // on any path — there is no buildKitchenAssistantUndoMeta call there.
    const body = await runAction(
      { action: 'scale_recipe', recipe: 'focaccia', multiplier: 0 },
      'scale the focaccia',
    );
    assert.equal(body.actionExecuted, true);
    assert.equal(body.undo, null, 'no undo metadata for scale_recipe');
  });
});
