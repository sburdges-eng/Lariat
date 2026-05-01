#!/usr/bin/env node
// Tests for lib/settlementRepo.ts — Phase 2 settlement math.
//
// Run: node --experimental-strip-types --test tests/js/test-settlement-repo.mjs

import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const { getDb, setDbPathForTest } = await import('../../lib/db.ts');
const repo = await import('../../lib/settlementRepo.ts');

setDbPathForTest(':memory:');
const db = getDb();
after(() => setDbPathForTest(null));

before(() => {
  db.prepare(
    `INSERT INTO ingest_runs (id, kind, started_at, status) VALUES (1, 'test', datetime('now'), 'ok')`,
  ).run();
  db.prepare(
    `INSERT INTO shows (id, location_id, band_name, show_date, source_row, ingested_at, ingest_run_id)
     VALUES (1, 'default', 'Test Band', '2026-05-01', 1, datetime('now'), 1)`,
  ).run();
});

beforeEach(() => {
  db.exec(`DELETE FROM show_deals; DELETE FROM audit_events;`);
});

const sampleDeal = {
  guaranteeCents: 100000,
  vsPctAfterCosts: 0.85,
  costsOffTop: [{ label: 'Sound', cents: 5000 }],
  buyoutCents: 0,
};

describe('upsertDeal', () => {
  it('inserts a new deal and writes one audit row', () => {
    repo.upsertDeal(1, sampleDeal, 'cook-jane', 'default');
    const dealRow = db.prepare(`SELECT * FROM show_deals WHERE show_id = 1`).get();
    assert.equal(dealRow.guarantee_cents, 100000);
    assert.equal(dealRow.vs_pct_after_costs, 0.85);
    assert.equal(dealRow.updated_by_cook_id, 'cook-jane');
    const audit = db
      .prepare(`SELECT * FROM audit_events WHERE entity = 'show_deal'`)
      .all();
    assert.equal(audit.length, 1);
    assert.equal(audit[0].action, 'insert');
    assert.equal(audit[0].actor_cook_id, 'cook-jane');
  });

  it('updates an existing deal and audits as correction', () => {
    repo.upsertDeal(1, sampleDeal, 'cook-jane', 'default');
    repo.upsertDeal(
      1,
      { ...sampleDeal, guaranteeCents: 150000 },
      'cook-bob',
      'default',
    );
    const dealRows = db.prepare(`SELECT * FROM show_deals WHERE show_id = 1`).all();
    assert.equal(dealRows.length, 1);
    assert.equal(dealRows[0].guarantee_cents, 150000);
    const audit = db
      .prepare(`SELECT * FROM audit_events WHERE entity = 'show_deal' ORDER BY id`)
      .all();
    assert.equal(audit.length, 2);
    assert.equal(audit[1].action, 'correction');
    assert.equal(audit[1].actor_cook_id, 'cook-bob');
  });

  it('rolls back the audit row if the deal upsert fails', () => {
    db.exec(`PRAGMA foreign_keys = ON;`);
    assert.throws(
      () => repo.upsertDeal(999, sampleDeal, 'cook-jane', 'default'),
      /FOREIGN KEY/,
    );
    const audit = db
      .prepare(`SELECT * FROM audit_events WHERE entity = 'show_deal'`)
      .all();
    assert.equal(audit.length, 0);
  });
});
