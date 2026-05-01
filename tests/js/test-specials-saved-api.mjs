#!/usr/bin/env node
// Round-trip API tests for /api/specials/saved/* against in-memory SQLite.
// PIN gating is enforced by middleware.js, not by the route handlers — these
// tests bypass middleware and exercise the route logic directly. Middleware
// integration is left to Playwright e2e (out of scope here).
//
// Run: node --experimental-strip-types --test tests/js/test-specials-saved-api.mjs

import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

register(new URL('./resolver.mjs', import.meta.url));

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-specials-api-'));
const TMP_DB = path.join(TMP_DIR, 'lariat-test.db');
const AUDIT_PATH = path.join(TMP_DIR, 'management-actions.jsonl');

process.env.LARIAT_AUDIT_PATH = AUDIT_PATH;

const db = await import('../../lib/db.ts');
db.setDbPathForTest(TMP_DB);

const create = await import('../../app/api/specials/saved/route.js');
const detail = await import('../../app/api/specials/saved/[id]/route.js');

after(() => {
  db.setDbPathForTest(null);
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

beforeEach(() => {
  const d = db.getDb();
  d.prepare('DELETE FROM specials').run();
  try { fs.unlinkSync(AUDIT_PATH); } catch { /* ignore */ }
});

function jsonRequest(url, body) {
  return new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const validBody = {
  name: 'Pork Belly App',
  pantry_text: '10 lbs pork belly',
  prompt_text: 'High-margin appetizer',
  ai_answer: 'Sear belly. Plate over slaw.',
  ai_model: 'lari-the-kitchen-assistant',
  cost_breakdown: [{ item: 'Pork Belly', req_qty: 2, req_unit: 'lb', match: 'Sysco', cost: 10 }],
  cost_total: 10,
  scratch_notes: '',
  sources: [],
};

describe('POST /api/specials/saved', () => {
  it('creates a row and returns its id', async () => {
    const res = await create.POST(jsonRequest('http://x/api/specials/saved', validBody));
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.match(data.id, /^[0-9a-f-]{36}$/);

    const row = db.getDb().prepare('SELECT * FROM specials WHERE id = ?').get(data.id);
    assert.equal(row.name, 'Pork Belly App');
    assert.equal(row.location_id, 'default');
    assert.equal(row.cost_total, 10);
    assert.equal(typeof row.cost_breakdown, 'string');
    assert.equal(row.archived_at, null);
    assert.equal(row.last_exported_at, null);
  });

  it('rejects empty name', async () => {
    const res = await create.POST(jsonRequest('http://x/api/specials/saved', { ...validBody, name: '   ' }));
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.match(data.error, /name/i);
  });

  it('rejects fully-empty session content', async () => {
    const res = await create.POST(jsonRequest('http://x/api/specials/saved', {
      name: 'X', pantry_text: '', prompt_text: '', ai_answer: '', ai_model: '',
    }));
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.match(data.error, /no session content/i);
  });

  it('rejects invalid JSON in cost_breakdown', async () => {
    const res = await create.POST(jsonRequest('http://x/api/specials/saved', {
      ...validBody, cost_breakdown: 'not json at all',
    }));
    assert.equal(res.status, 400);
  });

  it('honors location_id from body', async () => {
    const res = await create.POST(jsonRequest('http://x/api/specials/saved', {
      ...validBody, location_id: 'food-truck',
    }));
    assert.equal(res.status, 200);
    const data = await res.json();
    const row = db.getDb().prepare('SELECT location_id FROM specials WHERE id = ?').get(data.id);
    assert.equal(row.location_id, 'food-truck');
  });

  it('writes a file-audit line on create', async () => {
    const res = await create.POST(jsonRequest('http://x/api/specials/saved', validBody));
    assert.equal(res.status, 200);
    const data = await res.json();
    const auditRaw = fs.readFileSync(AUDIT_PATH, 'utf8').trim();
    const audit = JSON.parse(auditRaw);
    assert.equal(audit.action, 'specials.create');
    assert.equal(audit.special_id, data.id);
    assert.equal(audit.name, 'Pork Belly App');
  });
});

describe('GET /api/specials/saved (list)', () => {
  it('returns active rows newest-first for the requested location', async () => {
    await create.POST(jsonRequest('http://x/api/specials/saved', { ...validBody, name: 'Old' }));
    await new Promise((r) => setTimeout(r, 5));
    await create.POST(jsonRequest('http://x/api/specials/saved', { ...validBody, name: 'New' }));

    const res = await create.GET(new Request('http://x/api/specials/saved?location=default'));
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.items.length, 2);
    assert.equal(data.items[0].name, 'New');
    assert.equal(data.items[1].name, 'Old');
    assert.ok(typeof data.items[0].snippet === 'string');
    assert.ok(data.items[0].snippet.length <= 120);
  });

  it('isolates by location', async () => {
    await create.POST(jsonRequest('http://x/api/specials/saved', { ...validBody, location_id: 'a', name: 'A' }));
    await create.POST(jsonRequest('http://x/api/specials/saved', { ...validBody, location_id: 'b', name: 'B' }));
    const res = await create.GET(new Request('http://x/api/specials/saved?location=a'));
    const data = await res.json();
    assert.equal(data.items.length, 1);
    assert.equal(data.items[0].name, 'A');
  });
});

async function createOne(overrides = {}) {
  const res = await create.POST(jsonRequest('http://x/api/specials/saved', { ...validBody, ...overrides }));
  return (await res.json()).id;
}

describe('GET /api/specials/saved/[id]', () => {
  it('returns the full record', async () => {
    const id = await createOne();
    const res = await detail.GET(new Request(`http://x/api/specials/saved/${id}`), { params: { id } });
    assert.equal(res.status, 200);
    const row = await res.json();
    assert.equal(row.id, id);
    assert.equal(row.name, 'Pork Belly App');
    assert.equal(row.ai_answer, 'Sear belly. Plate over slaw.');
  });

  it('404s on unknown id', async () => {
    const res = await detail.GET(new Request('http://x/api/specials/saved/missing'), { params: { id: 'missing' } });
    assert.equal(res.status, 404);
  });

  it('404s when id exists but in a different location', async () => {
    const id = await createOne({ location_id: 'a' });
    const res = await detail.GET(new Request(`http://x/api/specials/saved/${id}?location=b`), { params: { id } });
    assert.equal(res.status, 404);
  });
});

describe('PATCH /api/specials/saved/[id]', () => {
  it('updates allowed fields and bumps updated_at', async () => {
    const id = await createOne();
    const beforeRow = db.getDb().prepare('SELECT updated_at FROM specials WHERE id = ?').get(id);
    await new Promise((r) => setTimeout(r, 5));
    const res = await detail.PATCH(
      new Request(`http://x/api/specials/saved/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Renamed', scratch_notes: 'hello' }),
      }),
      { params: { id } },
    );
    assert.equal(res.status, 200);
    const row = db.getDb().prepare('SELECT * FROM specials WHERE id = ?').get(id);
    assert.equal(row.name, 'Renamed');
    assert.equal(row.scratch_notes, 'hello');
    assert.ok(row.updated_at > beforeRow.updated_at);
  });

  it('rejects disallowed fields with the rejected list', async () => {
    const id = await createOne();
    const res = await detail.PATCH(
      new Request(`http://x/api/specials/saved/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'OK', ai_answer: 'NO', cost_total: 99 }),
      }),
      { params: { id } },
    );
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.deepEqual(data.rejected.sort(), ['ai_answer', 'cost_total']);
  });

  it('keeps captured session fields immutable', async () => {
    const id = await createOne();
    const before = db.getDb().prepare('SELECT ai_answer, cost_total FROM specials WHERE id = ?').get(id);
    await detail.PATCH(
      new Request(`http://x/api/specials/saved/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'X' }),
      }),
      { params: { id } },
    );
    const after = db.getDb().prepare('SELECT ai_answer, cost_total FROM specials WHERE id = ?').get(id);
    assert.equal(after.ai_answer, before.ai_answer);
    assert.equal(after.cost_total, before.cost_total);
  });

  it('writes a specials.update file-audit line', async () => {
    const id = await createOne();
    fs.unlinkSync(AUDIT_PATH); // clear the create row
    await detail.PATCH(
      new Request(`http://x/api/specials/saved/${id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'Renamed' }),
      }),
      { params: { id } },
    );
    const audit = JSON.parse(fs.readFileSync(AUDIT_PATH, 'utf8').trim());
    assert.equal(audit.action, 'specials.update');
    assert.equal(audit.special_id, id);
  });
});

describe('DELETE /api/specials/saved/[id]', () => {
  it('soft-deletes (sets archived_at, removes from list)', async () => {
    const id = await createOne();
    const res = await detail.DELETE(
      new Request(`http://x/api/specials/saved/${id}`, { method: 'DELETE' }),
      { params: { id } },
    );
    assert.equal(res.status, 200);
    const row = db.getDb().prepare('SELECT archived_at FROM specials WHERE id = ?').get(id);
    assert.ok(row.archived_at !== null);

    const list = await create.GET(new Request('http://x/api/specials/saved?location=default'));
    const data = await list.json();
    assert.equal(data.items.length, 0);
  });

  it('is idempotent on re-delete', async () => {
    const id = await createOne();
    await detail.DELETE(new Request(`http://x/api/specials/saved/${id}`, { method: 'DELETE' }), { params: { id } });
    const res = await detail.DELETE(new Request(`http://x/api/specials/saved/${id}`, { method: 'DELETE' }), { params: { id } });
    assert.equal(res.status, 200);
  });
});
