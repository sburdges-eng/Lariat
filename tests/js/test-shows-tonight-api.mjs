#!/usr/bin/env node
// Integration tests for GET /api/shows/tonight.
// Run: node --experimental-strip-types --test tests/js/test-shows-tonight-api.mjs

import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register(new URL('./resolver.mjs', import.meta.url));

const ORIGINAL_PIN = process.env.LARIAT_PIN;
const ORIGINAL_SECRET = process.env.LARIAT_PIN_SECRET;
process.env.LARIAT_PIN = '4242';
delete process.env.LARIAT_PIN_SECRET;

const db = await import('../../lib/db.ts');
const route = await import('../../app/api/shows/tonight/route.js');

db.setDbPathForTest(':memory:');
const conn = db.getDb();

after(() => {
  db.setDbPathForTest(null);
  process.env.LARIAT_PIN = ORIGINAL_PIN;
  if (ORIGINAL_SECRET !== undefined) process.env.LARIAT_PIN_SECRET = ORIGINAL_SECRET;
});

beforeEach(() => {
  conn.exec(
    `DELETE FROM box_office_lines;
     DELETE FROM sound_scenes;
     DELETE FROM stage_setups;
     DELETE FROM shows;
     DELETE FROM ingest_runs;
     UPDATE locations SET capacity = NULL WHERE id = 'default';`,
  );
});

const PIN_COOKIE = 'lariat_pin_ok=1';
const DATE = '2026-05-11';

function makeReq({ path = '/api/shows/tonight', withPin = true } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (withPin) headers.cookie = PIN_COOKIE;
  return new Request(`http://localhost${path}`, { headers });
}

function seedIngestRun() {
  const r = conn
    .prepare(
      `INSERT INTO ingest_runs (kind, started_at, status)
       VALUES ('test', ?, 'ok')`,
    )
    .run(new Date().toISOString());
  return Number(r.lastInsertRowid);
}

function seedShow({ date = DATE, band = 'Test Band', price = 20, status = {} } = {}) {
  const runId = seedIngestRun();
  const r = conn
    .prepare(
      `INSERT INTO shows
         (location_id, band_name, show_date, price, door_tix, status_json, source_row, ingested_at, ingest_run_id)
       VALUES ('default', ?, ?, ?, '7pm', ?, 1, ?, ?)`,
    )
    .run(band, date, price, JSON.stringify(status), new Date().toISOString(), runId);
  return Number(r.lastInsertRowid);
}

function seedStageSetup(showId, runOfShow = []) {
  conn
    .prepare(
      `INSERT INTO stage_setups (show_id, location_id, room_config, run_of_show_json)
       VALUES (?, 'default', 'standard', ?)`,
    )
    .run(showId, JSON.stringify(runOfShow));
}

function seedSoundScene(showId, name, splDb = 100) {
  conn
    .prepare(
      `INSERT INTO sound_scenes (show_id, location_id, scene_name, plot_json, spl_limit_db)
       VALUES (?, 'default', ?, '{}', ?)`,
    )
    .run(showId, name, splDb);
}

function seedBoxLine(showId, { source = 'walkup', qty = 1, face = 0, fees = 0, scanned = false } = {}) {
  conn
    .prepare(
      `INSERT INTO box_office_lines (show_id, location_id, source, qty, face_price, fees, scanned_at)
       VALUES (?, 'default', ?, ?, ?, ?, ?)`,
    )
    .run(showId, source, qty, face, fees, scanned ? new Date().toISOString() : null);
}

// ── PIN gate ───────────────────────────────────────────────────

describe('GET /api/shows/tonight — auth', () => {
  it('returns 401 without a PIN cookie', async () => {
    const res = await route.GET(makeReq({ withPin: false }));
    assert.equal(res.status, 401);
  });
});

// ── empty state ────────────────────────────────────────────────

describe('GET /api/shows/tonight — no show on date', () => {
  it('returns null show + null subrecords + null previous_show when nothing seeded', async () => {
    const res = await route.GET(makeReq({ path: `/api/shows/tonight?date=${DATE}` }));
    assert.equal(res.status, 200);
    const j = await res.json();
    assert.equal(j.show, null);
    assert.equal(j.stage_setup, null);
    assert.equal(j.latest_sound_scene, null);
    assert.equal(j.box_office_summary, null);
    assert.deepEqual(j.run_of_show, []);
    assert.equal(j.previous_show, null);
    assert.equal(j.date, DATE);
  });

  it('still returns previous_show when no show tonight', async () => {
    seedShow({ date: '2026-05-09', band: 'Yesterday' });
    const res = await route.GET(makeReq({ path: `/api/shows/tonight?date=${DATE}` }));
    assert.equal(res.status, 200);
    const j = await res.json();
    assert.equal(j.show, null);
    assert.equal(j.previous_show.band_name, 'Yesterday');
  });
});

// ── populated state ────────────────────────────────────────────

