#!/usr/bin/env node
// Unit tests for the local LaRi semantic-search corpus helper.
//
// Run:
//   node --experimental-strip-types --test tests/js/test-kitchen-semantic-search.mjs

import { describe, it, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

register(new URL('./resolver.mjs', import.meta.url));

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lariat-semantic-search-'));
const TMP_DB = path.join(TMP_DIR, 'lariat-test.db');
const CACHE_DIR = path.join(TMP_DIR, 'cache');
const LOC = 'default';
const OTHER_LOC = 'other-location';

const db = await import('../../lib/db.ts');
const data = await import('../../lib/data.ts');
const semantic = await import('../../lib/kitchenSemanticSearch.ts');

db.setDbPathForTest(TMP_DB);
data.setCacheRootForTest(CACHE_DIR);
const testDb = db.getDb();

function writeRecipes() {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(CACHE_DIR, 'recipes.json'),
    JSON.stringify([
      {
        slug: 'almond-wedding-cake',
        name: 'Almond Celebration Cake',
        station: 'Pastry',
        yield_qty: 1,
        yield_unit: 'tiered cake',
        ingredients: [
          { item: 'almond sponge', qty: 3, unit: 'layers' },
          { item: 'sour cherry filling', qty: 2, unit: 'qt' },
          { item: 'vanilla buttercream', qty: 3, unit: 'qt' },
        ],
        procedure: 'Split sponge, pipe buttercream dam, fill with sour cherries, stack cold.',
        allergens: ['egg', 'milk', 'tree nut', 'wheat'],
        menu_items: ['wedding cake'],
      },
      {
        slug: 'citrus-salmon',
        name: 'Citrus Salmon',
        station: 'Grill',
        ingredients: [
          { item: 'salmon fillet', qty: 6, unit: 'oz' },
          { item: 'lemon', qty: 1, unit: 'each' },
        ],
        procedure: 'Grill and glaze.',
        allergens: ['fish'],
        menu_items: ['salmon entree'],
      },
    ]),
  );
}

