#!/usr/bin/env node
// Tests for the 2026-05-08 kitchen-assistant PIN-bypass fix.
//
// Pre-fix the KA route accepted a manager PIN via the `x-lariat-pin`
// HTTP header and compared it to `process.env.LARIAT_PIN` with a naked
// `===`. That path was:
//   1. Timing-attackable (byte-by-byte) on a low-jitter LAN.
//   2. Un-rate-limited (only /api/auth/pin has the 5/60s limiter).
//   3. Plaintext on every request, leaking through any proxy/log.
// It also bypassed the HMAC-signed `lariat_pin_ok` cookie scheme
// (PR #182 hardening) entirely.
//
// Fix: replace the header path with `await hasPinCookie(req)`. Cookie
// is the same auth ticket every other regulated mutation route uses.
//
// Three pinned behaviors:
//   1. write-action POST with NO cookie + NO header → soft-blocked.
//   2. write-action POST with the legacy `x-lariat-pin` header set
//      to the correct PIN, but no cookie → STILL soft-blocked
//      (regression test: the header path is dead).
//   3. write-action POST with a valid HMAC-signed `lariat_pin_ok`
//      cookie → action runs end-to-end (eighty_six row landed).
//
// Run:
//   node --experimental-strip-types --test tests/js/test-kitchen-assistant-pin-gate.mjs

import { describe, it, after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

register(new URL('./resolver.mjs', import.meta.url));

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-ka-pin-gate-'));
const TMP_DB = path.join(TMP_DIR, 'lariat-test.db');

const ORIGINAL_PIN = process.env.LARIAT_PIN;
const ORIGINAL_SECRET = process.env.LARIAT_PIN_SECRET;
process.env.LARIAT_PIN = '4242';
// Set a real secret so we exercise the signed-cookie verification path
// rather than the legacy unsigned fallback.
process.env.LARIAT_PIN_SECRET = 'test-secret-for-ka-pin-gate-32bytes!';

const ORIGINAL_FETCH = globalThis.fetch;
let stubbedAction = null;
let chatFetchCalls = 0;
function installFetchStub() {
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.endsWith('/api/chat')) {
      chatFetchCalls += 1;
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
const pinCookie = await import('../../lib/pinCookie.ts');

db.setDbPathForTest(TMP_DB);
const testDb = db.getDb();

const { POST } = route;

after(() => {
  db.setDbPathForTest(null);
  globalThis.fetch = ORIGINAL_FETCH;
  if (ORIGINAL_PIN === undefined) delete process.env.LARIAT_PIN;
  else process.env.LARIAT_PIN = ORIGINAL_PIN;
  if (ORIGINAL_SECRET === undefined) delete process.env.LARIAT_PIN_SECRET;
  else process.env.LARIAT_PIN_SECRET = ORIGINAL_SECRET;
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

before(() => {
  installFetchStub();
});

beforeEach(() => {
  chatFetchCalls = 0;
  testDb.exec(
    `DELETE FROM eighty_six;
     DELETE FROM lari_conversation_turns;
     DELETE FROM audit_events;`,
  );
});

const LOC = 'default';
const SESSION = '33333333-3333-4333-8333-333333333333';
const COOK = 'cook-pin-gate';

function countEightySix() {
  return testDb.prepare('SELECT COUNT(*) AS c FROM eighty_six').get().c;
}

function makeReq(action, { cookie = null, headerPin = null, message = 'eighty-six the salmon' } = {}) {
  stubbedAction = action;
  const headers = { 'content-type': 'application/json' };
  if (headerPin !== null) headers['x-lariat-pin'] = headerPin;
  if (cookie !== null) headers.cookie = cookie;
  return new Request('http://localhost/api/kitchen-assistant', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      message,
      location_id: LOC,
      cook_id: COOK,
      conversation_session_id: SESSION,
    }),
  });
}

const EIGHTY_SIX_ACTION = {
  action: 'eighty_six',
  item: 'salmon',
  reason: 'sold out',
};

// ── 1. No auth at all → short-circuit before Ollama ─────────────────
//
// Two contracts pinned at once:
//   * 2026-05-08 PIN gate: regulated mutations must not run without a PIN.
//   * #248: that block now happens BEFORE the LLM call. Earlier the route
//     ran Ollama first and let the action handler soft-block — wasted
//     compute on every blocked attempt, plus "MGMNT ALERT" log entries
//     from rate-limit-free LAN abuse. New contract: model='pin-required',
//     actionExecuted=false, AND no /api/chat fetch happened at all.

describe('kitchen-assistant PIN gate — no auth short-circuits before LLM (#248)', () => {
  it('blocks write action and skips Ollama when neither cookie nor header is present', async () => {
    const res = await POST(makeReq(EIGHTY_SIX_ACTION));
    assert.equal(res.status, 200, 'soft-block contract: 200 + blocked message');
    const body = await res.json();
    assert.equal(body.model, 'pin-required', 'response should be marked as PIN-required');
    assert.equal(body.actionExecuted, false, 'no action should be reported as executed');
    assert.equal(body.actionError, false, 'no action error either — the block is policy, not failure');
    assert.match(
      body.answer || '',
      /ask a manager/i,
      'response should tell the cook to ask a manager',
    );
    assert.equal(countEightySix(), 0, 'no eighty_six row landed');
    assert.equal(
      chatFetchCalls,
      0,
      '#248: Ollama must not be called for un-PIN\'d imperative commands',
    );
  });
});

// ── 2. Legacy header path is DEAD (regression) ───────────────────────

describe('kitchen-assistant PIN gate — legacy x-lariat-pin header is dead', () => {
  it('short-circuits even when x-lariat-pin matches LARIAT_PIN (no cookie)', async () => {
    const res = await POST(
      makeReq(EIGHTY_SIX_ACTION, { headerPin: '4242' }),
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.model, 'pin-required', 'header path must NOT grant authority');
    assert.equal(body.actionExecuted, false);
    assert.equal(
      countEightySix(),
      0,
      'no eighty_six row should land via the dead header path',
    );
    assert.equal(
      chatFetchCalls,
      0,
      '#248: Ollama must not be called even when the legacy header is set',
    );
  });
});

// ── 3. Valid signed cookie → action runs ─────────────────────────────

describe('kitchen-assistant PIN gate — valid signed cookie', () => {
  it('executes a write action end-to-end with a valid lariat_pin_ok cookie', async () => {
    const signed = await pinCookie.signPinCookieValue(process.env.LARIAT_PIN_SECRET);
    const cookie = `lariat_pin_ok=${signed}`;
    const res = await POST(makeReq(EIGHTY_SIX_ACTION, { cookie }));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.match(
      body.answer || '',
      /Marked salmon as 86'd/i,
      'action confirmation should appear in the answer',
    );
    assert.equal(countEightySix(), 1, 'eighty_six row landed');
    const row = testDb
      .prepare('SELECT item, reason FROM eighty_six ORDER BY id DESC LIMIT 1')
      .get();
    assert.equal(row.item, 'salmon');
    assert.equal(row.reason, 'sold out');
  });
});