describe('GET /api/shows/tonight — show present', () => {
  it('returns the tonight show + all sub-records', async () => {
    const id = seedShow({ band: 'The Stand', status: { doors: '7pm', set1: '8:30pm' } });
    seedStageSetup(id, [
      { time: '7:00pm', label: 'Doors' },
      { time: '8:30pm', label: 'Set 1' },
    ]);
    seedSoundScene(id, 'Stand · House Mix', 102);
    seedSoundScene(id, 'Stand · Encore', 105);   // newer
    seedBoxLine(id, { source: 'dice', qty: 50, face: 20, fees: 100, scanned: true });
    seedBoxLine(id, { source: 'walkup', qty: 8, face: 25 });
    seedBoxLine(id, { source: 'comp', qty: 4, face: 0 });

    const res = await route.GET(makeReq({ path: `/api/shows/tonight?date=${DATE}` }));
    assert.equal(res.status, 200);
    const j = await res.json();

    assert.equal(j.show.band_name, 'The Stand');
    assert.equal(j.show_status.doors, '7pm');
    assert.equal(j.show_status.set1, '8:30pm');

    assert.ok(j.stage_setup);
    assert.equal(j.stage_setup.room_config, 'standard');
    assert.equal(j.run_of_show.length, 2);
    assert.equal(j.run_of_show[0].label, 'Doors');
    assert.equal(j.run_of_show[1].time, '8:30pm');

    assert.equal(j.latest_sound_scene.scene_name, 'Stand · Encore',
      'should pick the most recently saved sound scene');
    assert.equal(j.latest_sound_scene.spl_limit_db, 105);

    assert.equal(j.box_office_summary.total_qty, 62);
    assert.equal(j.box_office_summary.scanned_qty, 50);
    assert.equal(j.box_office_summary.total_revenue, 50 * 20 + 100 + 8 * 25 + 0);
    assert.equal(j.box_office_summary.by_source.dice.qty, 50);
    assert.equal(j.box_office_summary.by_source.comp.qty, 4);
  });

  it('returns attendance.status=unset when locations.capacity is null', async () => {
    const id = seedShow({ band: 'No Cap Band' });
    seedBoxLine(id, { source: 'dice', qty: 30, face: 20, scanned: true });
    // default location starts with capacity=NULL per beforeEach
    const res = await route.GET(makeReq({ path: `/api/shows/tonight?date=${DATE}` }));
    const j = await res.json();
    assert.equal(j.venue_capacity, null);
    assert.equal(j.attendance.status, 'unset');
    assert.equal(j.attendance.scanned_pct, null);
    assert.equal(j.attendance.scanned_qty, 30);
  });

  it('computes attendance status against locations.capacity', async () => {
    // Capacity 100; 50 scanned → status=near (50% boundary)
    conn.prepare(`UPDATE locations SET capacity = ? WHERE id = ?`).run(100, 'default');
    const id = seedShow({ band: 'Capped Band' });
    seedBoxLine(id, { source: 'dice', qty: 50, face: 20, scanned: true });
    seedBoxLine(id, { source: 'dice', qty: 20, face: 20 });  // sold but not scanned
    const res = await route.GET(makeReq({ path: `/api/shows/tonight?date=${DATE}` }));
    const j = await res.json();
    assert.equal(j.venue_capacity, 100);
    assert.equal(j.attendance.status, 'near');
    assert.equal(j.attendance.scanned_qty, 50);
    assert.equal(j.attendance.sold_qty, 70);
    assert.equal(j.attendance.scanned_pct, 50);
    assert.equal(j.attendance.capacity, 100);
  });

  it('attendance is null when no show tonight', async () => {
    // No seed — no show on DATE
    const res = await route.GET(makeReq({ path: `/api/shows/tonight?date=${DATE}` }));
    const j = await res.json();
    assert.equal(j.show, null);
    assert.equal(j.attendance, null);
  });

  it('honors the ?date= override', async () => {
    seedShow({ date: '2026-04-30', band: 'April 30 Band' });
    seedShow({ date: '2026-05-11', band: 'Tonight Band' });

    const res = await route.GET(makeReq({ path: '/api/shows/tonight?date=2026-04-30' }));
    const j = await res.json();
    assert.equal(j.show.band_name, 'April 30 Band');
  });

  it('per-show capacity override beats locations.capacity in effective_capacity', async () => {
    conn.prepare(`UPDATE locations SET capacity = ? WHERE id = ?`).run(220, 'default');
    const id = seedShow({ band: 'Override Band', status: { capacity: 180 } });
    seedBoxLine(id, { source: 'dice', qty: 162, face: 20, scanned: true });
    const res = await route.GET(makeReq({ path: `/api/shows/tonight?date=${DATE}` }));
    const j = await res.json();
    assert.equal(j.venue_capacity, 220);
    assert.equal(j.effective_capacity, 180);
    assert.equal(j.capacity_override, 180);
    // 162/180 = 90% → 'at' (>=80%)
    assert.equal(j.attendance.capacity, 180);
    assert.equal(j.attendance.status, 'at');
    void id;
  });

  it('falls back to venue capacity when status_json.capacity is 0/invalid', async () => {
    conn.prepare(`UPDATE locations SET capacity = ? WHERE id = ?`).run(220, 'default');
    seedShow({ band: 'No Override', status: { capacity: 0 } });
    const res = await route.GET(makeReq({ path: `/api/shows/tonight?date=${DATE}` }));
    const j = await res.json();
    assert.equal(j.effective_capacity, 220);
    assert.equal(j.capacity_override, null);
  });

  it('does NOT cross locations', async () => {
    // Seed a show in a non-default location with the same date — the
    // default-location request must NOT see it.
    const runId = seedIngestRun();
    conn
      .prepare(
        `INSERT INTO shows
           (location_id, band_name, show_date, price, status_json, source_row, ingested_at, ingest_run_id)
         VALUES ('other', 'Other Loc Band', ?, 20, '{}', 1, ?, ?)`,
      )
      .run(DATE, new Date().toISOString(), runId);

    const res = await route.GET(makeReq({ path: `/api/shows/tonight?date=${DATE}` }));
    const j = await res.json();
    assert.equal(j.show, null, 'default location should not see the "other" show');
  });
});
