#!/usr/bin/env node
// Integration tests for GET /api/lari/predictions.
// Run: node --experimental-strip-types --test tests/js/test-lari-predictions-api.mjs

import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register(new URL('./resolver.mjs', import.meta.url));

const ORIGINAL_PIN = process.env.LARIAT_PIN;
const ORIGINAL_SECRET = process.env.LARIAT_PIN_SECRET;
process.env.LARIAT_PIN = '4242';
delete process.env.LARIAT_PIN_SECRET;

const db = await import('../../lib/db.ts');
const route = await import('../../app/api/lari/predictions/route.js');

db.setDbPathForTest(':memory:');
const conn = db.getDb();

after(() => {
  db.setDbPathForTest(null);
  process.env.LARIAT_PIN = ORIGINAL_PIN;
  if (ORIGINAL_SECRET !== undefined) process.env.LARIAT_PIN_SECRET = ORIGINAL_SECRET;
});

beforeEach(() => {
  conn.exec(
    `DELETE FROM beo_prep_tasks;
     DELETE FROM beo_line_items;
     DELETE FROM beo_courses;
     DELETE FROM beo_events;
     DELETE FROM spl_readings;
     DELETE FROM sound_scenes;
     DELETE FROM shows;
     DELETE FROM ingest_runs;
     DELETE FROM waitlist_parties;`,
  );
});

const PIN_COOKIE = 'lariat_pin_ok=1';
const TODAY = '2026-05-13';

function makeReq({ path = '/api/lari/predictions', withPin = true } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (withPin) headers.cookie = PIN_COOKIE;
  return new Request(`http://localhost${path}`, { headers });
}

function seedEvent({
  title = 'Hendricks Wedding',
  date = TODAY,
  contact = 'Sarah',
  guests = 80,
  location = 'default',
} = {}) {
  const r = conn
    .prepare(
      `INSERT INTO beo_events (title, event_date, event_time, contact_name, guest_count, notes, location_id)
       VALUES (?, ?, '5pm', ?, ?, NULL, ?)`,
    )
    .run(title, date, contact, guests, location);
  return Number(r.lastInsertRowid);
}

function seedLine(eventId, name = 'Brisket', qty = 80) {
  conn
    .prepare(
      `INSERT INTO beo_line_items (event_id, item_name, quantity)
       VALUES (?, ?, ?)`,
    )
    .run(eventId, name, qty);
}

