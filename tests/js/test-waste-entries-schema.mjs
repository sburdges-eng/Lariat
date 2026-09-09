#!/usr/bin/env node
// Tests for the `waste_entries` table — SOP 12 · Waste Logging.
// Run: npx -y node@24 --experimental-strip-types --test tests/js/test-waste-entries-schema.mjs
//
// The table replaces the interim practice of writing waste into
// `inventory_updates` with `direction='waste'` (see
// docs/waste-entries-schema.md). What that table could not carry, and what
// these tests pin down:
//
//   - a reason from a CLOSED set, so waste can be grouped by cause
//   - a unit, so portions / pounds / pans are never silently added together
//   - a cost SNAPSHOT taken at log time, never recomputed against today's price
//   - three soft identity refs (ingredient / recipe / menu item), deliberately
//     NOT foreign keys — only 19 recipes are costed, and a hard FK would reject
//     the majority of real entries on day one
//   - `entered_during`, the instrument that tests SOP 12's own timing rule
//
// Assertions read PRAGMA / sqlite_master directly against an in-memory DB via
// setDbPathForTest(':memory:') — no mocks, no file side effects.

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';

import { getDb, setDbPathForTest, initSchema } from '../../lib/db.ts';

setDbPathForTest(':memory:');
const db = getDb();

after(() => {
  setDbPathForTest(null);
});

const infoOf = (table) =>
  /** @type {{name: string, type: string, notnull: number, dflt_value: unknown}[]} */ (
    db.prepare(`PRAGMA table_info(${table})`).all()
  );
const columnsOf = (table) => infoOf(table).map((c) => c.name);

/** Insert a waste row, filling the required columns with a realistic default. */
const logWaste = (over = {}) => {
  const row = {
    shift_date: '2026-09-08',
    station_id: 'saute',
    item: 'Pork Green Chile',
    master_id: null,
    recipe_id: null,
    menu_item_uuid: null,
    quantity: 2,
    unit: 'qt',
    reason: 'SPOIL',
    note: null,
    event_name: null,
    unit_cost: null,
    extended_cost: null,
    cost_source: null,
    entered_during: 'close',
    cook_id: 'grelecki',
    ...over,
  };
  return db
    .prepare(
      `INSERT INTO waste_entries
         (shift_date, station_id, item, master_id, recipe_id, menu_item_uuid,
          quantity, unit, reason, note, event_name,
          unit_cost, extended_cost, cost_source, entered_during, cook_id)
       VALUES
         (@shift_date, @station_id, @item, @master_id, @recipe_id, @menu_item_uuid,
          @quantity, @unit, @reason, @note, @event_name,
          @unit_cost, @extended_cost, @cost_source, @entered_during, @cook_id)`,
    )
    .run(row);
};

describe('waste_entries — table shape', () => {
  it('exists', () => {
    const t = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='waste_entries'")
      .get();
    assert.ok(t, 'waste_entries table missing');
  });

  it('carries every column SOP 12 needs', () => {
    const cols = columnsOf('waste_entries');
    for (const c of [
      'id', 'shift_date', 'logged_at', 'station_id',
      'item', 'master_id', 'recipe_id', 'menu_item_uuid',
      'quantity', 'unit', 'reason', 'note', 'event_name',
      'unit_cost', 'extended_cost', 'cost_source',
      'entered_during', 'cook_id',
      'sync_source_host', 'sync_source_started_at', 'sync_source_pk',
      'created_at', 'location_id',
    ]) {
      assert.ok(cols.includes(c), `waste_entries.${c} missing`);
    }
  });

  it('stores quantity as REAL — pounds and pans are not integers', () => {
    const q = infoOf('waste_entries').find((c) => c.name === 'quantity');
    assert.strictEqual(q.type.toUpperCase(), 'REAL');
    assert.strictEqual(q.notnull, 1, 'quantity must be NOT NULL');
  });

  it('keeps the identity refs soft — no foreign keys', () => {
    // A hard REFERENCES would reject waste for anything not costed yet, and
    // only 19 recipes are costed. The join happens at read time instead.
    const fks = db.prepare('PRAGMA foreign_key_list(waste_entries)').all();
    assert.strictEqual(fks.length, 0, `expected no FKs, found ${JSON.stringify(fks)}`);
  });
});

describe('waste_entries — the closed sets', () => {
  it('accepts every reason in SOP 12', () => {
    for (const reason of ['SPOIL', 'OVERPREP', 'ERROR', 'EVENT']) {
      assert.doesNotThrow(() => logWaste({ reason, item: `Elote (${reason})` }));
    }
  });

  it('rejects a reason outside the set', () => {
    assert.throws(() => logWaste({ reason: 'DROPPED' }), /CHECK constraint failed/);
  });

  it('accepts every unit the line actually uses', () => {
    for (const unit of ['portion', 'lb', 'oz', 'each', 'pan', 'qt']) {
      assert.doesNotThrow(() => logWaste({ unit, item: `Carnitas (${unit})` }));
    }
  });

  it('rejects a unit outside the set — unaddable numbers are the whole problem', () => {
    assert.throws(() => logWaste({ unit: 'cambro' }), /CHECK constraint failed/);
  });

  it('rejects a cost_source outside the set', () => {
    assert.throws(() => logWaste({ cost_source: 'guess' }), /CHECK constraint failed/);
  });

  it('rejects an entered_during outside the set', () => {
    assert.throws(() => logWaste({ entered_during: 'prep' }), /CHECK constraint failed/);
  });

  it('refuses a non-positive quantity', () => {
    assert.throws(() => logWaste({ quantity: 0 }), /CHECK constraint failed/);
    assert.throws(() => logWaste({ quantity: -3 }), /CHECK constraint failed/);
  });
});

