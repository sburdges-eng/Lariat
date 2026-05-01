#!/usr/bin/env node
// Tests for lib/boxOfficeRepo.ts — Phase 2 box-office lines repo.
//
// Cash custody is regulated → DB audit (lib/auditEvents.ts), not file
// audit. Tests assert against the audit_events table directly.
//
// Run: node --experimental-strip-types --test tests/js/test-box-office-repo.mjs

import { describe, it, after, beforeEach, before } from 'node:test';
import assert from 'node:assert/strict';

const { getDb, setDbPathForTest } = await import('../../lib/db.ts');
const box = await import('../../lib/boxOfficeRepo.ts');

setDbPathForTest(':memory:');
const db = getDb();
after(() => setDbPathForTest(null));

before(() => {
  db.prepare(
    `INSERT INTO ingest_runs (id, kind, started_at, status)
     VALUES (1, 'test', datetime('now'), 'ok')`,
  ).run();
  db.prepare(
    `INSERT INTO shows (id, location_id, band_name, show_date, source_row, ingested_at, ingest_run_id)
     VALUES (1, 'default', 'Test Band', '2026-05-01', 1, datetime('now'), 1)`,
  ).run();
  db.prepare(
    `INSERT INTO shows (id, location_id, band_name, show_date, source_row, ingested_at, ingest_run_id)
     VALUES (2, 'satellite', 'Test Band 2', '2026-05-02', 2, datetime('now'), 1)`,
  ).run();
});

beforeEach(() => {
  db.exec(`DELETE FROM box_office_lines; DELETE FROM audit_events;`);
});

function auditFor(entityId) {
  return db.prepare(
    `SELECT * FROM audit_events WHERE entity = 'box_office_lines' AND entity_id = ?
      ORDER BY id ASC`,
  ).all(entityId);
}

describe('createBoxOfficeLine — sources', () => {
  for (const source of ['dice', 'walkup', 'comp', 'will_call', 'guestlist']) {
    it(`accepts source='${source}'`, () => {
      const line = box.createBoxOfficeLine(db, {
        show_id: 1, location_id: 'default', source, qty: 1, face_price: 25,
      });
      assert.equal(line.source, source);
      assert.equal(line.qty, 1);
    });
  }

  it('rejects unknown source value at the validator', () => {
    assert.throws(
      () => box.createBoxOfficeLine(db, {
        show_id: 1, location_id: 'default', source: 'free', qty: 1,
      }),
      /invalid source/,
    );
  });

  it('rejects non-positive qty', () => {
    assert.throws(
      () => box.createBoxOfficeLine(db, {
        show_id: 1, location_id: 'default', source: 'walkup', qty: 0,
      }),
      /qty/,
    );
  });

  it('writes a DB audit row on insert (cash custody is regulated)', () => {
    const line = box.createBoxOfficeLine(db, {
      show_id: 1, location_id: 'default', source: 'walkup', qty: 2, face_price: 30,
      actor_cook_id: 'door_anna',
    });
    const events = auditFor(line.id);
    assert.equal(events.length, 1);
    assert.equal(events[0].action, 'insert');
    assert.equal(events[0].actor_cook_id, 'door_anna');
    assert.equal(events[0].actor_source, 'box_office');
    const payload = JSON.parse(events[0].payload_json);
    assert.equal(payload.qty, 2);
    assert.equal(payload.source, 'walkup');
  });
});

