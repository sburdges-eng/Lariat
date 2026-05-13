#!/usr/bin/env node
// Integration tests for POST /api/shows/[id]/capacity.
// Run: node --experimental-strip-types --test tests/js/test-show-capacity-api.mjs

import { describe, it, after, beforeEach, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { register } from 'node:module';

register(new URL('./resolver.mjs', import.meta.url));

const prevCwd = process.cwd();
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-capacity-api-'));
process.chdir(tmpRoot);

const ORIGINAL_PIN = process.env.LARIAT_PIN;
const ORIGINAL_SECRET = process.env.LARIAT_PIN_SECRET;
process.env.LARIAT_PIN = '4242';
delete process.env.LARIAT_PIN_SECRET;

const db = await import('../../lib/db.ts');
const route = await import('../../app/api/shows/[id]/capacity/route.js');

db.setDbPathForTest(':memory:');
const conn = db.getDb();

after(() => {
  db.setDbPathForTest(null);
  process.env.LARIAT_PIN = ORIGINAL_PIN;
  if (ORIGINAL_SECRET !== undefined) process.env.LARIAT_PIN_SECRET = ORIGINAL_SECRET;
  process.chdir(prevCwd);
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

before(() => {
  conn.prepare(
    `INSERT INTO ingest_runs (id, kind, started_at, status)
     VALUES (1, 'test', datetime('now'), 'ok')`,
  ).run();
});

beforeEach(() => {
  conn.exec('DELETE FROM shows;');
  // Reset with a fresh row keyed at id=1 with empty status_json.
  conn.prepare(
    `INSERT INTO shows
       (id, location_id, band_name, show_date, status_json, source_row, ingested_at, ingest_run_id)
     VALUES (1, 'default', 'Test Band', '2026-05-11', '{}', 1, datetime('now'), 1)`,
  ).run();
  const auditFile = path.join(tmpRoot, 'data', 'audit', 'management-actions.jsonl');
  if (fs.existsSync(auditFile)) fs.rmSync(auditFile);
});

function readAuditEntries() {
  const auditFile = path.join(tmpRoot, 'data', 'audit', 'management-actions.jsonl');
  if (!fs.existsSync(auditFile)) return [];
  return fs
    .readFileSync(auditFile, 'utf-8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

const PIN_COOKIE = 'lariat_pin_ok=1';

function req(body, { withPin = true, idParam = '1' } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (withPin) headers.cookie = PIN_COOKIE;
  return new Request(`http://localhost/api/shows/${idParam}/capacity`, {
    headers,
    method: 'POST',
    body: JSON.stringify(body),
  });
}

function showStatus(id = 1) {
  const row = conn.prepare(`SELECT status_json FROM shows WHERE id = ?`).get(id);
  return row?.status_json ? JSON.parse(row.status_json) : null;
}

describe('POST /api/shows/[id]/capacity — auth', () => {
  it('returns 401 without a PIN cookie', async () => {
    const res = await route.POST(req({ capacity: 180 }, { withPin: false }), { params: { id: '1' } });
    assert.equal(res.status, 401);
  });

  it('returns 400 on invalid show id', async () => {
    const res = await route.POST(req({ capacity: 180 }, { idParam: 'abc' }), { params: { id: 'abc' } });
    assert.equal(res.status, 400);
  });
});

describe('POST /api/shows/[id]/capacity — happy path', () => {
  it('sets a numeric override into status_json.capacity + writes one audit entry', async () => {
    const res = await route.POST(req({ capacity: 180 }), { params: { id: '1' } });
    assert.equal(res.status, 200);
    const j = await res.json();
    assert.equal(j.capacity, 180);
    assert.equal(showStatus().capacity, 180);
    const entries = readAuditEntries();
    assert.equal(entries.length, 1);
    assert.equal(entries[0].action, 'show_capacity_set');
    assert.equal(entries[0].capacity, 180);
  });

  it('floors fractional overrides', async () => {
    const res = await route.POST(req({ capacity: 180.7 }), { params: { id: '1' } });
    assert.equal(res.status, 200);
    assert.equal(showStatus().capacity, 180);
  });

  it('null capacity deletes the key (falls through to venue default)', async () => {
    await route.POST(req({ capacity: 180 }), { params: { id: '1' } });
    assert.equal(showStatus().capacity, 180);
    const res = await route.POST(req({ capacity: null }), { params: { id: '1' } });
    assert.equal(res.status, 200);
    const j = await res.json();
    assert.equal(j.capacity, null);
    assert.equal(showStatus().capacity, undefined);
  });

  it('negative / zero capacity is treated as clear', async () => {
    await route.POST(req({ capacity: 200 }), { params: { id: '1' } });
    assert.equal(showStatus().capacity, 200);
    const res = await route.POST(req({ capacity: 0 }), { params: { id: '1' } });
    assert.equal(res.status, 200);
    assert.equal(showStatus().capacity, undefined);
  });

  it('preserves other keys in status_json on update', async () => {
    conn.prepare(`UPDATE shows SET status_json = ? WHERE id = 1`).run(JSON.stringify({ doors: '7pm' }));
    const res = await route.POST(req({ capacity: 180 }), { params: { id: '1' } });
    assert.equal(res.status, 200);
    const next = showStatus();
    assert.equal(next.doors, '7pm');
    assert.equal(next.capacity, 180);
  });
});

describe('POST /api/shows/[id]/capacity — validation', () => {
  it('rejects non-finite capacity with 400', async () => {
    const res = await route.POST(req({ capacity: 'huge' }), { params: { id: '1' } });
    assert.equal(res.status, 400);
  });

  it('rejects capacity > 5000 with 400', async () => {
    const res = await route.POST(req({ capacity: 50000 }), { params: { id: '1' } });
    assert.equal(res.status, 400);
  });

  it('returns 404 when show id does not exist', async () => {
    conn.exec(`DELETE FROM shows;`);
    const res = await route.POST(req({ capacity: 180 }), { params: { id: '1' } });
    assert.equal(res.status, 404);
  });
});
