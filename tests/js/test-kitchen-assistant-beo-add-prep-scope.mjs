#!/usr/bin/env node
// Tests for the security gap surfaced during T5 spec review:
// /api/kitchen-assistant's `beo_add_prep` LLM action did NOT confirm
// that the event_id supplied by the model belonged to the requesting
// locationId before inserting `beo_prep_tasks` rows. That meant a
// cook (or a hallucinating model) at location A could plant prep
// tasks against an event at location B — leaking location-B operational
// state into A's worksheets and mutating B's planning data.
//
// Pins:
//   1. Cross-location attempt (locationId=B, event lives at A) is
//      REJECTED — no row appears in beo_prep_tasks, the response
//      surfaces the rejection in the `answer` field via the same
//      "soft reject" pattern other handlers use (actionMsg embedded
//      after the "⚡ ACTION EXECUTED:" prefix).
//   2. Same-location request (locationId=A, event lives at A) DOES
//      succeed — the row lands and the response signals success.
//   3. Unknown event_id (no row) is REJECTED — same shape as (1).
//
// Stubs:
//   - globalThis.fetch is replaced so lib/ollama.ts's `ollamaChat()`
//     returns a deterministic fenced JSON action without contacting a
//     real Ollama server. CLAUDE.md forbids mocking SQLite, but mocking
//     the upstream LLM is required — we have no Ollama in the test
//     harness, and the fix lives entirely in the route's deterministic
//     post-LLM compute path.
//
// Run:
//   node --experimental-strip-types --test tests/js/test-kitchen-assistant-beo-add-prep-scope.mjs

