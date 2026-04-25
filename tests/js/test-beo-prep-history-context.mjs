#!/usr/bin/env node
// Unit tests for renderBeoPrepHistory — surfaces past-event prep records
// from beo_prep_history into the kitchen-assistant context window.
//
// Drives the helper directly (not through buildGroundedContext) so the
// test doesn't need to fabricate stations, recipes, etc.

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

register(new URL('./resolver.mjs', import.meta.url));

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-beoprepctx-'));
const TMP_DB = path.join(TMP_DIR, 'lariat-test.db');

const db = await import('../../lib/db.ts');
const ctx = await import('../../lib/kitchenAssistantContext.ts');

db.setDbPathForTest(TMP_DB);
const testDb = db.getDb();

after(() => {
  db.setDbPathForTest(null);
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

beforeEach(() => {
  testDb.prepare(`DELETE FROM beo_prep_history`).run();
});

const LOC = 'default';

function insertPrep({
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
  testDb
    .prepare(
      `INSERT INTO beo_prep_history
         (location_id, client, event_date, type, item, amount_qty,
          prep_day, pre_prep_notes, plating_notes, source)
       VALUES (?,?,?,?,?,?,?,?,?,?)`
    )
    .run(
      loc, client, event_date, type, item, amount_qty,
      prep_day, pre_prep_notes, plating_notes, source
    );
}

describe('renderBeoPrepHistory', () => {
  it('returns empty when table has no rows', () => {
    const out = ctx.renderBeoPrepHistory(testDb, LOC, 'how do I scale mac balls for a wedding?');
    assert.equal(out.text, '');
    assert.deepEqual(out.sources, []);
  });

  it('returns empty for a question that triggers no branch', () => {
    insertPrep({ item: 'Mac Balls' });
    // No catering/prep keyword AND no item-name match
    const out = ctx.renderBeoPrepHistory(testDb, LOC, 'what is the temperature of milk');
    assert.equal(out.text, '');
    assert.deepEqual(out.sources, []);
  });

  it('emits the recent-events block on a catering keyword', () => {
    insertPrep({ client: 'Smith', event_date: '2026-04-01', item: 'Mac Balls', amount_qty: '50' });
    insertPrep({ client: 'Smith', event_date: '2026-04-01', item: 'Caprese',   amount_qty: '20' });
    insertPrep({ client: 'Jones', event_date: '2026-03-01', item: 'Birria',    amount_qty: '30' });
    const out = ctx.renderBeoPrepHistory(testDb, LOC, 'plan prep for the wedding');
    assert.match(out.text, /RECENT BEO EVENTS/);
    assert.match(out.text, /2026-04-01 Smith:/);
    assert.match(out.text, /Mac Balls \(50\)/);
    assert.match(out.text, /Caprese \(20\)/);
    assert.match(out.text, /2026-03-01 Jones:/);
    const recent = out.sources.find((s) => s.type === 'beo_prep_history_recent');
    assert.ok(recent);
    assert.match(recent.detail, /2 event\(s\)/);
  });

  it('returns recent events sorted DESC by event_date', () => {
    insertPrep({ client: 'A', event_date: '2025-12-01', item: 'X' });
    insertPrep({ client: 'B', event_date: '2026-01-01', item: 'Y' });
    insertPrep({ client: 'C', event_date: '2026-02-01', item: 'Z' });
    const out = ctx.renderBeoPrepHistory(testDb, LOC, 'catering prep history');
    const idxC = out.text.indexOf('2026-02-01');
    const idxB = out.text.indexOf('2026-01-01');
    const idxA = out.text.indexOf('2025-12-01');
    assert.ok(idxC >= 0 && idxB >= 0 && idxA >= 0);
    assert.ok(idxC < idxB && idxB < idxA, 'expected DESC by event_date');
  });

  it('skips Secondary Prep / Special Sauce rows in the recent-events block', () => {
    insertPrep({ client: 'X', event_date: '2026-04-01', item: 'Mac Balls', type: 'Main Item' });
    insertPrep({ client: 'X', event_date: '2026-04-01', item: 'Queso',     type: 'Secondary Prep' });
    insertPrep({ client: 'X', event_date: '2026-04-01', item: 'Nash Oil',  type: 'Special Sauce' });
    const out = ctx.renderBeoPrepHistory(testDb, LOC, 'wedding event');
    assert.match(out.text, /Mac Balls/);
    assert.doesNotMatch(out.text, /Queso/);
    assert.doesNotMatch(out.text, /Nash Oil/);
  });

  it('emits item-history block when the question mentions a known item', () => {
    insertPrep({
      client: 'Anne',
      event_date: '2025-09-27',
      item: 'Mac Balls',
      amount_qty: '50',
      prep_day: 'Saturday',
      pre_prep_notes: 'ditalini cooked fri',
      plating_notes: '4 inch plate',
    });
    const out = ctx.renderBeoPrepHistory(testDb, LOC, 'how do I prep mac balls for 80?');
    assert.match(out.text, /MATCHED ITEM PREP HISTORY/);
    assert.match(out.text, /2025-09-27 \| Anne \| Mac Balls × 50/);
    assert.match(out.text, /prep:Saturday/);
    assert.match(out.text, /pre:ditalini cooked fri/);
    assert.match(out.text, /plating:4 inch plate/);
    const item = out.sources.find((s) => s.type === 'beo_prep_history_item');
    assert.ok(item);
    assert.match(item.detail, /1 hit\(s\) for 1 item\(s\)/);
  });

  it('item-history match is case-insensitive', () => {
    insertPrep({ item: 'BEEF Tenderloin Crostini' });
    const out = ctx.renderBeoPrepHistory(testDb, LOC, 'plan beef tenderloin crostini for 30');
    assert.match(out.text, /MATCHED ITEM PREP HISTORY/);
  });

  it('does not double-emit MATCHED block when the same item recurs', () => {
    insertPrep({ event_date: '2026-04-01', item: 'Mac Balls', amount_qty: '50' });
    insertPrep({ event_date: '2026-03-01', item: 'Mac Balls', amount_qty: '40' });
    const out = ctx.renderBeoPrepHistory(testDb, LOC, 'mac balls');
    const matchedHeaderCount = (out.text.match(/MATCHED ITEM PREP HISTORY/g) || []).length;
    assert.equal(matchedHeaderCount, 1);
    const item = out.sources.find((s) => s.type === 'beo_prep_history_item');
    assert.match(item.detail, /2 hit\(s\) for 1 item\(s\)/);
  });

  it('respects location_id isolation', () => {
    insertPrep({ item: 'Mac Balls', loc: 'other-location' });
    const out = ctx.renderBeoPrepHistory(testDb, LOC, 'mac balls plan prep');
    // Item-name match still false because the item lives only under "other-location".
    assert.equal(out.text, '');
    assert.deepEqual(out.sources, []);
  });

  it('emits both blocks when the question matches both branches', () => {
    insertPrep({ client: 'Anne', event_date: '2025-09-27', item: 'Mac Balls' });
    const out = ctx.renderBeoPrepHistory(testDb, LOC, 'plan prep for the mac balls event');
    assert.match(out.text, /RECENT BEO EVENTS/);
    assert.match(out.text, /MATCHED ITEM PREP HISTORY/);
    assert.equal(out.sources.length, 2);
  });

  it('skips short queries (<4 chars) for item-match branch only', () => {
    insertPrep({ item: 'Mac' });
    // 'mac' is 3 chars — item branch should be skipped, no catering kw either
    const out = ctx.renderBeoPrepHistory(testDb, LOC, 'mac');
    assert.equal(out.text, '');
  });
});
