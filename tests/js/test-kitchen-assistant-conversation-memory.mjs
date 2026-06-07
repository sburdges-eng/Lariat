#!/usr/bin/env node
// Route integration tests for LaRi conversation memory.
//
// Run:
//   node --experimental-strip-types --test tests/js/test-kitchen-assistant-conversation-memory.mjs

import { describe, it, after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

register(new URL('./resolver.mjs', import.meta.url));

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-ka-conversation-memory-'));
const TMP_DB = path.join(TMP_DIR, 'lariat-test.db');

const SESSION = '11111111-1111-4111-8111-111111111111';
const SECOND_SESSION = '22222222-2222-4222-8222-222222222222';
const LOC = 'west';
const COOK = 'cook-alex';
const MINUTE_MS = 60 * 1000;

const ORIGINAL_PIN = process.env.LARIAT_PIN;
const ORIGINAL_PIN_SECRET = process.env.LARIAT_PIN_SECRET;
process.env.LARIAT_PIN = '4242';
process.env.LARIAT_PIN_SECRET = 'test-secret-for-ka-conversation-memory-suite';

const ORIGINAL_FETCH = globalThis.fetch;
let chatFetchCalls = 0;
let lastUserPrompt = '';
let stubbedContent = 'Plain visible answer.';

function installFetchStub() {
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (u.endsWith('/api/chat')) {
      chatFetchCalls += 1;
      const body = JSON.parse(String(init?.body || '{}'));
      const user = body.messages?.findLast?.((m) => m.role === 'user')
        || [...(body.messages || [])].reverse().find((m) => m.role === 'user');
      lastUserPrompt = user?.content || '';
      return new Response(JSON.stringify({ message: { content: stubbedContent } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response('not stubbed', { status: 404 });
  };
}

const db = await import('../../lib/db.ts');
const route = await import('../../app/api/kitchen-assistant/route.js');
const memory = await import('../../lib/lariConversationMemory.ts');
const { signPinCookieValue } = await import('../../lib/pinCookie.ts');

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
  chatFetchCalls = 0;
  lastUserPrompt = '';
  stubbedContent = 'Plain visible answer.';
  testDb.exec('DELETE FROM lari_conversation_turns;');
});

function postReq({
  message = 'What should I prep next?',
  locationId = LOC,
  cookId = COOK,
  sessionId = SESSION,
  cookie = null,
  includeSession = true,
} = {}) {
  const headers = { 'content-type': 'application/json' };
  if (cookie !== null) headers.cookie = cookie;
  const body = {
    message,
    location_id: locationId,
    cook_id: cookId,
  };
  if (includeSession) body.conversation_session_id = sessionId;
  return new Request('http://localhost/api/kitchen-assistant', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

function seedTurn({
  locationId = LOC,
  cookId = COOK,
  sessionId = SESSION,
  userContent,
  assistantContent,
  managerTier = false,
  createdAt = new Date(Date.now() - 60 * MINUTE_MS).toISOString(),
}) {
  memory.storeConversationTurn(testDb, {
    locationId,
    cookId,
    sessionId,
    userContent,
    assistantContent,
    managerTier,
    createdAt,
  });
}

function storedTurns() {
  return testDb
    .prepare(
      `SELECT user_content, assistant_content, manager_tier
         FROM lari_conversation_turns
        ORDER BY id ASC`,
    )
    .all();
}

describe('POST /api/kitchen-assistant conversation memory', () => {
  it('returns 400 without conversation_session_id and does not call Ollama', async () => {
    const res = await POST(postReq({ includeSession: false }));
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.error || '', /conversation_session_id/i);
    assert.equal(chatFetchCalls, 0, 'Ollama must not run when session validation fails');
  });

  it('injects only exact location + cook + session prior turns as non-authoritative context', async () => {
    seedTurn({
      userContent: 'remember exact partition marker',
      assistantContent: 'exact assistant marker',
    });
    seedTurn({
      locationId: 'east',
      userContent: 'foreign location marker',
      assistantContent: 'foreign location assistant',
    });
    seedTurn({
      cookId: 'cook-morgan',
      userContent: 'foreign cook marker',
      assistantContent: 'foreign cook assistant',
    });
    seedTurn({
      sessionId: SECOND_SESSION,
      userContent: 'foreign session marker',
      assistantContent: 'foreign session assistant',
    });

    const res = await POST(postReq());
    assert.equal(res.status, 200);
    assert.match(lastUserPrompt, /PRIOR TURNS \(non-authoritative conversation context\)/);
    assert.match(lastUserPrompt, /remember exact partition marker/);
    assert.match(lastUserPrompt, /exact assistant marker/);
    assert.doesNotMatch(lastUserPrompt, /foreign location marker/);
    assert.doesNotMatch(lastUserPrompt, /foreign cook marker/);
    assert.doesNotMatch(lastUserPrompt, /foreign session marker/);
  });

  it('excludes manager-tier prior turns without signed PIN and includes them with signed PIN', async () => {
    seedTurn({
      userContent: 'cook-tier marker',
      assistantContent: 'cook-tier assistant',
      managerTier: false,
    });
    seedTurn({
      userContent: 'manager-tier marker',
      assistantContent: 'manager-tier assistant',
      managerTier: true,
      createdAt: new Date(Date.now() - 59 * MINUTE_MS).toISOString(),
    });

    const cookRes = await POST(postReq());
    assert.equal(cookRes.status, 200);
    assert.match(lastUserPrompt, /cook-tier marker/);
    assert.doesNotMatch(lastUserPrompt, /manager-tier marker/);

    const signed = await signPinCookieValue(process.env.LARIAT_PIN_SECRET);
    const managerRes = await POST(postReq({ cookie: `lariat_pin_ok=${signed}` }));
    assert.equal(managerRes.status, 200);
    assert.match(lastUserPrompt, /cook-tier marker/);
    assert.match(lastUserPrompt, /manager-tier marker/);
  });

  it('stores final visible assistant answer only, not raw fenced JSON action payload', async () => {
    stubbedContent =
      '```json\n' +
      JSON.stringify({ action: 'eighty_six', item: 'salmon', reason: 'sold out' }) +
      '\n```\nVisible answer for the cook.';

    const res = await POST(postReq({ message: 'Is salmon still available?' }));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.answer, 'Visible answer for the cook.');

    const rows = storedTurns();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].user_content, 'Is salmon still available?');
    assert.equal(rows[0].assistant_content, 'Visible answer for the cook.');
    assert.doesNotMatch(rows[0].assistant_content, /```/);
    assert.doesNotMatch(rows[0].assistant_content, /"action"/);
  });
});
