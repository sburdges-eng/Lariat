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
     DELETE FROM beo_events;`,
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
