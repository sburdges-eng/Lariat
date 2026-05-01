#!/usr/bin/env node
// Tests for lib/beoPrepHistory.getPrepMedianForItems — the helper backing
// the menu-engineering "Prep median" column. Exercises numeric coercion
// of the text-typed `amount_qty` column and the JS-side median compute.
//
// Run: node --experimental-strip-types --test tests/js/test-prep-median.mjs

import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

register(new URL('./resolver.mjs', import.meta.url));

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-prep-median-'));
const TMP_DB = path.join(TMP_DIR, 'lariat-test.db');

const db = await import('../../lib/db.ts');
const helper = await import('../../lib/beoPrepHistory.ts');

db.setDbPathForTest(TMP_DB);
const testDb = db.getDb();

after(() => {
  db.setDbPathForTest(null);
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

beforeEach(() => {
  testDb.prepare('DELETE FROM beo_prep_history').run();
});

const LOC = 'default';

function insert({
  item, amount_qty, event_date = '2026-03-15', client = 'Acme',
  type = 'Main Item', source = 'test_seed', loc = LOC,
}) {
  testDb.prepare(
    `INSERT INTO beo_prep_history
       (location_id, client, event_date, type, item, amount_qty, source)
     VALUES (?,?,?,?,?,?,?)`
  ).run(loc, client, event_date, type, item, amount_qty, source);
}

describe('getPrepMedianForItems — empty inputs', () => {
  it('returns an empty Map when items is empty', () => {
    insert({ item: 'Mac Balls', amount_qty: '50' });
    const m = helper.getPrepMedianForItems(testDb, LOC, []);
    assert.equal(m.size, 0);
  });

  it('skips empty/whitespace items and dedupes by lowercase', () => {
    insert({ item: 'Mac Balls', amount_qty: '50' });
    const m = helper.getPrepMedianForItems(testDb, LOC, ['Mac Balls', 'mac balls', '', '   ']);
    // Both casings collapse to one key.
    assert.equal(m.size, 1);
    assert.ok(m.has('mac balls'));
  });

  it('omits items with no rows in beo_prep_history', () => {
    insert({ item: 'Mac Balls', amount_qty: '50' });
    const m = helper.getPrepMedianForItems(testDb, LOC, ['Carnitas', 'Mac Balls']);
    assert.equal(m.size, 1);
    assert.ok(m.has('mac balls'));
  });
});

describe('getPrepMedianForItems — numeric coercion', () => {
  it('parses bare integers and decimals', () => {
    insert({ item: 'Mac Balls', amount_qty: '50' });
    insert({ item: 'Mac Balls', amount_qty: '40.5' });
    insert({ item: 'Mac Balls', amount_qty: '60' });
    const m = helper.getPrepMedianForItems(testDb, LOC, ['Mac Balls']);
    const row = m.get('mac balls');
    assert.equal(row.samples, 3);
    assert.equal(row.median, 50); // sorted: 40.5, 50, 60 → middle = 50
  });

  it('parses leading number with trailing unit token ("30 ea", "50 lb")', () => {
    insert({ item: 'Mac Balls', amount_qty: '30 ea' });
    insert({ item: 'Mac Balls', amount_qty: '50 lb' });
    const m = helper.getPrepMedianForItems(testDb, LOC, ['Mac Balls']);
    const row = m.get('mac balls');
    assert.equal(row.samples, 2);
    assert.equal(row.median, 40); // (30+50)/2
  });

  it('excludes descriptive non-numeric values from the median', () => {
    insert({ item: 'Mac Balls', amount_qty: 'as needed' });
    insert({ item: 'Mac Balls', amount_qty: 'TBD' });
    insert({ item: 'Mac Balls', amount_qty: null });
    insert({ item: 'Mac Balls', amount_qty: '50' });
    insert({ item: 'Mac Balls', amount_qty: '60' });
    const m = helper.getPrepMedianForItems(testDb, LOC, ['Mac Balls']);
    const row = m.get('mac balls');
    assert.equal(row.samples, 2);          // only "50" + "60" parse
    assert.equal(row.total_rows, 5);       // but all 5 were matched
    assert.equal(row.median, 55);
  });

  it('omits items where every amount_qty is non-numeric', () => {
    insert({ item: 'Sauce', amount_qty: 'as needed' });
    insert({ item: 'Sauce', amount_qty: 'TBD' });
    const m = helper.getPrepMedianForItems(testDb, LOC, ['Sauce']);
    assert.equal(m.size, 0);
  });

  it('treats zero and negative amounts as non-numeric (sentinel data)', () => {
    insert({ item: 'X', amount_qty: '0' });
    insert({ item: 'X', amount_qty: '-5' });
    insert({ item: 'X', amount_qty: '10' });
    const m = helper.getPrepMedianForItems(testDb, LOC, ['X']);
    const row = m.get('x');
    assert.equal(row.samples, 1);
    assert.equal(row.median, 10);
  });
});

describe('getPrepMedianForItems — median math', () => {
  it('odd count picks the middle element', () => {
    insert({ item: 'A', amount_qty: '1' });
    insert({ item: 'A', amount_qty: '7' });
    insert({ item: 'A', amount_qty: '3' });
    const m = helper.getPrepMedianForItems(testDb, LOC, ['A']);
    assert.equal(m.get('a').median, 3);
  });

  it('even count averages the middle pair', () => {
    insert({ item: 'A', amount_qty: '10' });
    insert({ item: 'A', amount_qty: '20' });
    insert({ item: 'A', amount_qty: '30' });
    insert({ item: 'A', amount_qty: '40' });
    const m = helper.getPrepMedianForItems(testDb, LOC, ['A']);
    assert.equal(m.get('a').median, 25); // (20+30)/2
  });

  it('single sample returns that value as the median', () => {
    insert({ item: 'A', amount_qty: '99' });
    const m = helper.getPrepMedianForItems(testDb, LOC, ['A']);
    assert.equal(m.get('a').median, 99);
  });
});

describe('getPrepMedianForItems — scoping', () => {
  it('matches case-insensitively but does not match substrings', () => {
    insert({ item: 'Mac Balls',          amount_qty: '50' });
    insert({ item: 'Carnitas Mac Balls', amount_qty: '999' });
    const m = helper.getPrepMedianForItems(testDb, LOC, ['mac balls']);
    const row = m.get('mac balls');
    assert.equal(row.samples, 1); // does not pull in "Carnitas Mac Balls"
    assert.equal(row.median, 50);
  });

  it('respects location_id isolation', () => {
    insert({ item: 'Mac Balls', amount_qty: '50', loc: 'station-2' });
    const a = helper.getPrepMedianForItems(testDb, LOC, ['Mac Balls']);
    const b = helper.getPrepMedianForItems(testDb, 'station-2', ['Mac Balls']);
    assert.equal(a.size, 0);
    assert.equal(b.size, 1);
    assert.equal(b.get('mac balls').median, 50);
  });

  it('returns medians for many items in a single batch', () => {
    insert({ item: 'A', amount_qty: '10' });
    insert({ item: 'A', amount_qty: '20' });
    insert({ item: 'B', amount_qty: '5' });
    insert({ item: 'C', amount_qty: 'as needed' });
    const m = helper.getPrepMedianForItems(testDb, LOC, ['A', 'B', 'C', 'D']);
    assert.equal(m.size, 2); // C all-non-numeric, D has no rows
    assert.equal(m.get('a').median, 15);
    assert.equal(m.get('b').median, 5);
    assert.equal(m.has('c'), false);
    assert.equal(m.has('d'), false);
  });
});
