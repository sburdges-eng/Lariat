#!/usr/bin/env node
// Tests for the Prism.fm scaffold. Three layers:
//   1. auth — readPrismCreds() error / normalize behavior.
//   2. client — getPrismEvents() throws the SCAFFOLD error when no
//      endpoint path is provided; works correctly when one IS provided
//      (simulating the post-CSM-handshake state) using a mock fetchImpl.
//   3. ingest — eventToRow + ingestPrismEvents end-to-end with a fixture.
//
// Run: node --experimental-strip-types --test tests/js/test-prism.mjs

import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';

const { getDb, setDbPathForTest } = await import('../../lib/db.ts');
const { resolveOrCreateEvent } = await import('../../lib/entities.ts');
const { readPrismCreds } = await import('../../scripts/prism_api/auth.mjs');
const { getPrismEvents } = await import('../../scripts/prism_api/client.mjs');
const { eventToRow, mapEventStatus, ingestPrismEvents } = await import(
  '../../scripts/ingest-prism.mjs'
);

setDbPathForTest(':memory:');
const db = getDb();
after(() => setDbPathForTest(null));

beforeEach(() => {
  db.exec(`
    DELETE FROM external_ids;
    DELETE FROM entities_events;
    DELETE FROM prism_events;
  `);
});

// ── auth ───────────────────────────────────────────────────────────

describe('readPrismCreds', () => {
  beforeEach(() => {
    delete process.env.PRISM_API_KEY;
    delete process.env.PRISM_API_HOST;
    delete process.env.PRISM_VENUE_ID;
  });

  it('throws when key + host missing', () => {
    assert.throws(() => readPrismCreds(), /PRISM_API_HOST.*PRISM_API_KEY/s);
  });

  it('normalizes host', () => {
    process.env.PRISM_API_KEY = 'pk-12345678';
    process.env.PRISM_API_HOST = 'https://api.prism.fm/';
    const c = readPrismCreds();
    assert.strictEqual(c.host, 'api.prism.fm');
    assert.strictEqual(c.venueId, null);
    assert.strictEqual(c.maskedKey.startsWith('pk-1'), true);
  });

  it('preserves venueId when set', () => {
    process.env.PRISM_API_KEY = 'pk-12345678';
    process.env.PRISM_API_HOST = 'api.prism.fm';
    process.env.PRISM_VENUE_ID = 'venue-7';
    assert.strictEqual(readPrismCreds().venueId, 'venue-7');
  });
});

// ── client (scaffold guard) ────────────────────────────────────────

const fakeCreds = () => ({
  host: 'api.prism.fm', apiKey: 'k', venueId: null, maskedKey: 'k***',
});

describe('getPrismEvents — scaffold guard', () => {
  it('throws SCAFFOLD error when no endpointPath supplied', async () => {
    let err;
    try {
      await getPrismEvents({ since: '2026-04-01', creds: fakeCreds() });
    } catch (e) {
      err = e;
    }
    assert.ok(err);
    assert.match(err.message, /SCAFFOLD/);
  });

  it('makes a request when endpointPath is provided (post-handshake state)', async () => {
    const calls = [];
    const fetchImpl = async (url, opts) => {
      calls.push({ url, opts });
      return {
        ok: true, status: 200, statusText: 'OK',
        async json() {
          return { events: [{ id: 'e1', name: 'Test Show', event_date: '2026-04-15' }] };
        },
        async text() { return ''; },
      };
    };
    const events = await getPrismEvents({
      since: '2026-04-01', until: '2026-04-30',
      creds: fakeCreds(), fetchImpl,
      endpointPath: 'v1/events',
    });
    assert.strictEqual(events.length, 1);
    assert.strictEqual(events[0].id, 'e1');
    assert.strictEqual(calls.length, 1);
    assert.match(calls[0].url, /api\.prism\.fm\/v1\/events/);
    assert.strictEqual(calls[0].opts.headers.Authorization, 'Bearer k');
  });

  it('accepts a bare-array response shape', async () => {
    const fetchImpl = async () => ({
      ok: true, status: 200, statusText: 'OK',
      async json() { return [{ id: 'a' }, { id: 'b' }]; },
      async text() { return ''; },
    });
    const events = await getPrismEvents({
      creds: fakeCreds(), fetchImpl, endpointPath: 'v1/events',
    });
    assert.strictEqual(events.length, 2);
  });
});

// ── eventToRow ─────────────────────────────────────────────────────

