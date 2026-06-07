#!/usr/bin/env node
// Route integration test for LaRi semantic_search read action.
//
// Run:
//   node --experimental-strip-types --test tests/js/test-kitchen-assistant-semantic-search.mjs

import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

register(new URL('./resolver.mjs', import.meta.url));

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-ka-semantic-search-'));
const TMP_DB = path.join(TMP_DIR, 'lariat-test.db');
const CACHE_DIR = path.join(TMP_DIR, 'cache');

const LOC = 'default';
const SESSION = '77777777-7777-4777-8777-777777777777';
const COOK = 'cook-semantic';

const ORIGINAL_FETCH = globalThis.fetch;
let chatCalls = [];

const db = await import('../../lib/db.ts');
const data = await import('../../lib/data.ts');

db.setDbPathForTest(TMP_DB);
data.setCacheRootForTest(CACHE_DIR);
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
            JSON.stringify({
              action: 'semantic_search',
              query: 'that wedding cake recipe with the cherry filling',
            }) +
            '\n```\nI found the closest kitchen memory.',
        },
      });
    }
    return new Response('not stubbed', { status: 404 });
  };
}

function writeRecipes() {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(CACHE_DIR, 'recipes.json'),
    JSON.stringify([
      {
        slug: 'almond-wedding-cake',
        name: 'Almond Celebration Cake',
        station: 'Pastry',
        ingredients: [
          { item: 'almond sponge', qty: 3, unit: 'layers' },
          { item: 'sour cherry filling', qty: 2, unit: 'qt' },
        ],
        procedure: 'Fill almond cake with sour cherry filling.',
        allergens: ['egg', 'milk', 'tree nut', 'wheat'],
        menu_items: ['wedding cake'],
      },
    ]),
  );
}

function seedBeo() {
  const eventId = Number(testDb.prepare(
    `INSERT INTO beo_events (title, event_date, contact_name, guest_count, notes, location_id)
     VALUES ('Parker Wedding', '2026-06-20', 'Avery Parker', 140,
             'Dessert course uses sour cherry filling.', ?)`
  ).run(LOC).lastInsertRowid);
  testDb.prepare(
    `INSERT INTO beo_line_items
       (event_id, sort_order, item_name, category, quantity, unit_cost, prep_notes, group_note)
     VALUES (?, 1, 'Tiered almond cake with cherry filling', 'Dessert', 140, 4.5,
             'Keep filling cold.', 'Wedding dessert')`
  ).run(eventId);
}

function postReq() {
  return new Request('http://localhost/api/kitchen-assistant', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      message: 'Find that wedding cake recipe with the cherry filling.',
      location_id: LOC,
      cook_id: COOK,
      conversation_session_id: SESSION,
    }),
  });
}

before(() => {
  installFetchStub();
  writeRecipes();
});

beforeEach(() => {
  chatCalls = [];
  testDb.exec(
    `DELETE FROM beo_line_items;
     DELETE FROM beo_events;
     DELETE FROM audit_events;
     DELETE FROM lari_conversation_turns;`,
  );
  seedBeo();
});

after(() => {
  data.setCacheRootForTest(null);
  db.setDbPathForTest(null);
  globalThis.fetch = ORIGINAL_FETCH;
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('POST /api/kitchen-assistant semantic_search', () => {
  it('executes semantic_search as a cook-tier read action on the question path', async () => {
    const res = await POST(postReq());
    assert.equal(res.status, 200);
    const body = await res.json();

    assert.equal(chatCalls.length, 1, 'semantic_search should not make a second model call');
    assert.equal(body.actionExecuted, true);
    assert.equal(body.actionError, false);
    assert.match(body.answer, /ACTION EXECUTED/);
    assert.match(body.answer, /Semantic search/);
    assert.match(body.answer, /Almond Celebration Cake/);
    assert.match(body.answer, /Parker Wedding/);
    assert.ok(
      body.sources.some((source) => source.type === 'semantic_search'),
      'response sources should record semantic_search',
    );
  });
});