describe('waste_entries — defaults', () => {
  it('stamps logged_at, created_at and the default location', () => {
    const { lastInsertRowid } = logWaste({ item: 'Tortilla Chips', unit: 'pan', quantity: 1 });
    const row = db.prepare('SELECT * FROM waste_entries WHERE id = ?').get(lastInsertRowid);
    assert.match(row.logged_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    assert.match(row.created_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    assert.strictEqual(row.location_id, 'default');
  });
});

describe('waste_entries — indexes', () => {
  it('has the read-path indexes', () => {
    const names = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='waste_entries'")
      .all()
      .map((r) => r.name);
    for (const idx of [
      'idx_waste_loc_date',
      'idx_waste_reason',
      'idx_waste_item',
      'idx_waste_recipe',
    ]) {
      assert.ok(names.includes(idx), `${idx} missing (have ${JSON.stringify(names)})`);
    }
  });
});

describe('waste_entries — the questions it was built to answer', () => {
  it('rolls up cost by reason for the last 7 days', () => {
    db.prepare('DELETE FROM waste_entries').run();
    // A pan of green chile that soured, and an over-prepped hotel pan of rice.
    logWaste({
      item: 'Pork Green Chile', quantity: 4, unit: 'qt', reason: 'SPOIL',
      unit_cost: 6.25, extended_cost: 25.0, cost_source: 'recipe_costs',
      shift_date: '2026-09-08',
    });
    logWaste({
      item: 'Cilantro Lime Rice', quantity: 1, unit: 'pan', reason: 'OVERPREP',
      unit_cost: 11.4, extended_cost: 11.4, cost_source: 'recipe_costs',
      shift_date: '2026-09-08',
    });
    logWaste({
      item: 'Elote', quantity: 12, unit: 'portion', reason: 'OVERPREP',
      unit_cost: 1.05, extended_cost: 12.6, cost_source: 'recipe_costs',
      shift_date: '2026-09-07',
    });

    const rows = db
      .prepare(
        `SELECT reason, ROUND(SUM(extended_cost), 2) AS cost, COUNT(*) AS entries
           FROM waste_entries
          WHERE location_id = ?
            AND shift_date >= ?
          GROUP BY reason
          ORDER BY cost DESC`,
      )
      .all('default', '2026-09-02');

    assert.deepStrictEqual(rows, [
      { reason: 'OVERPREP', cost: 24.0, entries: 2 },
      { reason: 'SPOIL', cost: 25.0, entries: 1 },
    ].sort((a, b) => b.cost - a.cost));
  });

  it('counts service-vs-close entries, which is how SOP 12 grades its own rule', () => {
    db.prepare('DELETE FROM waste_entries').run();
    logWaste({ shift_date: '2026-09-08', entered_during: 'service', item: 'Pig Wings' });
    logWaste({ shift_date: '2026-09-08', entered_during: 'close', item: 'Salad Greens' });
    logWaste({ shift_date: '2026-09-08', entered_during: 'close', item: 'Mac Pasta' });

    const row = db
      .prepare(
        `SELECT SUM(entered_during = 'service') AS at_discard,
                SUM(entered_during = 'close')   AS at_close
           FROM waste_entries
          WHERE shift_date = ?`,
      )
      .get('2026-09-08');

    assert.strictEqual(row.at_discard, 1);
    assert.strictEqual(row.at_close, 2);
  });

  it('keeps the cost snapshot as written — a later price move must not change it', () => {
    db.prepare('DELETE FROM waste_entries').run();
    const { lastInsertRowid } = logWaste({
      item: 'Pangasius', quantity: 3, unit: 'lb', reason: 'ERROR',
      unit_cost: 4.19, extended_cost: 12.57, cost_source: 'vendor_prices',
    });
    const row = db.prepare('SELECT unit_cost, extended_cost, cost_source FROM waste_entries WHERE id = ?')
      .get(lastInsertRowid);
    assert.strictEqual(row.unit_cost, 4.19);
    assert.strictEqual(row.extended_cost, 12.57);
    assert.strictEqual(row.cost_source, 'vendor_prices');
  });
});

describe('waste_entries — init stays idempotent', () => {
  it('survives a second initSchema with its rows intact', () => {
    db.prepare('DELETE FROM waste_entries').run();
    logWaste({ item: 'Taco Setup', reason: 'EVENT', event_name: 'Grelecki Wedding' });
    assert.doesNotThrow(() => initSchema(db));
    const { c } = db.prepare('SELECT COUNT(*) AS c FROM waste_entries').get();
    assert.strictEqual(c, 1);
  });
});