function seedRows() {
  const event = testDb.prepare(
    `INSERT INTO beo_events (title, event_date, contact_name, guest_count, notes, location_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const line = testDb.prepare(
    `INSERT INTO beo_line_items
       (event_id, sort_order, item_name, category, quantity, unit_cost, prep_notes, group_note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const audit = testDb.prepare(
    `INSERT INTO audit_events
       (shift_date, location_id, actor_source, entity, entity_id, action, payload_json, note)
     VALUES (?, ?, 'test', ?, ?, ?, ?, ?)`,
  );

  const wedding = Number(event.run(
    'Parker Wedding',
    '2026-06-20',
    'Avery Parker',
    140,
    'Dessert course uses sour cherry filling and almond cake.',
    LOC,
  ).lastInsertRowid);
  line.run(
    wedding,
    1,
    'Tiered almond cake with cherry filling',
    'Dessert',
    140,
    4.5,
    'Keep filling cold until final assembly.',
    'Wedding dessert',
  );

  const other = Number(event.run(
    'Other Venue Wedding',
    '2026-06-21',
    'Cross Location',
    80,
    'This cherry cake belongs to another location.',
    OTHER_LOC,
  ).lastInsertRowid);
  line.run(
    other,
    1,
    'Cross-location cherry wedding cake',
    'Dessert',
    80,
    4.5,
    'Should never leak into default location search.',
    'Other venue',
  );

  audit.run(
    '2026-06-05',
    LOC,
    'line_check_entries',
    77,
    'insert',
    JSON.stringify({ item: 'sour cherry filling', station: 'Pastry', status: 'pass' }),
    'Pastry checked cherry filling temperature before wedding cake assembly.',
  );
  audit.run(
    '2026-06-05',
    LOC,
    'performance_reviews',
    7,
    'insert',
    JSON.stringify({ cook_name: 'Sam', feedback: 'private cherry cake coaching note' }),
    'Manager-only review should not appear in cook-tier semantic search.',
  );
}

function seedLineItemForSearch({ itemName, prepNotes, groupNote = null }) {
  const eventId = Number(testDb.prepare(
    `INSERT INTO beo_events (title, event_date, contact_name, guest_count, notes, location_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    'Lopez Gluten-Free Rehearsal',
    '2026-06-22',
    'Mia Lopez',
    48,
    'Separate gluten-free dessert plating on request.',
    LOC,
  ).lastInsertRowid);

  testDb.prepare(
    `INSERT INTO beo_line_items
       (event_id, sort_order, item_name, category, quantity, unit_cost, prep_notes, group_note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(eventId, 2, itemName, 'Dessert', 48, 3.25, prepNotes, groupNote);

  return eventId;
}

before(() => {
  writeRecipes();
});

beforeEach(() => {
  testDb.exec(
    `DELETE FROM beo_line_items;
     DELETE FROM beo_events;
     DELETE FROM audit_events;`,
  );
  seedRows();
});

after(() => {
  data.setCacheRootForTest(null);
  db.setDbPathForTest(null);
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
});

describe('runSemanticKitchenSearch', () => {
  it('finds recipes, BEO line items, and safe audit payloads without exact-string matching', async () => {
    const result = await semantic.runSemanticKitchenSearch({
      db: testDb,
      locationId: LOC,
      query: 'that wedding cake recipe with the cherry filling',
      limit: 8,
      deps: {
        dataPackAvailable: () => false,
      },
    });

    assert.equal(result.ok, true);
    assert.equal(result.query, 'that wedding cake recipe with the cherry filling');

    const types = new Set(result.hits.map((hit) => hit.type));
    assert.ok(types.has('recipe'), 'expected local recipe hit');
    assert.ok(types.has('beo_line_item'), 'expected location-scoped BEO line-item hit');
    assert.ok(types.has('audit_event'), 'expected safe kitchen audit hit');

    const rendered = semantic.formatSemanticKitchenSearchForPrompt(result);
    assert.match(rendered, /Almond Celebration Cake/);
    assert.match(rendered, /Parker Wedding/);
    assert.match(rendered, /sour cherry filling/);
    assert.doesNotMatch(rendered, /Cross-location/);
    assert.doesNotMatch(rendered, /performance review/i);
    assert.doesNotMatch(rendered, /Manager-only review/);
  });

  it('returns a quiet no-hit result for empty queries', async () => {
    const result = await semantic.runSemanticKitchenSearch({
      db: testDb,
      locationId: LOC,
      query: '   ',
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.hits, []);
    assert.match(semantic.formatSemanticKitchenSearchForPrompt(result), /No semantic search matches/);
  });

  it('matches short kitchen shorthand that normalizes but has no searchable tokens', async () => {
    seedLineItemForSearch({
      itemName: 'Berry cobbler',
      prepNotes: 'GF cobbler needs a separate tray for the celiac guest.',
      groupNote: 'Celiac dessert',
    });

    const result = await semantic.runSemanticKitchenSearch({
      db: testDb,
      locationId: LOC,
      query: 'GF',
      limit: 4,
      deps: {
        dataPackAvailable: () => false,
      },
    });

    const hit = result.hits.find((row) => row.type === 'beo_line_item' && row.title === 'Berry cobbler');
    assert.ok(hit, 'expected GF shorthand to match the BEO line item');
    assert.match(semantic.formatSemanticKitchenSearchForPrompt(result), /gf cobbler/i);
  });

  it('anchors excerpts around the normalized match when punctuation changes indexes', async () => {
    seedLineItemForSearch({
      itemName: 'Dessert service note',
      prepNotes: `${'!'.repeat(260)} separate tray for gluten-free cake near expo.`,
      groupNote: 'Celiac dessert',
    });

    const result = await semantic.runSemanticKitchenSearch({
      db: testDb,
      locationId: LOC,
      query: 'separate tray',
      limit: 4,
      deps: {
        dataPackAvailable: () => false,
      },
    });

    const hit = result.hits.find((row) => row.type === 'beo_line_item' && row.title === 'Dessert service note');
    assert.ok(hit, 'expected punctuation-heavy prep note to match');
    assert.match(hit.excerpt, /separate tray/i);
  });
});
