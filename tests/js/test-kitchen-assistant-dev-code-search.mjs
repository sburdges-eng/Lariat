#!/usr/bin/env node
// Route integration test for the LaRi dev-mode code_search read action.
//
// Run:
//   node --experimental-strip-types --test tests/js/test-kitchen-assistant-dev-code-search.mjs

import { describe, it, after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

register(new URL('./resolver.mjs', import.meta.url));

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-ka-code-search-'));
const TMP_DB = path.join(TMP_DIR, 'lariat-test.db');

const LOC = 'default';
const SESSION = '88888888-8888-4888-8888-888888888888';
const COOK = 'cook-code-search';

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_DEV_CODE_SEARCH = process.env.LARIAT_DEV_CODE_SEARCH;
const ORIGINAL_PIN = process.env.LARIAT_PIN;
const ORIGINAL_PIN_SECRET = process.env.LARIAT_PIN_SECRET;

process.env.LARIAT_PIN = '4242';
process.env.LARIAT_PIN_SECRET = 'test-secret-for-ka-code-search-suite';

let chatCalls = [];
let emittedPayload = {
  action: 'code_search',
  query: 'ollamaChat',
  glob: 'app/api/kitchen-assistant/**',
  limit: 4,
};

const db = await import('../../lib/db.ts');
const { signPinCookieValue } = await import('../../lib/pinCookie.ts');

db.setDbPathForTest(TMP_DB);
const testDb = db.getDb();

const route = await import('../../app/api/kitchen-assistant/route.js');
const { POST } = route;

function jsonResponse(payload) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function installFetchStub() {
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.endsWith('/api/chat')) {
      const body = JSON.parse(String(init?.body || '{}'));
      chatCalls.push(body);
      return jsonResponse({
        message: {
          content:
            '```json\n' +
            JSON.stringify(emittedPayload) +
            '\n```\nI checked the local code.',
        },
      });
    }
    return new Response('not stubbed', { status: 404 });
  };
}

async function signedCookie() {
  const signed = await signPinCookieValue(process.env.LARIAT_PIN_SECRET);
  return `lariat_pin_ok=${signed}`;
}

function lastUserPrompt() {
  const messages = chatCalls.at(-1)?.messages || [];
  return messages.find((m) => m.role === 'user')?.content || '';
}

function postReq({ cookie = null } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (cookie) headers.cookie = cookie;
  return new Request('http://localhost/api/kitchen-assistant', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      message: 'Where is ollamaChat used in the kitchen assistant route?',
      location_id: LOC,
      cook_id: COOK,
      conversation_session_id: SESSION,
    }),
  });
}

before(() => {
  installFetchStub();
});

beforeEach(() => {
  chatCalls = [];
  emittedPayload = {
    action: 'code_search',
    query: 'ollamaChat',
    glob: 'app/api/kitchen-assistant/**',
    limit: 4,
  };
  process.env.LARIAT_DEV_CODE_SEARCH = '1';
  testDb.exec(
    `DELETE FROM audit_events;
     DELETE FROM lari_conversation_turns;`,
  );
});

after(() => {
  db.setDbPathForTest(null);
  globalThis.fetch = ORIGINAL_FETCH;
  if (ORIGINAL_DEV_CODE_SEARCH === undefined) delete process.env.LARIAT_DEV_CODE_SEARCH;
  else process.env.LARIAT_DEV_CODE_SEARCH = ORIGINAL_DEV_CODE_SEARCH;
  if (ORIGINAL_PIN === undefined) delete process.env.LARIAT_PIN;
  else process.env.LARIAT_PIN = ORIGINAL_PIN;
  if (ORIGINAL_PIN_SECRET === undefined) delete process.env.LARIAT_PIN_SECRET;
  else process.env.LARIAT_PIN_SECRET = ORIGINAL_PIN_SECRET;
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('POST /api/kitchen-assistant code_search', () => {
  it('advertises and executes code_search only for manager dev mode', async () => {
    const res = await POST(postReq({ cookie: await signedCookie() }));
    assert.equal(res.status, 200);
    const body = await res.json();

    assert.match(lastUserPrompt(), /CODE SEARCH ACTION/);
    assert.equal(body.actionExecuted, true);
    assert.equal(body.actionError, false);
    assert.match(body.answer, /ACTION EXECUTED/);
    assert.match(body.answer, /Code search "ollamaChat"/);
    assert.equal(body.answer.includes(process.cwd()), false, 'answer must not leak absolute repo paths');
    assert.ok(
      body.sources.some((source) => source.type === 'code_search'),
      'response sources should record code_search',
    );

    const audit = testDb.prepare(
      `SELECT payload_json
         FROM audit_events
        WHERE entity = 'code_search'
        ORDER BY id DESC LIMIT 1`,
    ).get();
    assert.ok(audit, 'code_search should leave an audit view row');
    assert.doesNotMatch(audit.payload_json, /ollamaChat/, 'audit payload must not store raw search text');
    assert.match(audit.payload_json, /"hitCount":/);
  });

  it('does not advertise code_search to cook tier and blocks a hallucinated action before ripgrep', async () => {
    const res = await POST(postReq());
    assert.equal(res.status, 200);
    const body = await res.json();

    assert.doesNotMatch(lastUserPrompt(), /CODE SEARCH ACTION/);
    assert.equal(body.actionExecuted, true);
    assert.equal(body.actionError, false);
    assert.match(body.answer, /manager PIN required/i);
    assert.equal(body.answer.includes('app/api/kitchen-assistant/route.js'), false);
  });

  it('does not advertise code_search when the dev env flag is off and fails closed if emitted anyway', async () => {
    delete process.env.LARIAT_DEV_CODE_SEARCH;

    const res = await POST(postReq({ cookie: await signedCookie() }));
    assert.equal(res.status, 200);
    const body = await res.json();

    assert.doesNotMatch(lastUserPrompt(), /CODE SEARCH ACTION/);
    assert.equal(body.actionExecuted, true);
    assert.equal(body.actionError, false);
    assert.match(body.answer, /disabled/i);
    assert.equal(body.answer.includes('app/api/kitchen-assistant/route.js'), false);
  });
});
