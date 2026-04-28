#!/usr/bin/env node
// Tests for the Bundle-H schema foundation: service_hours + preshift_notes
// tables plus the three helpers exported from lib/db.ts
// (getServiceHours, todayServiceLabel, getPreshiftNote).
//
// Run: node --experimental-strip-types --test tests/js/test-service-hours-and-preshift.mjs
//
// Uses setDbPathForTest(':memory:') so the module-singleton DB is the
// in-memory one we seed here; no files, no network.

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  getDb,
  setDbPathForTest,
  initSchema,
  getServiceHours,
  todayServiceLabel,
  getPreshiftNote,
} from '../../lib/db.ts';

setDbPathForTest(':memory:');
const db = getDb();

after(() => {
  setDbPathForTest(null);
});

beforeEach(() => {
  db.exec('DELETE FROM service_hours; DELETE FROM preshift_notes;');
});

const columnsOf = (table) =>
  db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);

// ── Schema sanity ────────────────────────────────────────────────

describe('schema — idempotency', () => {
  it('calling initSchema twice on the same DB does not throw', () => {
    assert.doesNotThrow(() => initSchema(db));
    assert.doesNotThrow(() => initSchema(db));
  });

  it('service_hours has the expected columns', () => {
    const cols = columnsOf('service_hours');
    for (const c of [
      'id', 'location_id', 'day_of_week', 'opens_at', 'closes_at',
      'service_label', 'notes', 'active', 'created_at',
    ]) {
      assert.ok(cols.includes(c), `service_hours.${c} missing`);
    }
  });

  it('preshift_notes has the expected columns', () => {
    const cols = columnsOf('preshift_notes');
    for (const c of [
      'id', 'location_id', 'shift_date', 'service_label', 'body',
      'author_cook_id', 'created_at', 'updated_at',
    ]) {
      assert.ok(cols.includes(c), `preshift_notes.${c} missing`);
    }
  });
});

// ── UNIQUE constraints ───────────────────────────────────────────

describe('service_hours — UNIQUE(location_id, day_of_week, service_label)', () => {
  it('rejects a duplicate (location, dow, label) triple', () => {
    const ins = db.prepare(
      `INSERT INTO service_hours (location_id, day_of_week, opens_at, closes_at, service_label)
       VALUES (?, ?, ?, ?, ?)`,
    );
    ins.run('default', 3, '11:00', '14:00', 'Lunch');
    assert.throws(
      () => ins.run('default', 3, '11:00', '14:00', 'Lunch'),
      /UNIQUE/,
    );
  });

  it('allows same (location, dow) with a different service_label', () => {
    const ins = db.prepare(
      `INSERT INTO service_hours (location_id, day_of_week, opens_at, closes_at, service_label)
       VALUES (?, ?, ?, ?, ?)`,
    );
    ins.run('default', 3, '11:00', '14:00', 'Lunch');
    assert.doesNotThrow(() => ins.run('default', 3, '17:00', '21:00', 'Dinner'));
  });
});

describe('preshift_notes — UNIQUE(location_id, shift_date, service_label)', () => {
  it('rejects a duplicate (location, date, label) triple', () => {
    const ins = db.prepare(
      `INSERT INTO preshift_notes (location_id, shift_date, service_label, body)
       VALUES (?, ?, ?, ?)`,
    );
    ins.run('default', '2026-04-21', 'Dinner', 'low on halibut');
    assert.throws(
      () => ins.run('default', '2026-04-21', 'Dinner', 'different body'),
      /UNIQUE/,
    );
  });
});

// ── getServiceHours ──────────────────────────────────────────────