function seedPrepTask(eventId, task, dueDate, done = 0, location = 'default') {
  conn
    .prepare(
      `INSERT INTO beo_prep_tasks (event_id, task, due_date, done, location_id)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(eventId, task, dueDate, done, location);
}

// ── PIN gate ───────────────────────────────────────────────────

describe('GET /api/lari/predictions — auth', () => {
  it('returns 401 without a PIN cookie', async () => {
    const res = await route.GET(makeReq({ withPin: false }));
    assert.equal(res.status, 401);
  });
});

// ── Surface routing ─────────────────────────────────────────────

describe('GET /api/lari/predictions — surface routing', () => {
  it('unknown surface returns empty predictions + note', async () => {
    const res = await route.GET(makeReq({ path: '/api/lari/predictions?surface=mystery' }));
    assert.equal(res.status, 200);
    const j = await res.json();
    assert.equal(j.surface, 'mystery');
    assert.deepEqual(j.predictions, []);
    assert.match(j.note, /no LaRi handler/);
  });

  it('defaults to surface=beo when omitted', async () => {
    const res = await route.GET(makeReq({ path: '/api/lari/predictions' }));
    assert.equal(res.status, 200);
    const j = await res.json();
    assert.equal(j.surface, 'beo');
  });
});

// ── BEO predictions ─────────────────────────────────────────────

describe('GET /api/lari/predictions — surface=beo', () => {
  it('returns empty predictions when no events seeded', async () => {
    const res = await route.GET(makeReq({ path: `/api/lari/predictions?surface=beo&date=${TODAY}` }));
    assert.equal(res.status, 200);
    const j = await res.json();
    assert.deepEqual(j.predictions, []);
  });

  it('emits alert + warn for a tonight event with no contact + thin menu + many guests', async () => {
    const id = seedEvent({ contact: null, guests: 80 });
    seedLine(id);
    seedLine(id, 'Salad');
    // 2 lines for 80 guests + no contact

    const res = await route.GET(makeReq({ path: `/api/lari/predictions?surface=beo&date=${TODAY}` }));
    const j = await res.json();
    assert.ok(j.predictions.length >= 2);
    assert.ok(j.predictions.find((p) => p.severity === 'alert'),  'missing-contact alert');
    assert.ok(j.predictions.find((p) => p.id === `beo-thin-menu-${id}`), 'thin-menu warn');
  });

  it('emits alert for overdue prep_task', async () => {
    const id = seedEvent({ date: '2026-05-20', contact: 'Sam' });
    seedPrepTask(id, 'order linens', '2026-05-10');

    const res = await route.GET(makeReq({ path: `/api/lari/predictions?surface=beo&date=${TODAY}` }));
    const j = await res.json();
    const alert = j.predictions.find((p) => p.severity === 'alert');
    assert.ok(alert);
    assert.match(alert.text, /order linens/);
  });

  it('respects ?location= scoping', async () => {
    seedEvent({ title: 'Loc A Event', date: TODAY, contact: null, location: 'default' });
    seedEvent({ title: 'Loc B Event', date: TODAY, contact: null, location: 'other' });

    const res = await route.GET(makeReq({ path: `/api/lari/predictions?surface=beo&location=other&date=${TODAY}` }));
    const j = await res.json();
    const titles = j.predictions.map((p) => p.text).join(' ');
    assert.ok(titles.includes('Loc B Event'), 'should see Loc B event');
    assert.ok(!titles.includes('Loc A Event'), 'should NOT see Loc A event');
  });

  it('respects ?date= override', async () => {
    seedEvent({ title: 'Override Event', date: '2026-05-15', contact: null });

    const res = await route.GET(makeReq({ path: '/api/lari/predictions?surface=beo&date=2026-05-15' }));
    const j = await res.json();
    assert.ok(j.predictions.find((p) => p.text.includes('Override Event')));
  });

  it('returns predictions[] as a stable LariPrediction shape', async () => {
    const id = seedEvent({ contact: null });
    const res = await route.GET(makeReq({ path: `/api/lari/predictions?surface=beo&date=${TODAY}` }));
    const j = await res.json();
    for (const p of j.predictions) {
      assert.ok(typeof p.id === 'string' && p.id.length > 0);
      assert.equal(p.surface, 'beo');
      assert.ok(['ok', 'warn', 'alert'].includes(p.severity));
      assert.ok(typeof p.text === 'string' && p.text.length > 0);
    }
  });

  it('caps response at 5 predictions even with many alerts', async () => {
    for (let i = 0; i < 10; i++) {
      seedEvent({ title: `E${i}`, date: TODAY, contact: null, guests: 10 });
    }
    const res = await route.GET(makeReq({ path: `/api/lari/predictions?surface=beo&date=${TODAY}` }));
    const j = await res.json();
    assert.ok(j.predictions.length <= 5);
  });
});

// ── Sound predictions (V6a) ──────────────────────────────────────

function seedIngestRun() {
  const r = conn
    .prepare(`INSERT INTO ingest_runs (kind, started_at, status) VALUES ('test', ?, 'ok')`)
    .run(new Date().toISOString());
  return Number(r.lastInsertRowid);
}

function seedShow({ band = 'The Stand', date = TODAY, location = 'default' } = {}) {
  const runId = seedIngestRun();
  const r = conn
    .prepare(
      `INSERT INTO shows
         (location_id, band_name, show_date, price, status_json, source_row, ingested_at, ingest_run_id)
       VALUES (?, ?, ?, 20, '{}', 1, ?, ?)`,
    )
    .run(location, band, date, new Date().toISOString(), runId);
  return Number(r.lastInsertRowid);
}

function seedSoundScene(showId, { name = 'Mix A', splLimit = 100, plotChannels = 4 } = {}) {
  const channels = Array.from({ length: plotChannels }, (_, i) => ({ id: i + 1, label: `CH${i + 1}` }));
  const plot = JSON.stringify({ channels, monitors: [] });
  const r = conn
    .prepare(
      `INSERT INTO sound_scenes (show_id, location_id, scene_name, plot_json, spl_limit_db, notes)
       VALUES (?, 'default', ?, ?, ?, NULL)`,
    )
    .run(showId, name, plot, splLimit);
  return Number(r.lastInsertRowid);
}

function seedSplReading(showId, dbValue, sceneId = null) {
  conn
    .prepare(
      `INSERT INTO spl_readings (show_id, location_id, scene_id, db_value)
       VALUES (?, 'default', ?, ?)`,
    )
    .run(showId, sceneId, dbValue);
}

describe('GET /api/lari/predictions — surface=sound', () => {
  it('400s when show_id is missing', async () => {
    const res = await route.GET(makeReq({ path: '/api/lari/predictions?surface=sound' }));
    assert.equal(res.status, 400);
    const j = await res.json();
    assert.match(j.error, /show_id/);
  });

  it('400s when show_id is non-positive integer', async () => {
    const res = await route.GET(makeReq({ path: '/api/lari/predictions?surface=sound&show_id=abc' }));
    assert.equal(res.status, 400);
  });

  it('returns empty + note when show_id is unknown', async () => {
    const res = await route.GET(makeReq({ path: '/api/lari/predictions?surface=sound&show_id=9999' }));
    assert.equal(res.status, 200);
    const j = await res.json();
    assert.deepEqual(j.predictions, []);
    assert.match(j.note, /not found/);
  });

  it('emits a no-scene warn when show exists but no scenes saved', async () => {
    const id = seedShow({ band: 'No Scene Band' });
    const res = await route.GET(makeReq({ path: `/api/lari/predictions?surface=sound&show_id=${id}` }));
    const j = await res.json();
    assert.equal(j.show_id, id);
    const warn = j.predictions.find((p) => p.id === `sound-no-scene-${id}`);
    assert.ok(warn);
    assert.match(warn.text, /No Scene Band/);
  });

  it('emits over-limit alert when spl_readings exceed scene limit', async () => {
    const id = seedShow({ band: 'Loud Band' });
    const sceneId = seedSoundScene(id, { splLimit: 100 });
    seedSplReading(id, 95, sceneId);
    seedSplReading(id, 105, sceneId);   // over
    seedSplReading(id, 108, sceneId);   // over
    seedSplReading(id, 92, sceneId);

    const res = await route.GET(makeReq({ path: `/api/lari/predictions?surface=sound&show_id=${id}` }));
    const j = await res.json();
    const alert = j.predictions.find((p) => p.id === `sound-over-limit-${id}`);
    assert.ok(alert, 'over-limit alert expected');
    assert.match(alert.text, /SPL exceeded 100 dB/);
  });

  it('respects location scoping (cross-location does not bleed)', async () => {
    const idDefault = seedShow({ band: 'Default Loc', location: 'default' });
    const idOther = seedShow({ band: 'Other Loc', location: 'other' });

    const res = await route.GET(makeReq({ path: `/api/lari/predictions?surface=sound&show_id=${idOther}` }));
    const j = await res.json();
    assert.match(j.note || '', /not found/);
    assert.equal(j.predictions.length, 0);

    const res2 = await route.GET(makeReq({ path: `/api/lari/predictions?surface=sound&show_id=${idOther}&location=other` }));
    const j2 = await res2.json();
    assert.equal(j2.show_id, idOther);
    assert.ok(j2.predictions.length >= 1);
  });
});

// ── Host predictions (V6b) ───────────────────────────────────────

function seedParty({ name = 'X', size = 2, joinedAgoMin = 5, status = 'waiting', location = 'default' } = {}) {
  const joinedAt = new Date(Date.now() - joinedAgoMin * 60_000).toISOString();
  const r = conn
    .prepare(
      `INSERT INTO waitlist_parties (location_id, party_name, party_size, joined_at, status)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(location, name, size, joinedAt, status);
  return Number(r.lastInsertRowid);
}

describe('GET /api/lari/predictions — surface=host', () => {
  it('returns empty predictions when no parties seeded', async () => {
    const res = await route.GET(makeReq({ path: `/api/lari/predictions?surface=host&date=${TODAY}` }));
    assert.equal(res.status, 200);
    const j = await res.json();
    assert.deepEqual(j.predictions, []);
  });

  it('emits ALERT when waiting > 8 (overflow)', async () => {
    for (let i = 0; i < 9; i++) seedParty({ name: `P${i}` });
    const res = await route.GET(makeReq({ path: `/api/lari/predictions?surface=host&date=${TODAY}` }));
    const j = await res.json();
    assert.ok(j.predictions.find((p) => p.id === `host-overflow-${TODAY}`));
  });

  it('emits ALERT for long-wait party (>45 min)', async () => {
    const id = seedParty({ name: 'Forgotten', joinedAgoMin: 60 });
    const res = await route.GET(makeReq({ path: `/api/lari/predictions?surface=host&date=${TODAY}` }));
    const j = await res.json();
    const alert = j.predictions.find((p) => p.id === `host-long-wait-${id}`);
    assert.ok(alert);
    assert.equal(alert.severity, 'alert');
  });

  it('respects ?location= scoping', async () => {
    seedParty({ name: 'Default Loc', location: 'default' });
    seedParty({ name: 'Other Loc 1', location: 'other' });
    seedParty({ name: 'Other Loc 2', location: 'other' });

    const res = await route.GET(makeReq({ path: `/api/lari/predictions?surface=host&location=other&date=${TODAY}` }));
    const j = await res.json();
    const rollup = j.predictions.find((p) => p.id === `host-rollup-${TODAY}`);
    assert.ok(rollup);
    assert.match(rollup.text, /2 waiting/);
  });
});