describe('createBoxOfficeLine — transactional audit', () => {
  // Cash custody is regulated → DB audit lives inside the same
  // db.transaction(...) as the source INSERT (per docs/PATTERNS.md §3).
  // If the audit row cannot be written, the source row MUST roll back.
  // Mirror of the settlement-repo rollback contract (PR #78).
  //
  // To force a deterministic audit failure we drop the `audit_events`
  // table for the duration of the assertion, then restore it. SQLite
  // will throw "no such table: audit_events" inside the tx, which must
  // propagate out of `createBoxOfficeLine` AND leave `box_office_lines`
  // empty. The settlement test uses an FK violation; we use a missing
  // table because box_office_lines has no FK on audit_events.
  it('rolls back the source row when the audit insert fails', () => {
    // Snapshot the audit_events DDL so we can recreate it after.
    const ddlRow = db.prepare(
      `SELECT sql FROM sqlite_master WHERE type='table' AND name='audit_events'`,
    ).get();
    assert.ok(ddlRow?.sql, 'audit_events DDL should be discoverable');

    db.exec(`DROP TABLE audit_events;`);
    try {
      assert.throws(
        () => box.createBoxOfficeLine(db, {
          show_id: 1, location_id: 'default', source: 'walkup',
          qty: 3, face_price: 25, actor_cook_id: 'door_anna',
        }),
        /audit_events/,
      );
      // No box_office_lines row should have been left behind.
      const lines = db.prepare(
        `SELECT COUNT(*) AS c FROM box_office_lines WHERE show_id = 1`,
      ).get();
      assert.equal(lines.c, 0, 'audit failure must roll back the source insert');
    } finally {
      db.exec(ddlRow.sql);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_events(entity, entity_id);`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_audit_shift ON audit_events(location_id, shift_date);`);
    }
  });

  it('rolls back markScanned when the audit insert fails', () => {
    const line = box.createBoxOfficeLine(db, {
      show_id: 1, location_id: 'default', source: 'dice', qty: 1,
      face_price: 30, external_ref: 'DICE-ROLLBACK-1',
    });

    const ddlRow = db.prepare(
      `SELECT sql FROM sqlite_master WHERE type='table' AND name='audit_events'`,
    ).get();
    db.exec(`DROP TABLE audit_events;`);
    try {
      assert.throws(
        () => box.markScanned(db, line.id, 'default', 'door_anna'),
        /audit_events/,
      );
      // scanned_at must still be NULL — the UPDATE rolled back with the audit failure.
      const fresh = db.prepare(
        `SELECT scanned_at FROM box_office_lines WHERE id = ?`,
      ).get(line.id);
      assert.equal(fresh.scanned_at, null, 'audit failure must roll back the scan UPDATE');
    } finally {
      db.exec(ddlRow.sql);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_events(entity, entity_id);`);
      db.exec(`CREATE INDEX IF NOT EXISTS idx_audit_shift ON audit_events(location_id, shift_date);`);
    }
  });

  it('schema CHECK on box_office_lines.source rejects bypass attempts', () => {
    // The repo's VALID_SOURCES set is a soft validator at the JS layer.
    // The CHECK constraint at the DB layer is the second line of defence
    // — assert it fires if a future code path skips the validator.
    assert.throws(
      () => db.prepare(
        `INSERT INTO box_office_lines (show_id, location_id, source, qty)
         VALUES (1, 'default', 'free', 1)`,
      ).run(),
      /CHECK constraint/,
    );
  });
});

describe('listLinesForShow', () => {
  it('returns lines newest-first', () => {
    box.createBoxOfficeLine(db, {
      show_id: 1, location_id: 'default', source: 'walkup', qty: 1, face_price: 25,
    });
    box.createBoxOfficeLine(db, {
      show_id: 1, location_id: 'default', source: 'comp', qty: 1, face_price: 0,
    });
    const list = box.listLinesForShow(db, 1, 'default');
    assert.equal(list.length, 2);
    assert.equal(list[0].source, 'comp');
    assert.equal(list[1].source, 'walkup');
  });

  it('respects location_id scoping', () => {
    box.createBoxOfficeLine(db, {
      show_id: 1, location_id: 'default', source: 'walkup', qty: 1, face_price: 25,
    });
    box.createBoxOfficeLine(db, {
      show_id: 2, location_id: 'satellite', source: 'walkup', qty: 1, face_price: 25,
    });
    assert.equal(box.listLinesForShow(db, 1, 'default').length, 1);
    assert.equal(box.listLinesForShow(db, 2, 'satellite').length, 1);
    assert.equal(box.listLinesForShow(db, 1, 'satellite').length, 0);
  });
});

describe('summarizeBoxOffice', () => {
  it('aggregates qty + revenue + fees by source', () => {
    box.createBoxOfficeLine(db, {
      show_id: 1, location_id: 'default', source: 'dice', qty: 50, face_price: 30, fees: 4,
    });
    box.createBoxOfficeLine(db, {
      show_id: 1, location_id: 'default', source: 'walkup', qty: 10, face_price: 35, fees: 0,
    });
    box.createBoxOfficeLine(db, {
      show_id: 1, location_id: 'default', source: 'comp', qty: 4, face_price: 0,
    });
    const s = box.summarizeBoxOffice(db, 1, 'default');
    assert.equal(s.total_qty, 64);
    assert.equal(s.total_revenue, 50 * 30 + 10 * 35);
    assert.equal(s.total_fees, 4);
    assert.equal(s.by_source.dice.qty, 50);
    assert.equal(s.by_source.walkup.qty, 10);
    assert.equal(s.by_source.comp.qty, 4);
    assert.equal(s.scanned_qty, 0);
    assert.equal(s.unscanned_qty, 64);
  });
});

describe('markScanned', () => {
  it('sets scanned_at + writes update audit on a fresh line', () => {
    const line = box.createBoxOfficeLine(db, {
      show_id: 1, location_id: 'default', source: 'dice', qty: 1, face_price: 30,
      external_ref: 'DICE-7777',
    });
    const scanned = box.markScanned(db, 1, line.id, 'default', 'door_anna');
    assert.ok(scanned);
    assert.ok(scanned.scanned_at);
    const events = auditFor(line.id);
    assert.equal(events.length, 2);
    assert.equal(events[1].action, 'update');
    const payload = JSON.parse(events[1].payload_json);
    assert.equal(payload.op, 'mark_scanned');
    assert.equal(payload.external_ref, 'DICE-7777');
  });

  it('returns null when line is already scanned (no second audit row)', () => {
    const line = box.createBoxOfficeLine(db, {
      show_id: 1, location_id: 'default', source: 'walkup', qty: 1, face_price: 25,
    });
    box.markScanned(db, 1, line.id, 'default', 'door_anna');
    const second = box.markScanned(db, 1, line.id, 'default', 'door_anna');
    assert.equal(second, null);
    const events = auditFor(line.id);
    assert.equal(events.length, 2); // insert + first scan only
  });

  it('returns null on location mismatch', () => {
    const line = box.createBoxOfficeLine(db, {
      show_id: 1, location_id: 'default', source: 'walkup', qty: 1, face_price: 25,
    });
    assert.equal(box.markScanned(db, 1, line.id, 'satellite', null), null);
    // Confirm scanned_at is still null on the original row.
    const fresh = db.prepare(`SELECT scanned_at FROM box_office_lines WHERE id = ?`).get(line.id);
    assert.equal(fresh.scanned_at, null);
  });

  it('returns null on show_id mismatch (cross-show authorization gap)', () => {
    const line = box.createBoxOfficeLine(db, {
      show_id: 1, location_id: 'default', source: 'walkup', qty: 1, face_price: 25,
    });
    assert.equal(box.markScanned(db, 2, line.id, 'default', null), null);
    const fresh = db.prepare(`SELECT scanned_at FROM box_office_lines WHERE id = ?`).get(line.id);
    assert.equal(fresh.scanned_at, null);
  });

  it('rejects non-positive line_id', () => {
    assert.throws(() => box.markScanned(db, 1, 0, 'default', null), /line_id/);
  });

  it('rejects non-positive show_id', () => {
    assert.throws(() => box.markScanned(db, 0, 1, 'default', null), /show_id/);
  });
});

describe('boxOfficeCompleteness', () => {
  it('scores 0 with no lines', () => {
    const s = box.summarizeBoxOffice(db, 1, 'default');
    assert.equal(box.boxOfficeCompleteness(s).score, 0);
  });

  it('scores 1.0 with any-lines + dice + walkup all present', () => {
    box.createBoxOfficeLine(db, {
      show_id: 1, location_id: 'default', source: 'dice', qty: 50, face_price: 30,
    });
    box.createBoxOfficeLine(db, {
      show_id: 1, location_id: 'default', source: 'walkup', qty: 5, face_price: 35,
    });
    const s = box.summarizeBoxOffice(db, 1, 'default');
    const c = box.boxOfficeCompleteness(s);
    assert.equal(c.score, 1);
    assert.equal(c.has_dice_lines, true);
    assert.equal(c.has_walkup_lines, true);
  });
});
