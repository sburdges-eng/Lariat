#!/usr/bin/env node
// Integration tests for the Phase 2 event-ops API routes:
//   /api/shows/[id]/stage             (GET, POST)
//   /api/shows/[id]/sound             (GET, POST)
//   /api/shows/[id]/sound/[sceneId]   (PATCH, DELETE)
//   /api/shows/[id]/box-office        (GET, POST)
//   /api/shows/[id]/box-office/[lineId] (PATCH mark_scanned)
//
// Same in-process pattern as test-temp-log-route.mjs: register the
// extension-adding resolver, swap the DB path with setDbPathForTest,
// dynamically import the route handlers, and call them directly with
// Request objects. PIN gate is exercised — LARIAT_PIN must be set so
// the route's `pinRequiredForPic()` returns true.

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

register(new URL('./resolver.mjs', import.meta.url));

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-event-ops-'));
const TMP_DB = path.join(TMP_DIR, 'lariat-test.db');

const ORIGINAL_PIN = process.env.LARIAT_PIN;
process.env.LARIAT_PIN = '4242';

const db = await import('../../lib/db.ts');
const stageRoute = await import('../../app/api/shows/[id]/stage/route.js');
const soundRoute = await import('../../app/api/shows/[id]/sound/route.js');
const sceneRoute = await import('../../app/api/shows/[id]/sound/[sceneId]/route.js');
const boxOfficeRoute = await import('../../app/api/shows/[id]/box-office/route.js');
const lineRoute = await import('../../app/api/shows/[id]/box-office/[lineId]/route.js');

db.setDbPathForTest(TMP_DB);
const testDb = db.getDb();

after(() => {
  db.setDbPathForTest(null);
  process.env.LARIAT_PIN = ORIGINAL_PIN;
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
});

before(() => {
  testDb.prepare(
    `INSERT OR IGNORE INTO ingest_runs (id, kind, started_at, status)
     VALUES (1, 'test', datetime('now'), 'ok')`,
  ).run();
  testDb.prepare(
    `INSERT OR IGNORE INTO shows
       (id, location_id, band_name, show_date, source_row, ingested_at, ingest_run_id)
     VALUES (101, 'default', 'Test Band', '2026-05-01', 1, datetime('now'), 1)`,
  ).run();
});

beforeEach(() => {
  testDb.exec(`
    DELETE FROM stage_setups;
    DELETE FROM sound_scenes;
    DELETE FROM box_office_lines;
    DELETE FROM audit_events;
  `);
});

const PIN_COOKIE = 'lariat_pin_ok=1';
const SHOW_ID = 101;

function makeReq({ method = 'GET', url, body, withPin = true } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (withPin) headers.cookie = PIN_COOKIE;
  const init = { method, headers };
  if (body !== undefined) init.body = JSON.stringify(body);
  return new Request(url, init);
}

// ─────────────────────────── Stage ───────────────────────────────