describe('getServiceHours', () => {
  it('returns [] when nothing is scheduled', () => {
    assert.deepStrictEqual(getServiceHours(), []);
  });

  it('returns only active rows, ordered by (day_of_week, service_label)', () => {
    const ins = db.prepare(
      `INSERT INTO service_hours
         (location_id, day_of_week, opens_at, closes_at, service_label, active)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    // Seed out of order on purpose.
    ins.run('default', 5, '17:00', '22:00', 'Dinner', 1);
    ins.run('default', 3, '17:00', '21:00', 'Dinner', 1);
    ins.run('default', 3, '11:00', '14:00', 'Lunch', 1);
    ins.run('default', 4, '17:00', '21:00', 'Dinner', 0); // inactive — excluded

    const rows = getServiceHours();
    assert.strictEqual(rows.length, 3);
    // Expect dow 3 Dinner, 3 Lunch, 5 Dinner — Dinner sorts before Lunch
    // alphabetically, so dow 3 order is (Dinner, Lunch).
    assert.strictEqual(rows[0].day_of_week, 3);
    assert.strictEqual(rows[0].service_label, 'Dinner');
    assert.strictEqual(rows[1].day_of_week, 3);
    assert.strictEqual(rows[1].service_label, 'Lunch');
    assert.strictEqual(rows[2].day_of_week, 5);
    assert.strictEqual(rows[2].service_label, 'Dinner');
  });

  it('respects location scoping', () => {
    const ins = db.prepare(
      `INSERT INTO service_hours
         (location_id, day_of_week, opens_at, closes_at, service_label)
       VALUES (?, ?, ?, ?, ?)`,
    );
    ins.run('downtown', 3, '17:00', '21:00', 'Dinner');
    ins.run('airport',  3, '11:00', '14:00', 'Lunch');

    const dt = getServiceHours('downtown');
    assert.strictEqual(dt.length, 1);
    assert.strictEqual(dt[0].service_label, 'Dinner');

    const ap = getServiceHours('airport');
    assert.strictEqual(ap.length, 1);
    assert.strictEqual(ap[0].service_label, 'Lunch');
  });
});

// ── todayServiceLabel ────────────────────────────────────────────

describe('todayServiceLabel', () => {
  it('returns null when no row for today', () => {
    assert.strictEqual(todayServiceLabel(), null);
  });

  it('returns the first-opening service label for today', () => {
    const dow = new Date().getDay();
    const ins = db.prepare(
      `INSERT INTO service_hours
         (location_id, day_of_week, opens_at, closes_at, service_label)
       VALUES (?, ?, ?, ?, ?)`,
    );
    // Two services today; the one opening first should win.
    ins.run('default', dow, '17:00', '21:00', 'Dinner');
    ins.run('default', dow, '11:00', '14:00', 'Lunch');
    assert.strictEqual(todayServiceLabel(), 'Lunch');
  });

  it('returns null when today is inactive even if a row exists', () => {
    const dow = new Date().getDay();
    db.prepare(
      `INSERT INTO service_hours
         (location_id, day_of_week, opens_at, closes_at, service_label, active)
       VALUES (?, ?, ?, ?, ?, 0)`,
    ).run('default', dow, '17:00', '21:00', 'Dinner');
    assert.strictEqual(todayServiceLabel(), null);
  });
});

// ── getPreshiftNote ──────────────────────────────────────────────

describe('getPreshiftNote', () => {
  const insNote = () => db.prepare(
    `INSERT INTO preshift_notes
       (location_id, shift_date, service_label, body, author_cook_id)
     VALUES (?, ?, ?, ?, ?)`,
  );

  it('returns null for a missing tuple', () => {
    assert.strictEqual(
      getPreshiftNote('default', '2026-04-21', 'Dinner'),
      null,
    );
  });

  it('retrieves a note by exact (location, date, label) tuple', () => {
    insNote().run('default', '2026-04-21', 'Dinner', 'low on halibut', 'alice');
    const row = getPreshiftNote('default', '2026-04-21', 'Dinner');
    assert.ok(row, 'expected a row');
    assert.strictEqual(row.body, 'low on halibut');
    assert.strictEqual(row.author_cook_id, 'alice');
    assert.strictEqual(row.service_label, 'Dinner');
  });

  it('handles NULL service_label — prep-day retrieval', () => {
    // Prep-day note (kitchen closed): service_label = NULL.
    insNote().run('default', '2026-04-21', null, 'inventory day', 'bob');
    const row = getPreshiftNote('default', '2026-04-21', null);
    assert.ok(row, 'expected a prep-day row');
    assert.strictEqual(row.service_label, null);
    assert.strictEqual(row.body, 'inventory day');
  });

  it('does not cross-match: NULL-label query does not return a Dinner row', () => {
    insNote().run('default', '2026-04-21', 'Dinner', 'dinner note', null);
    assert.strictEqual(getPreshiftNote('default', '2026-04-21', null), null);
  });

  it('does not cross-match: Dinner query does not return a NULL-label row', () => {
    insNote().run('default', '2026-04-21', null, 'prep-day note', null);
    assert.strictEqual(getPreshiftNote('default', '2026-04-21', 'Dinner'), null);
  });

  it('respects location scoping', () => {
    insNote().run('location_a', '2026-04-21', 'Dinner', 'A note', null);
    assert.ok(getPreshiftNote('location_a', '2026-04-21', 'Dinner'));
    assert.strictEqual(
      getPreshiftNote('location_b', '2026-04-21', 'Dinner'),
      null,
    );
  });
});
