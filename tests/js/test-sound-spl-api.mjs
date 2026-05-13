#!/usr/bin/env node
// Integration tests for /api/shows/[id]/sound/spl.
// Run: node --experimental-strip-types --test tests/js/test-sound-spl-api.mjs

import { describe, it, after, beforeEach, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { register } from 'node:module';

register(new URL('./resolver.mjs', import.meta.url));

// Sandbox the file-audit JSONL — appendSplReading writes via auditLog.mjs.
const prevCwd = process.cwd();
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-spl-api-'));
process.chdir(tmpRoot);

const ORIGINAL_PIN = process.env.LARIAT_PIN;
const ORIGINAL_SECRET = process.env.LARIAT_PIN_SECRET;
process.env.LARIAT_PIN = '4242';
delete process.env.LARIAT_PIN_SECRET;

const db = await import('../../lib/db.ts');
const route = await import('../../app/api/shows/[id]/sound/spl/route.js');

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
  conn.prepare(
    `INSERT INTO shows (id, location_id, band_name, show_date, source_row, ingested_at, ingest_run_id)
     VALUES (1, 'default', 'Test Band', '2026-05-11', 1, datetime('now'), 1)`,
  ).run();
});

beforeEach(() => {
  conn.exec('DELETE FROM spl_readings; DELETE FROM sound_scenes;');
  const auditFile = path.join(tmpRoot, 'data', 'audit', 'management-actions.jsonl');
  if (fs.existsSync(auditFile)) fs.rmSync(auditFile);
});

const PIN_COOKIE = 'lariat_pin_ok=1';

function req({ method = 'GET', path = '/api/shows/1/sound/spl', body, withPin = true } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (withPin) headers.cookie = PIN_COOKIE;
  const init = { headers, method };
  if (body != null) init.body = JSON.stringify(body);
  return new Request(`http://localhost${path}`, init);
}

describe('GET /api/shows/[id]/sound/spl — auth', () => {
  it('returns 401 without a PIN cookie', async () => {
    const res = await route.GET(req({ withPin: false }), { params: { id: '1' } });
    assert.equal(res.status, 401);
  });

  it('returns 400 on invalid show id', async () => {
    const res = await route.GET(req({ path: '/api/shows/abc/sound/spl' }), { params: { id: 'abc' } });
    assert.equal(res.status, 400);
  });
});

describe('GET /api/shows/[id]/sound/spl — empty', () => {
  it('returns 200 with empty list when no readings exist', async () => {
    const res = await route.GET(req(), { params: { id: '1' } });
    assert.equal(res.status, 200);
    const j = await res.json();
    assert.deepEqual(j.readings, []);
    assert.equal(j.summary.count, 0);
    assert.equal(j.latest_scene_id, null);
  });
});

describe('POST /api/shows/[id]/sound/spl — append', () => {
  it('returns 401 without a PIN cookie', async () => {
    const res = await route.POST(
      req({ method: 'POST', body: { db_value: 95, location_id: 'default' }, withPin: false }),
      { params: { id: '1' } },
    );
    assert.equal(res.status, 401);
  });

  it('inserts a reading + returns the row + fresh summary', async () => {
    const res = await route.POST(
      req({ method: 'POST', body: { db_value: 98.5, location_id: 'default' } }),
      { params: { id: '1' } },
    );
    assert.equal(res.status, 201);
    const j = await res.json();
    assert.equal(j.reading.db_value, 98.5);
    assert.equal(j.summary.count, 1);
    assert.equal(j.summary.latest, 98.5);
    assert.equal(j.summary.peak, 98.5);
  });

  it('rejects missing db_value with 400', async () => {
    const res = await route.POST(
      req({ method: 'POST', body: { location_id: 'default' } }),
      { params: { id: '1' } },
    );
    assert.equal(res.status, 400);
  });

  it('rejects non-finite db_value with 400', async () => {
    const res = await route.POST(
      req({ method: 'POST', body: { db_value: 'loud', location_id: 'default' } }),
      { params: { id: '1' } },
    );
    assert.equal(res.status, 400);
  });

  it('rejects out-of-range db_value with 400', async () => {
    const res = await route.POST(
      req({ method: 'POST', body: { db_value: 5, location_id: 'default' } }),
      { params: { id: '1' } },
    );
    assert.equal(res.status, 400);
    const res2 = await route.POST(
      req({ method: 'POST', body: { db_value: 220, location_id: 'default' } }),
      { params: { id: '1' } },
    );
    assert.equal(res2.status, 400);
  });

  it('GET after POSTs returns readings oldest→newest with summary', async () => {
    for (const v of [88, 95, 102]) {
      await route.POST(
        req({ method: 'POST', body: { db_value: v, location_id: 'default' } }),
        { params: { id: '1' } },
      );
    }
    const res = await route.GET(req(), { params: { id: '1' } });
    const j = await res.json();
    assert.equal(j.readings.length, 3);
    assert.equal(j.readings[0].db_value, 88);
    assert.equal(j.readings[2].db_value, 102);
    assert.equal(j.summary.peak, 102);
    assert.equal(j.summary.latest, 102);
  });

  it('threads scene_id when supplied', async () => {
    conn
      .prepare(
        `INSERT INTO sound_scenes (id, show_id, location_id, scene_name, plot_json, spl_limit_db)
         VALUES (7, 1, 'default', 'main', '{}', 100)`,
      )
      .run();
    const res = await route.POST(
      req({ method: 'POST', body: { db_value: 99, scene_id: 7, location_id: 'default' } }),
      { params: { id: '1' } },
    );
    assert.equal(res.status, 201);
    const j = await res.json();
    assert.equal(j.reading.scene_id, 7);
    assert.equal(j.summary.limit_db, 100);
    assert.equal(j.latest_scene_id, 7);
  });

  it('rejects non-positive scene_id with 400', async () => {
    const res = await route.POST(
      req({ method: 'POST', body: { db_value: 95, scene_id: 0, location_id: 'default' } }),
      { params: { id: '1' } },
    );
    assert.equal(res.status, 400);
  });
});