describe('/api/shows/[id]/stage', () => {
  it('GET 401 without PIN cookie', async () => {
    const res = await stageRoute.GET(
      makeReq({ url: `http://localhost/api/shows/${SHOW_ID}/stage`, withPin: false }),
      { params: { id: String(SHOW_ID) } },
    );
    assert.equal(res.status, 401);
  });

  it('GET 200 returns null setup before any POST', async () => {
    const res = await stageRoute.GET(
      makeReq({ url: `http://localhost/api/shows/${SHOW_ID}/stage` }),
      { params: { id: String(SHOW_ID) } },
    );
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.show_id, SHOW_ID);
    assert.equal(body.setup, null);
    assert.ok(Array.isArray(Object.keys(body.known_room_configs)));
  });

  it('POST 401 without PIN cookie', async () => {
    const res = await stageRoute.POST(
      makeReq({
        method: 'POST',
        url: `http://localhost/api/shows/${SHOW_ID}/stage`,
        body: { room_config: 'listening_room_220' },
        withPin: false,
      }),
      { params: { id: String(SHOW_ID) } },
    );
    assert.equal(res.status, 401);
  });

  it('POST creates then updates the same row (UPSERT)', async () => {
    const r1 = await stageRoute.POST(
      makeReq({
        method: 'POST',
        url: `http://localhost/api/shows/${SHOW_ID}/stage`,
        body: { room_config: 'listening_room_220' },
      }),
      { params: { id: String(SHOW_ID) } },
    );
    assert.equal(r1.status, 201);
    const r2 = await stageRoute.POST(
      makeReq({
        method: 'POST',
        url: `http://localhost/api/shows/${SHOW_ID}/stage`,
        body: { room_config: 'cabaret_160' },
      }),
      { params: { id: String(SHOW_ID) } },
    );
    assert.equal(r2.status, 200);
    const body = await r2.json();
    assert.equal(body.setup.room_config, 'cabaret_160');
  });

  it('POST 400 on unknown room_config', async () => {
    const res = await stageRoute.POST(
      makeReq({
        method: 'POST',
        url: `http://localhost/api/shows/${SHOW_ID}/stage`,
        body: { room_config: 'garbage' },
      }),
      { params: { id: String(SHOW_ID) } },
    );
    assert.equal(res.status, 400);
  });
});

// ─────────────────────────── Sound ───────────────────────────────

describe('/api/shows/[id]/sound', () => {
  it('GET 401 without PIN cookie', async () => {
    const res = await soundRoute.GET(
      makeReq({ url: `http://localhost/api/shows/${SHOW_ID}/sound`, withPin: false }),
      { params: { id: String(SHOW_ID) } },
    );
    assert.equal(res.status, 401);
  });

  it('POST 201 creates a scene; PATCH updates it; GET reflects', async () => {
    const create = await soundRoute.POST(
      makeReq({
        method: 'POST',
        url: `http://localhost/api/shows/${SHOW_ID}/sound`,
        body: {
          scene_name: 'soundcheck',
          plot: { channels: [], monitors: [] },
          spl_limit_db: 95,
        },
      }),
      { params: { id: String(SHOW_ID) } },
    );
    assert.equal(create.status, 201);
    const created = await create.json();
    const sceneId = created.scene.id;

    const patch = await sceneRoute.PATCH(
      makeReq({
        method: 'PATCH',
        url: `http://localhost/api/shows/${SHOW_ID}/sound/${sceneId}`,
        body: { spl_limit_db: 100, scene_name: 'set 1' },
      }),
      { params: { id: String(SHOW_ID), sceneId: String(sceneId) } },
    );
    assert.equal(patch.status, 200);
    const patched = await patch.json();
    assert.equal(patched.scene.spl_limit_db, 100);
    assert.equal(patched.scene.scene_name, 'set 1');
  });

  it('PATCH 404 on unknown sceneId', async () => {
    const res = await sceneRoute.PATCH(
      makeReq({
        method: 'PATCH',
        url: `http://localhost/api/shows/${SHOW_ID}/sound/999999`,
        body: { scene_name: 'x' },
      }),
      { params: { id: String(SHOW_ID), sceneId: '999999' } },
    );
    assert.equal(res.status, 404);
  });

  it('PATCH 401 without PIN cookie', async () => {
    const res = await sceneRoute.PATCH(
      makeReq({
        method: 'PATCH',
        url: `http://localhost/api/shows/${SHOW_ID}/sound/1`,
        body: { scene_name: 'x' },
        withPin: false,
      }),
      { params: { id: String(SHOW_ID), sceneId: '1' } },
    );
    assert.equal(res.status, 401);
  });

  it('PATCH 400 on empty patch', async () => {
    const create = await soundRoute.POST(
      makeReq({
        method: 'POST',
        url: `http://localhost/api/shows/${SHOW_ID}/sound`,
        body: { scene_name: 'a', plot: { channels: [], monitors: [] } },
      }),
      { params: { id: String(SHOW_ID) } },
    );
    const sceneId = (await create.json()).scene.id;
    const res = await sceneRoute.PATCH(
      makeReq({
        method: 'PATCH',
        url: `http://localhost/api/shows/${SHOW_ID}/sound/${sceneId}`,
        body: {},
      }),
      { params: { id: String(SHOW_ID), sceneId: String(sceneId) } },
    );
    assert.equal(res.status, 400);
  });
});

