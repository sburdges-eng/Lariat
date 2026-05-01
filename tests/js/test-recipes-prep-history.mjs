#!/usr/bin/env node
// Tests for lib/beoPrepHistory.getRecipePrepHistory — the helper that
// powers the recipes-page "Previously plated as" sidebar. Real
// in-memory SQLite (per project rule: do not mock SQLite).
//
// The recipes page prefetches via this helper on the server and ships
// a redacted shape to the client component, so there is no public API
// endpoint to test here.
//
// Run: node --experimental-strip-types --test tests/js/test-recipes-prep-history-api.mjs

import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

register(new URL('./resolver.mjs', import.meta.url));

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-recipes-prep-api-'));
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

describe('lib/beoPrepHistory.getRecipePrepHistory', () => {
  it('returns empty for a missing or too-short recipe name', () => {
    insert({ item: 'Aji Verde' });
    assert.deepEqual(helper.getRecipePrepHistory(testDb, LOC, '', 5), []);
    assert.deepEqual(helper.getRecipePrepHistory(testDb, LOC, '  ', 5), []);
    assert.deepEqual(helper.getRecipePrepHistory(testDb, LOC, 'A', 5), []);
    assert.deepEqual(helper.getRecipePrepHistory(testDb, LOC, 'Aj', 5), []);
  });

  it('matches exact item name case-insensitively', () => {
    insert({ item: 'Aji Verde', amount_qty: '50' });
    insert({ item: 'aji verde', amount_qty: '40' });
    const out = helper.getRecipePrepHistory(testDb, LOC, 'Aji Verde');
    assert.equal(out.length, 2);
    const items = out.map((r) => r.item).sort();
    assert.deepEqual(items, ['Aji Verde', 'aji verde']);
  });

  it('matches BEO item that abbreviates the recipe name (item shorter)', () => {
    // BEO sheet says "Aji" — recipe is "Aji Verde". Substring direction:
    // recipe-name LIKE %item%
    insert({ item: 'Aji', amount_qty: '60' });
    const out = helper.getRecipePrepHistory(testDb, LOC, 'Aji Verde');
    assert.equal(out.length, 1);
    assert.equal(out[0].item, 'Aji');
    assert.equal(out[0].amount_qty, '60');
  });

  it('matches BEO item that expands the recipe name (item longer)', () => {
    // Recipe "Tacos" should surface plate-up sheets like
    // "Carnitas Tacos Buffet". Substring direction: item LIKE %recipe%
    insert({ item: 'Carnitas Tacos Buffet', amount_qty: '150' });
    insert({ item: 'Fish Taco Buffet',      amount_qty: '120' }); // singular — no 'tacos' substring
    const out = helper.getRecipePrepHistory(testDb, LOC, 'Tacos');
    assert.equal(out.length, 1);
    assert.equal(out[0].item, 'Carnitas Tacos Buffet');
  });

  it('does not ghost-match when a tiny BEO item is shorter than the floor', () => {
    // A 1- or 2-char BEO item would substring-match nearly any recipe
    // name; the helper's LENGTH(item) >= 3 guard suppresses that.
    insert({ item: 'X',  amount_qty: '5' });
    insert({ item: 'AB', amount_qty: '5' });
    const out = helper.getRecipePrepHistory(testDb, LOC, 'Aji Verde');
    assert.deepEqual(out, []);
  });

  it('orders rows DESC by event_date with NULL last', () => {
    insert({ item: 'Aji Verde', event_date: '2026-04-01', amount_qty: 'A' });
    insert({ item: 'Aji',       event_date: '2026-03-01', amount_qty: 'B' });
    insert({ item: 'aji verde', event_date: null,         amount_qty: 'C' });
    const out = helper.getRecipePrepHistory(testDb, LOC, 'Aji Verde');
    const qtys = out.map((r) => r.amount_qty);
    assert.deepEqual(qtys, ['A', 'B', 'C']);
  });

  it('respects limit and clamps to 25', () => {
    for (let i = 0; i < 30; i++) {
      insert({ item: 'Aji Verde', event_date: `2026-01-${String(i + 1).padStart(2, '0')}` });
    }
    assert.equal(helper.getRecipePrepHistory(testDb, LOC, 'Aji Verde', 2).length, 2);
    assert.equal(helper.getRecipePrepHistory(testDb, LOC, 'Aji Verde', 0).length, 5);  // default
    assert.equal(helper.getRecipePrepHistory(testDb, LOC, 'Aji Verde', 999).length, 25); // cap
  });

  it('respects location_id isolation', () => {
    insert({ item: 'Aji Verde', loc: 'station-2' });
    assert.deepEqual(helper.getRecipePrepHistory(testDb, LOC, 'Aji Verde'), []);
    const out = helper.getRecipePrepHistory(testDb, 'station-2', 'Aji Verde');
    assert.equal(out.length, 1);
  });

  it('treats wildcard chars in the recipe name as literals (no over-match)', () => {
    // A recipe name with `%` or `_` should match its literal string in BEO
    // items, NOT explode into a wildcard that pulls in unrelated rows.
    insert({ item: 'Aji Verde',  amount_qty: '50' });
    insert({ item: 'Carnitas',   amount_qty: '40' });
    insert({ item: '100% Beef',  amount_qty: '60' });
    const out = helper.getRecipePrepHistory(testDb, LOC, '100%');
    assert.equal(out.length, 1);
    assert.equal(out[0].item, '100% Beef');
  });

  it('treats wildcard chars in BEO items as literals (no over-match)', () => {
    // A BEO item with `%` or `_` shouldn't expand into a wildcard pattern
    // that matches an unrelated recipe name.
    insert({ item: '100%',       amount_qty: '50' }); // ≥ 3 chars, eligible for direction B
    insert({ item: 'Some_Other', amount_qty: '40' });
    // Recipe name "Aji Verde" doesn't contain '100%' or 'Some_Other'.
    const out = helper.getRecipePrepHistory(testDb, LOC, 'Aji Verde');
    assert.deepEqual(out, []);
  });
});
