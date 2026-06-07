#!/usr/bin/env node
// Route integration tests for LaRi db_query summary pass.
//
// Run:
//   node --experimental-strip-types --test tests/js/test-kitchen-assistant-db-query-summary.mjs

import { describe, it, after, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

register(new URL('./resolver.mjs', import.meta.url));

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-ka-db-query-summary-'));
const TMP_DB = path.join(TMP_DIR, 'lariat-test.db');

const LOC = 'default';
const SESSION = '66666666-6666-4666-8666-666666666666';
const COOK = 'cook-summary';

const ORIGINAL_FETCH = globalThis.fetch;
let chatCalls = [];
let summaryContent =
  'Twenty-one temp rows show steady walk-in readings. Nothing in the table points to an urgent correction.';

const db = await import('../../lib/db.ts');
const tool = await import('../../lib/dbQueryTool.ts');

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
      if (chatCalls.length === 1) {
        return jsonResponse({
          message: {
            content:
              '```json\n' +
              JSON.stringify({ action: 'db_query', query: 'summary_temp_rows', params: {} }) +
              '\n```\nHere are the rows.',
          },
        });
      }
      return jsonResponse({ message: { content: summaryContent } });
    }
    return new Response('not stubbed', { status: 404 });
  };
}

function installQueryRegistry() {
  tool._setRegistryForTest([
    {
      name: 'summary_temp_rows',
      tier: 'cook',
      description: 'Test query with enough rows to summarize.',
      sql:
        `SELECT point_id, reading_f, cook_id
           FROM temp_log
          WHERE location_id = :location_id
          ORDER BY id ASC`,
      params: [],
      rowCap: 50,
      locationScoped: true,
    },
  ]);
}

function seedTempRows(count) {
  const insert = testDb.prepare(
    `INSERT INTO temp_log
       (shift_date, location_id, point_id, reading_f, required_min_f, required_max_f, cook_id, created_at)
     VALUES (date('now'), ?, 'walk_in_cooler', ?, 33, 41, ?, ?)`,
  );
  testDb.transaction(() => {
    for (let i = 0; i < count; i += 1) {
      insert.run(
        LOC,
        36 + (i % 4),
        `cook-${String(i + 1).padStart(2, '0')}`,
        new Date(Date.now() - (i + 1) * 60 * 1000).toISOString(),
      );
    }
  })();
}

function postReq() {
  return new Request('http://localhost/api/kitchen-assistant', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      message: 'Show me the recent temp query.',
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
  summaryContent =
    'Twenty-one temp rows show steady walk-in readings. Nothing in the table points to an urgent correction.';
  installQueryRegistry();
  testDb.exec(
    `DELETE FROM temp_log;
     DELETE FROM lari_conversation_turns;
     DELETE FROM audit_events;`,
  );
});

after(() => {
  tool._setRegistryForTest(null);
  db.setDbPathForTest(null);
  globalThis.fetch = ORIGINAL_FETCH;
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('POST /api/kitchen-assistant db_query summaries', () => {
  it('routes >20 db_query rows through a second local summary call and keeps the raw table', async () => {
    seedTempRows(21);

    const res = await POST(postReq());
    assert.equal(res.status, 200);
    const body = await res.json();

    assert.equal(chatCalls.length, 2, 'expected initial LaRi call plus summary call');
    const summaryUser = chatCalls[1].messages.find((m) => m.role === 'user')?.content || '';
    assert.match(summaryUser, /summary_temp_rows/);
    assert.match(summaryUser, /21 row/);
    assert.match(summaryUser, /point_id \| reading_f \| cook_id/);

    assert.match(body.answer, /ACTION EXECUTED/);
    assert.match(body.answer, /Summary:/);
    assert.match(body.answer, /Twenty-one temp rows show steady walk-in readings/);
    assert.match(body.answer, /Query "summary_temp_rows" — 21 row\(s\):/);
    assert.match(body.answer, /walk_in_cooler/);
    assert.ok(
      body.sources.some((source) => source.type === 'db_query_summary'),
      'response sources should record that a local db_query summary ran',
    );
  });

  it('does not summarize db_query results at the 20-row threshold', async () => {
    seedTempRows(20);

    const res = await POST(postReq());
    assert.equal(res.status, 200);
    const body = await res.json();

    assert.equal(chatCalls.length, 1, '20 rows should not trigger a second summary call');
    assert.doesNotMatch(body.answer, /Summary:/);
    assert.match(body.answer, /Query "summary_temp_rows" — 20 row\(s\):/);
  });
});