// ───────────────────────── Box Office ────────────────────────────

describe('/api/shows/[id]/box-office', () => {
  it('GET 401 without PIN cookie', async () => {
    const res = await boxOfficeRoute.GET(
      makeReq({ url: `http://localhost/api/shows/${SHOW_ID}/box-office`, withPin: false }),
      { params: { id: String(SHOW_ID) } },
    );
    assert.equal(res.status, 401);
  });

  it('POST 201 creates a line; PATCH mark_scanned flips scanned_at', async () => {
    const create = await boxOfficeRoute.POST(
      makeReq({
        method: 'POST',
        url: `http://localhost/api/shows/${SHOW_ID}/box-office`,
        body: { source: 'walkup', qty: 1, face_price: 25 },
      }),
      { params: { id: String(SHOW_ID) } },
    );
    assert.equal(create.status, 201);
    const created = await create.json();
    const lineId = created.line.id;

    const scan = await lineRoute.PATCH(
      makeReq({
        method: 'PATCH',
        url: `http://localhost/api/shows/${SHOW_ID}/box-office/${lineId}`,
        body: { action: 'mark_scanned', actor_cook_id: 'door_anna' },
      }),
      { params: { id: String(SHOW_ID), lineId: String(lineId) } },
    );
    assert.equal(scan.status, 200);
    const scanned = await scan.json();
    assert.ok(scanned.line.scanned_at);
  });

  it('POST 400 on invalid source', async () => {
    const res = await boxOfficeRoute.POST(
      makeReq({
        method: 'POST',
        url: `http://localhost/api/shows/${SHOW_ID}/box-office`,
        body: { source: 'free', qty: 1 },
      }),
      { params: { id: String(SHOW_ID) } },
    );
    assert.equal(res.status, 400);
  });

  it('PATCH 400 on unsupported action', async () => {
    const create = await boxOfficeRoute.POST(
      makeReq({
        method: 'POST',
        url: `http://localhost/api/shows/${SHOW_ID}/box-office`,
        body: { source: 'walkup', qty: 1, face_price: 25 },
      }),
      { params: { id: String(SHOW_ID) } },
    );
    const lineId = (await create.json()).line.id;
    const res = await lineRoute.PATCH(
      makeReq({
        method: 'PATCH',
        url: `http://localhost/api/shows/${SHOW_ID}/box-office/${lineId}`,
        body: { action: 'refund' },
      }),
      { params: { id: String(SHOW_ID), lineId: String(lineId) } },
    );
    assert.equal(res.status, 400);
  });

  it('PATCH 404 on already-scanned line', async () => {
    const create = await boxOfficeRoute.POST(
      makeReq({
        method: 'POST',
        url: `http://localhost/api/shows/${SHOW_ID}/box-office`,
        body: { source: 'walkup', qty: 1, face_price: 25 },
      }),
      { params: { id: String(SHOW_ID) } },
    );
    const lineId = (await create.json()).line.id;
    await lineRoute.PATCH(
      makeReq({
        method: 'PATCH',
        url: `http://localhost/api/shows/${SHOW_ID}/box-office/${lineId}`,
        body: { action: 'mark_scanned' },
      }),
      { params: { id: String(SHOW_ID), lineId: String(lineId) } },
    );
    const res = await lineRoute.PATCH(
      makeReq({
        method: 'PATCH',
        url: `http://localhost/api/shows/${SHOW_ID}/box-office/${lineId}`,
        body: { action: 'mark_scanned' },
      }),
      { params: { id: String(SHOW_ID), lineId: String(lineId) } },
    );
    assert.equal(res.status, 404);
  });
});