import { describe, it, after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

register(new URL('./resolver.mjs', import.meta.url));

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-ka-beo-prep-'));
const TMP_DB = path.join(TMP_DIR, 'lariat-test.db');

// PIN gate: post-PR #184, KA write actions require a valid HMAC-signed
// `lariat_pin_ok` cookie (not the legacy `x-lariat-pin` header). Mirror
// the same migration applied to test-kitchen-assistant-action-hardening.mjs:
// set LARIAT_PIN_SECRET, mint a signed cookie at module load, and send
// it on every postReq() so the cross-location guard downstream is the
// gate actually being exercised.
const ORIGINAL_PIN = process.env.LARIAT_PIN;
const ORIGINAL_PIN_SECRET = process.env.LARIAT_PIN_SECRET;
process.env.LARIAT_PIN = '4242';
process.env.LARIAT_PIN_SECRET = 'test-secret-for-ka-beo-prep-scope-suite';

const { signPinCookieValue } = await import('../../lib/pinCookie.ts');
const SIGNED_PIN_COOKIE = await signPinCookieValue(process.env.LARIAT_PIN_SECRET);
const COOKIE_HEADER = `lariat_pin_ok=${SIGNED_PIN_COOKIE}`;

// Stub Ollama: lib/ollama.ts hits POST /api/chat. Return a fenced
// JSON action shaped exactly like the LLM would emit for "Add BEO
// Prep". The route's extractAction() pulls the JSON out and runs the
// deterministic guard we are testing.
const ORIGINAL_FETCH = globalThis.fetch;
let stubbedAction = null; // mutated per-test to vary event_id
function installFetchStub() {
  globalThis.fetch = async (url /* , init */) => {
    const u = String(url);
    if (u.endsWith('/api/chat')) {
      const content =
        '```json\n' + JSON.stringify(stubbedAction) + '\n```\n' +
        'OK — added the prep tasks.';
      return new Response(JSON.stringify({ message: { content } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    // Anything else (datapack pings etc.) returns a benign 404 so we
    // don't accidentally exercise the network in tests.
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
    `DELETE FROM beo_prep_tasks; DELETE FROM beo_line_items; DELETE FROM beo_events; DELETE FROM lari_conversation_turns; DELETE FROM audit_events;`,
  );
});

const LOC_A = 'site-a';
const LOC_B = 'site-b';
const SESSION = '44444444-4444-4444-8444-444444444444';
const COOK = 'cook-beo-prep';

function seedEvent(locationId, title) {
  const info = testDb
    .prepare(
      `INSERT INTO beo_events (title, event_date, guest_count, location_id, created_at)
       VALUES (?, ?, ?, ?, datetime('now'))`,
    )
    .run(title, '2026-08-15', 50, locationId);
  return Number(info.lastInsertRowid);
}

function postReq({ locationId, eventId, message = 'add prep for tonight' }) {
  stubbedAction = {
    action: 'beo_add_prep',
    event_id: eventId,
    tasks: ['Slice 5 lb of onions', 'Portion 60 brisket plates'],
    // Intentionally NO `recipes` array — that triggers the previously-
    // unguarded path that this fix closes. Same-location case below
    // also runs through this branch, demonstrating the success path.
  };
  return new Request('http://localhost/api/kitchen-assistant', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      // Post-#184: KA write actions require a signed lariat_pin_ok cookie
      // (the legacy x-lariat-pin header is dead). Same gate every
      // regulated mutation route uses.
      cookie: COOKIE_HEADER,
    },
    body: JSON.stringify({
      message,
      location_id: locationId,
      cook_id: COOK,
      conversation_session_id: SESSION,
    }),
  });
}

function countPrepTasks(eventId) {
  const row = testDb
    .prepare(`SELECT COUNT(*) as cnt FROM beo_prep_tasks WHERE event_id = ?`)
    .get(eventId);
  return row?.cnt ?? 0;
}

// ── Cross-location attempt: REJECTED ──────────────────────────────

describe('POST /api/kitchen-assistant — beo_add_prep cross-location guard', () => {
  it('REJECTS a beo_add_prep whose event_id belongs to a foreign location', async () => {
    const eventA = seedEvent(LOC_A, 'Site A Wedding');
    // LOC_B requesting; event lives at LOC_A. Pre-fix: tasks would be
    // inserted with location_id=B, event_id=A. Post-fix: refused.
    const res = await POST(postReq({ locationId: LOC_B, eventId: eventA }));
    assert.equal(res.status, 200, 'route uses soft-reject pattern (200 + actionMsg in answer)');
    const body = await res.json();

    // No row was inserted under the foreign event_id.
    assert.equal(
      countPrepTasks(eventA),
      0,
      'cross-location beo_add_prep MUST NOT insert into beo_prep_tasks',
    );
    // And nothing under the requesting location either.
    const anyForLocB = testDb
      .prepare(`SELECT COUNT(*) as cnt FROM beo_prep_tasks WHERE location_id = ?`)
      .get(LOC_B);
    assert.equal(anyForLocB.cnt, 0, 'no prep_tasks row should land for the requesting location');

    // Surface check: matches the soft-reject convention used by
    // `maintenance` ("Could not find equipment …") and `eighty_six`
    // ("Hold on — order guide shows…"). The actionMsg lives inside
    // `answer` after the "⚡ ACTION EXECUTED:" prefix the route
    // unconditionally prepends when actionExecuted=true.
    assert.match(
      body.answer,
      /ACTION EXECUTED/,
      'response should mark that an action attempt was processed',
    );
    assert.match(
      body.answer,
      /blocked/i,
      'response should surface the rejection (matches existing soft-reject style)',
    );
    assert.match(
      body.answer,
      /different location|cross-location/i,
      'response should explain the cross-location rejection',
    );
  });

  it('REJECTS a beo_add_prep whose event_id does not exist', async () => {
    // Seed an unrelated event so the table isn't empty, but ask for
    // a different (nonexistent) id.
    seedEvent(LOC_A, 'Site A Wedding');
    const ghostEventId = 999999;
    const res = await POST(postReq({ locationId: LOC_A, eventId: ghostEventId }));
    assert.equal(res.status, 200);
    const body = await res.json();

    const stillEmpty = testDb
      .prepare(`SELECT COUNT(*) as cnt FROM beo_prep_tasks`)
      .get();
    assert.equal(stillEmpty.cnt, 0, 'no row inserted when event_id does not exist');

    assert.match(body.answer, /blocked/i);
    assert.match(body.answer, /does not exist|not found/i);
  });
});

// ── Same-location: SUCCEEDS (control) ─────────────────────────────

describe('POST /api/kitchen-assistant — beo_add_prep happy path (control)', () => {
  it('inserts prep tasks when the event_id belongs to the requesting locationId', async () => {
    const eventA = seedEvent(LOC_A, 'Site A Wedding');
    const res = await POST(postReq({ locationId: LOC_A, eventId: eventA }));
    assert.equal(res.status, 200);
    const body = await res.json();

    const rows = testDb
      .prepare(
        `SELECT location_id, event_id, task FROM beo_prep_tasks WHERE event_id = ? ORDER BY id ASC`,
      )
      .all(eventA);
    assert.equal(rows.length, 2, 'both stub tasks should land for a same-location request');
    for (const r of rows) {
      assert.equal(r.location_id, LOC_A, 'inserted row carries requesting locationId');
      assert.equal(r.event_id, eventA, 'inserted row carries the validated event_id');
    }

    assert.match(body.answer, /ACTION EXECUTED/);
    assert.match(
      body.answer,
      /Added 2 .*side-prep tasks to BEO ID/,
      'response should confirm the insert (matches existing actionMsg shape)',
    );
  });
});
