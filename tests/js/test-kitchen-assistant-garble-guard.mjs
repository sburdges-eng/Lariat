#!/usr/bin/env node
// Route-level tests for the degenerate-output guard in
// app/api/kitchen-assistant/route.js.
//
// tests/js/test-extract-action.mjs already pins isDegenerateAnswer as a pure
// function. What was never covered is WHERE the route runs it, and that
// placement is the whole safety property: the guard replaces the entire
// answer, so if it runs after the `⚡ ACTION EXECUTED:` prefix is prepended,
// a garbled model epilogue swallows the confirmation of a write that already
// landed. The cook is then told "ask me again" for an 86 / inventory move
// that is already in the ledger, and re-issues it.
//
// The same ordering also protects the two soft-reject messages — "Action
// blocked …" and "Action failed unexpectedly. Show a manager …" — which are
// the only signal a cook gets that a write did NOT happen.
//
// LariatNative's KitchenAssistantEngine.swift has always guarded before
// prefixing (its comment claims web parity that did not exist). These tests
// pin the web side to that order.
//
// Same fetch-stub pattern as test-kitchen-assistant-action-hardening.mjs.
//
// Run:
//   node --experimental-strip-types --test tests/js/test-kitchen-assistant-garble-guard.mjs

import { describe, it, after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

register(new URL('./resolver.mjs', import.meta.url));

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-ka-garble-guard-'));
const TMP_DB = path.join(TMP_DIR, 'lariat-test.db');

const ORIGINAL_PIN = process.env.LARIAT_PIN;
const ORIGINAL_PIN_SECRET = process.env.LARIAT_PIN_SECRET;
process.env.LARIAT_PIN = '4242';
process.env.LARIAT_PIN_SECRET = 'test-secret-for-garble-guard-suite';

const { signPinCookieValue } = await import('../../lib/pinCookie');
const signedPinCookie = await signPinCookieValue(process.env.LARIAT_PIN_SECRET);
const COOKIE_HEADER = `lariat_pin_ok=${signedPinCookie}`;

// The 2026-08-31 venue find, verbatim in shape: asked about "pico" the model
// mimicked the CONTEXT's XML and looped until the token cap. Twelve tags trips
// isDegenerateAnswer's tag signal (>= 5) and its repeat signal (>= 4) both.
const GARBLED_EPILOGUE = Array(12)
  .fill('<ingredient name="diced shallot" />')
  .join('\n');

const CLEAN_EPILOGUE = 'Logged it. Cilantro is down 3 bunch.';

const GARBLED_COPY_RE = /came out garbled/i;
const CONFIRMATION_RE = /⚡ ACTION EXECUTED/;

const ORIGINAL_FETCH = globalThis.fetch;
let stubbedAction = null;
let stubbedEpilogue = CLEAN_EPILOGUE;
function installFetchStub() {
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.endsWith('/api/chat')) {
      const content =
        (stubbedAction ? '```json\n' + JSON.stringify(stubbedAction) + '\n```\n' : '') +
        stubbedEpilogue;
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
  stubbedAction = null;
  stubbedEpilogue = CLEAN_EPILOGUE;
  testDb.exec(
    `DELETE FROM inventory_updates;
     DELETE FROM lari_conversation_turns;
     DELETE FROM audit_events;`,
  );
});

const LOC = 'default';
const SESSION = '66666666-6666-4666-8666-666666666666';
const COOK = 'cook-garble-guard';

// Actions only run when the message classifies as an imperative command
// (lib/cookMessageClassifier.ts), so every action case here leads with a verb.
function postReq(action, epilogue, message = 'log inventory: cilantro down 3 bunch') {
  stubbedAction = action;
  stubbedEpilogue = epilogue;
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
function lastStoredAnswer() {
  const row = testDb
    .prepare('SELECT assistant_content FROM lari_conversation_turns ORDER BY id DESC LIMIT 1')
    .get();
  return row ? row.assistant_content : null;
}

const GOOD_INVENTORY_ACTION = {
  action: 'update_inventory',
  item: 'cilantro',
  delta: 3,
  unit: 'bunch',
  direction: 'out',
};

// ── the regression: a garbled epilogue must not eat the confirmation ──

describe('kitchen-assistant garble guard — executed write keeps its confirmation', () => {
  it('keeps ⚡ ACTION EXECUTED when the model epilogue is degenerate', async () => {
    const res = await POST(postReq(GOOD_INVENTORY_ACTION, GARBLED_EPILOGUE));
    assert.equal(res.status, 200);
    const body = await res.json();

    assert.equal(countInventoryUpdates(), 1, 'the write landed — this is the premise');
    assert.match(
      body.answer || '',
      CONFIRMATION_RE,
      'the cook must still see that the write happened; otherwise they re-issue it',
    );
    assert.match(body.answer || '', /cilantro/i, 'the action message survives too');
    assert.match(
      body.answer || '',
      GARBLED_COPY_RE,
      'the garbled prose is still replaced with the honest line',
    );
    assert.doesNotMatch(
      body.answer || '',
      /<ingredient/,
      'no raw model garbage reaches the cook',
    );
    assert.equal(body.actionExecuted, true);
  });

  it('stores the confirmation in conversation memory, not just in the response', async () => {
    await POST(postReq(GOOD_INVENTORY_ACTION, GARBLED_EPILOGUE));
    const stored = lastStoredAnswer();
    assert.ok(stored, 'a turn was stored');
    assert.match(
      stored,
      CONFIRMATION_RE,
      'the audit trail must not lose the write confirmation either',
    );
  });

  it('keeps the soft-reject message when a BLOCKED action gets a degenerate epilogue', async () => {
    const res = await POST(
      postReq(
        { ...GOOD_INVENTORY_ACTION, delta: '3 bunches' }, // non-finite → soft reject
        GARBLED_EPILOGUE,
        'log inventory: cilantro down 3 bunches',
      ),
    );
    assert.equal(res.status, 200);
    const body = await res.json();

    assert.equal(countInventoryUpdates(), 0, 'nothing was written — this is the premise');
    assert.match(
      body.answer || '',
      /blocked/i,
      '"nothing was logged" is the only signal the cook gets that the write failed',
    );
  });
});

// ── no regression in the behavior the guard already had ──

describe('kitchen-assistant garble guard — unchanged behavior', () => {
  it('passes clean prose through alongside the confirmation', async () => {
    const res = await POST(postReq(GOOD_INVENTORY_ACTION, CLEAN_EPILOGUE));
    const body = await res.json();
    assert.match(body.answer || '', CONFIRMATION_RE);
    assert.match(body.answer || '', /Cilantro is down 3 bunch/);
    assert.doesNotMatch(body.answer || '', GARBLED_COPY_RE, 'clean prose is not flagged');
  });

  it('still replaces a degenerate answer when no action ran', async () => {
    // Not a recipe lookup: tryDirectRecipeAnswer answers those deterministically
    // before the LLM, so a recipe question would never reach the guard at all.
    const res = await POST(postReq(null, GARBLED_EPILOGUE, 'how did service go last night'));
    const body = await res.json();
    assert.match(body.answer || '', GARBLED_COPY_RE);
    assert.doesNotMatch(body.answer || '', /<ingredient/);
    assert.doesNotMatch(
      body.answer || '',
      CONFIRMATION_RE,
      'no action ran, so no confirmation is invented',
    );
  });
});
