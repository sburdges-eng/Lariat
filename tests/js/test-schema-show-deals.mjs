#!/usr/bin/env node
// Tests for the Phase 2 show_deals schema.
//
// Run: node --experimental-strip-types --test tests/js/test-schema-show-deals.mjs

import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';

const { getDb, setDbPathForTest, initSchema } = await import('../../lib/db.ts');

setDbPathForTest(':memory:');
const db = getDb();
after(() => setDbPathForTest(null));

describe('show_deals schema', () => {
  it('has the expected columns', () => {
    const cols = db.prepare(`PRAGMA table_info(show_deals)`).all();
    const names = cols.map((c) => c.name);
    assert.deepEqual(
      names.sort(),
      [
        'buyout_cents',
        'costs_off_top_json',
        'guarantee_cents',
        'id',
        'location_id',
        'notes',
        'show_id',
        'updated_at',
        'updated_by_cook_id',
        'vs_pct_after_costs',
      ],
    );
  });

  it('enforces UNIQUE(show_id, location_id)', () => {
    db.prepare(
      `INSERT INTO ingest_runs (id, kind, started_at, status) VALUES (101, 'test', datetime('now'), 'ok')`,
    ).run();
    db.prepare(
      `INSERT INTO shows (id, location_id, band_name, show_date, source_row, ingested_at, ingest_run_id)
       VALUES (101, 'default', 'X', '2026-05-01', 1, datetime('now'), 101)`,
    ).run();
    db.prepare(
      `INSERT INTO show_deals (show_id, location_id, guarantee_cents) VALUES (101, 'default', 100000)`,
    ).run();
    assert.throws(
      () =>
        db
          .prepare(
            `INSERT INTO show_deals (show_id, location_id, guarantee_cents) VALUES (101, 'default', 200000)`,
          )
          .run(),
      /UNIQUE/,
    );
  });

  it('initSchema is idempotent — calling twice does not throw', () => {
    initSchema(db);
    initSchema(db);
  });
});
