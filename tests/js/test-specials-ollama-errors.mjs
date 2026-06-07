#!/usr/bin/env node
// Regression for runtime UX audit F3: /api/specials must not expose
// raw Ollama transport failures such as "fetch failed" to staff-facing
// clients. The page already masks these; this pins the route itself.
//
// Run: node --experimental-strip-types --test tests/js/test-specials-ollama-errors.mjs

import { after, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

register(new URL('./resolver.mjs', import.meta.url));

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-specials-ollama-errors-'));
const TMP_DB = path.join(TMP_DIR, 'lariat-test.db');
const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_CONSOLE_ERROR = console.error;

const db = await import('../../lib/db.ts');
db.setDbPathForTest(TMP_DB);
const testDb = db.getDb();

const route = await import('../../app/api/specials/route.js');

after(() => {
  db.setDbPathForTest(null);
  globalThis.fetch = ORIGINAL_FETCH;
  console.error = ORIGINAL_CONSOLE_ERROR;
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

beforeEach(() => {
  testDb.exec('DELETE FROM idempotency_keys;');
  console.error = () => {};
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.endsWith('/api/chat')) {
      throw new TypeError('fetch failed');
    }
    if (u.endsWith('/api/tags')) {
      return new Response(JSON.stringify({ models: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response('not stubbed', { status: 404 });
  };
});

function postReq(body = { message: 'Make a pork belly special' }) {
  return new Request('http://localhost/api/specials', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/specials — local AI transport failures', () => {
  it('maps raw Ollama fetch failures to staff-readable local-AI-down copy', async () => {
    const res = await route.POST(postReq());
    assert.equal(res.status, 502);

    const body = await res.json();
    assert.match(body.error, /AI is down/i);
    assert.doesNotMatch(body.error, /^fetch failed$/i);
  });
});