describe('eventToRow', () => {
  it('maps a typical Prism event', () => {
    const r = eventToRow({
      id: 'evt-77',
      name: 'Soulcraft Skyfire',
      event_date: '2026-05-10',
      doors_at: '2026-05-10T19:00:00Z',
      show_at: '2026-05-10T20:00:00Z',
      venue: 'Lariat Hall',
      headliner: 'Soulcraft',
      supports: ['Zinga Son'],
      ticket_count: 240,
      capacity: 500,
      status: 'on-sale',
    }, 'default');
    assert.strictEqual(r.prism_id, 'evt-77');
    assert.strictEqual(r.display_name, 'Soulcraft Skyfire');
    assert.strictEqual(r.headliner, 'Soulcraft');
    assert.strictEqual(r.supports_json, '["Zinga Son"]');
    assert.strictEqual(r.ticket_count, 240);
    assert.match(r.raw_json, /"id":"evt-77"/);
  });

  it('returns null for events without an identifiable id', () => {
    assert.strictEqual(eventToRow({ name: 'mystery' }, 'default'), null);
  });

  it('falls back through alternative id fields', () => {
    assert.strictEqual(eventToRow({ uuid: 'u-1' }, 'default')?.prism_id, 'u-1');
    assert.strictEqual(eventToRow({ event_id: 99 }, 'default')?.prism_id, '99');
  });
});

describe('mapEventStatus', () => {
  it('maps known Prism statuses to canonical entity statuses', () => {
    assert.strictEqual(mapEventStatus('confirmed'), 'confirmed');
    assert.strictEqual(mapEventStatus('on-sale'), 'confirmed');
    assert.strictEqual(mapEventStatus('cancelled'), 'cancelled');
    assert.strictEqual(mapEventStatus('Completed'), 'completed');
    assert.strictEqual(mapEventStatus('whatever'), 'planned');
    assert.strictEqual(mapEventStatus(undefined), 'planned');
  });
});

// ── ingestPrismEvents (end-to-end with a fixture) ──────────────────

describe('ingestPrismEvents — apply path', () => {
  it('writes prism_events + entities_events for each fixture row', () => {
    const fixture = [
      { id: 'p1', name: 'Show A', event_date: '2026-05-01', status: 'confirmed' },
      { id: 'p2', name: 'Show B', event_date: '2026-05-08', status: 'cancelled' },
    ];
    const stats = ingestPrismEvents(
      db, fixture, { apply: true, location: 'default' },
      (input) => resolveOrCreateEvent(db, input),
    );
    assert.deepStrictEqual(stats, { pulled: 2, mapped: 2, written: 2, skipped: 0 });
    const events = db
      .prepare(`SELECT prism_id, display_name, event_uuid FROM prism_events ORDER BY prism_id`)
      .all();
    assert.strictEqual(events.length, 2);
    assert.strictEqual(events[0].prism_id, 'p1');
    assert.ok(events[0].event_uuid);

    const entities = db
      .prepare(`SELECT uuid, status FROM entities_events ORDER BY display_name`)
      .all();
    assert.strictEqual(entities.length, 2);
    assert.strictEqual(entities[0].status, 'confirmed');
    assert.strictEqual(entities[1].status, 'cancelled');
  });

  it('dry-run reports counts without writing', () => {
    const stats = ingestPrismEvents(
      db, [{ id: 'p9', name: 'X' }],
      { apply: false, location: 'default' },
      (input) => resolveOrCreateEvent(db, input),
    );
    assert.strictEqual(stats.mapped, 1);
    assert.strictEqual(stats.written, 0);
    const c = db.prepare(`SELECT COUNT(*) as c FROM prism_events`).get().c;
    assert.strictEqual(c, 0);
  });

  it('idempotent: a second --apply on the same fixture upserts in place', () => {
    const fixture = [{ id: 'pX', name: 'A', event_date: '2026-05-01' }];
    ingestPrismEvents(db, fixture, { apply: true, location: 'default' },
      (input) => resolveOrCreateEvent(db, input));
    const beforeUuid = db.prepare(`SELECT event_uuid FROM prism_events WHERE prism_id='pX'`).get().event_uuid;

    // Re-ingest with an updated display_name; row should update, NOT duplicate.
    ingestPrismEvents(db,
      [{ id: 'pX', name: 'A — RENAMED', event_date: '2026-05-01' }],
      { apply: true, location: 'default' },
      (input) => resolveOrCreateEvent(db, input));
    const rows = db.prepare(`SELECT prism_id, display_name, event_uuid FROM prism_events`).all();
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].display_name, 'A — RENAMED');
    assert.strictEqual(rows[0].event_uuid, beforeUuid, 'UUID must persist across upserts');
  });

  it('skips rows with no identifiable id', () => {
    const stats = ingestPrismEvents(
      db, [{ name: 'orphan' }, { id: 'ok' }],
      { apply: true, location: 'default' },
      (input) => resolveOrCreateEvent(db, input),
    );
    assert.strictEqual(stats.skipped, 1);
    assert.strictEqual(stats.written, 1);
  });
});
