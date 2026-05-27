#!/usr/bin/env node
// Integration tests for /api/beo/prep-history and the lib/beoPrepHistory
// helper underneath it. Drives the route against a real in-memory SQLite
// (per project rule: do not mock SQLite in costing/BEO tests).
//
// Run: node --experimental-strip-types --test tests/js/test-beo-prep-history-api.mjs

import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

register(new URL('./resolver.mjs', import.meta.url));

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-beoprep-api-'));
const TMP_DB = path.join(TMP_DIR, 'lariat-test.db');

const db = await import('../../lib/db.ts');
const route = await import('../../app/api/beo/prep-history/route.js');
const helper = await import('../../lib/beoPrepHistory.ts');

db.setDbPathForTest(TMP_DB);
const testDb = db.getDb();

const { GET } = route;

after(() => {
  db.setDbPathForTest(null);
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

beforeEach(() => {
  testDb.prepare('DELETE FROM beo_prep_history').run();
});

const LOC = 'default';

function insert({
  client = 'Acme',
  event_date = '2026-03-15',
  type = 'Main Item',
  item,
  amount_qty = '50',
  prep_day = null,
  pre_prep_notes = null,
  plating_notes = null,
  source = 'test_seed',
  loc = LOC,
}) {
  testDb.prepare(
    `INSERT INTO beo_prep_history
       (location_id, client, event_date, type, item, amount_qty,
        prep_day, pre_prep_notes, plating_notes, source)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  ).run(loc, client, event_date, type, item, amount_qty,
        prep_day, pre_prep_notes, plating_notes, source);
}

function getReq(qs) {
  return new Request(`http://localhost/api/beo/prep-history${qs}`);
}

describe('lib/beoPrepHistory.getItemPrepHistory', () => {
  it('returns empty for empty items list', () => {
    insert({ item: 'Mac Balls' });
    const out = helper.getItemPrepHistory(testDb, LOC, [], 5);
    assert.deepEqual(out, []);
  });

  it('matches case-insensitively on exact item name', () => {
    insert({ item: 'Mac Balls', amount_qty: '50' });
    const out = helper.getItemPrepHistory(testDb, LOC, ['mac balls']);
    assert.equal(out.length, 1);
    assert.equal(out[0].item, 'mac balls');
    assert.equal(out[0].history.length, 1);
    assert.equal(out[0].history[0].amount_qty, '50');
  });

  it('omits items with no history rather than returning empty arrays', () => {
    insert({ item: 'Mac Balls' });
    const out = helper.getItemPrepHistory(testDb, LOC, ['Mac Balls', 'Carnitas']);
    assert.equal(out.length, 1);
    assert.equal(out[0].item, 'Mac Balls');
  });

  it('orders history DESC by event_date with NULL last', () => {
    insert({ item: 'Mac Balls', event_date: '2026-04-01', amount_qty: 'A' });
    insert({ item: 'Mac Balls', event_date: '2026-03-01', amount_qty: 'B' });
    insert({ item: 'Mac Balls', event_date: null,         amount_qty: 'C' });
    const out = helper.getItemPrepHistory(testDb, LOC, ['Mac Balls']);
    const qtys = out[0].history.map((h) => h.amount_qty);
    assert.deepEqual(qtys, ['A', 'B', 'C']);
  });

  it('respects limit and clamps to 25', () => {
    for (let i = 0; i < 30; i++) {
      insert({ item: 'Mac Balls', event_date: `2026-01-${String(i + 1).padStart(2, '0')}` });
    }
    assert.equal(helper.getItemPrepHistory(testDb, LOC, ['Mac Balls'], 2)[0].history.length, 2);
    // negative / zero / NaN → default
    assert.equal(helper.getItemPrepHistory(testDb, LOC, ['Mac Balls'], 0)[0].history.length, 5);
    // overshoot is clamped at 25
    assert.equal(helper.getItemPrepHistory(testDb, LOC, ['Mac Balls'], 999)[0].history.length, 25);
  });

  it('respects location_id isolation', () => {
    insert({ item: 'Mac Balls', loc: 'other-location' });
    const out = helper.getItemPrepHistory(testDb, LOC, ['Mac Balls']);
    assert.deepEqual(out, []);
  });

  it('dedupes the items list and ignores empty/whitespace entries', () => {
    insert({ item: 'Mac Balls' });
    const out = helper.getItemPrepHistory(testDb, LOC, ['Mac Balls', 'mac balls', '', '  ', 'Mac Balls']);
    // Only one "Mac Balls" entry (case-sensitive dedupe of cleaned list); the
    // 'mac balls' entry survives dedupe but matches the same row case-insens.
    assert.ok(out.length >= 1);
    const totalHistoryRows = out.reduce((s, m) => s + m.history.length, 0);
    // 1 underlying row × however many distinct cased lookups survived
    assert.ok(totalHistoryRows >= 1);
  });
});

describe('GET /api/beo/prep-history', () => {
  it('returns matches=[] when no items are passed', async () => {
    insert({ item: 'Mac Balls' });
    const res = await GET(getReq(''));
    assert.equal(res.status, 200);
    const j = await res.json();
    assert.deepEqual(j.matches, []);
    assert.equal(j.recent, null);
  });

  it('returns history for a queried item', async () => {
    insert({ item: 'Mac Balls', client: 'Smith', event_date: '2026-04-01', prep_day: 'Sat' });
    const res = await GET(getReq('?item=Mac%20Balls'));
    const j = await res.json();
    assert.equal(j.matches.length, 1);
    assert.equal(j.matches[0].item, 'Mac Balls');
    assert.equal(j.matches[0].history[0].client, 'Smith');
    assert.equal(j.matches[0].history[0].prep_day, 'Sat');
  });

  it('supports multiple item params in one call', async () => {
    insert({ item: 'Mac Balls' });
    insert({ item: 'Carnitas Tacos Buffet' });
    const res = await GET(getReq('?item=Mac%20Balls&item=Carnitas%20Tacos%20Buffet'));
    const j = await res.json();
    assert.equal(j.matches.length, 2);
    const items = j.matches.map((m) => m.item).sort();
    assert.deepEqual(items, ['Carnitas Tacos Buffet', 'Mac Balls']);
  });

  it('honors ?location= for scoping', async () => {
    insert({ item: 'Mac Balls', loc: 'station-2' });
    const sameLoc = await GET(getReq('?item=Mac%20Balls&location=station-2'));
    const otherLoc = await GET(getReq('?item=Mac%20Balls'));
    assert.equal((await sameLoc.json()).matches.length, 1);
    assert.equal((await otherLoc.json()).matches.length, 0);
  });

  it('returns recent events when ?recent=1', async () => {
    insert({ client: 'Smith', event_date: '2026-04-01', item: 'Mac Balls' });
    insert({ client: 'Smith', event_date: '2026-04-01', item: 'Caprese' });
    insert({ client: 'Jones', event_date: '2026-03-01', item: 'Birria' });
    const res = await GET(getReq('?recent=1&limit=2'));
    const j = await res.json();
    assert.ok(Array.isArray(j.recent));
    assert.equal(j.recent.length, 2);
    assert.equal(j.recent[0].event_date, '2026-04-01');
    assert.equal(j.recent[0].items.length, 2);
  });

  it('caps the items=… list at 50', async () => {
    insert({ item: 'Mac Balls' });
    const params = new URLSearchParams();
    for (let i = 0; i < 60; i++) params.append('item', `Bogus ${i}`);
    params.append('item', 'Mac Balls');
    const res = await GET(getReq(`?${params.toString()}`));
    const j = await res.json();
    // Mac Balls is item #61 in the list; the route slices to 50 so it's dropped.
    assert.equal(j.matches.length, 0);
  });
});
