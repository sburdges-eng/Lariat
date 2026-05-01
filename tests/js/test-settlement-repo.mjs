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

describe('getSettlement', () => {
  beforeEach(() => {
    db.exec(`
      DELETE FROM show_deals;
      DELETE FROM box_office_lines;
      DELETE FROM toast_sales_daily;
      DELETE FROM audit_events;
    `);
  });

  it('returns emptyDeal + zeros when nothing has been entered', () => {
    const s = repo.getSettlement(1, 'default');
    assert.equal(s.show.id, 1);
    assert.equal(s.show.bandName, 'Test Band');
    assert.equal(s.deal.guaranteeCents, 0);
    assert.equal(s.ticketing.grossCents, 0);
    assert.equal(s.toast.totalCents, 0);
    assert.equal(s.toast.rowsFound, 0);
    assert.equal(s.netDoorCents, 0);
  });

  it('aggregates ticket revenue + fees by source', () => {
    db.prepare(
      `INSERT INTO box_office_lines (show_id, location_id, source, qty, face_price, fees)
       VALUES (1, 'default', 'dice', 10, 35.00, 4.50),
              (1, 'default', 'walkup', 5, 40.00, 0)`,
    ).run();
    const s = repo.getSettlement(1, 'default');
    // dice: 10 × 35.00 = 350.00 → 35000c, 10 × 4.50 = 4500c
    // walkup: 5 × 40.00 = 200.00 → 20000c, 0 fees
    assert.equal(s.ticketing.grossCents, 55000);
    assert.equal(s.ticketing.feesCents, 4500);
    assert.equal(s.ticketing.netCents, 50500);
    assert.equal(s.ticketing.bySource.dice.qty, 10);
    assert.equal(s.ticketing.bySource.dice.grossCents, 35000);
    assert.equal(s.ticketing.bySource.walkup.qty, 5);
  });

  it('aggregates Toast revenue for shift_date = show_date', () => {
    db.prepare(
      `INSERT INTO toast_sales_daily
         (shift_date, net_sales, orders, guests, comparison_group, source, location_id)
       VALUES ('2026-05-01', 1234.56, 80, 120, 0, 'test', 'default'),
              ('2026-04-30', 999.99, 50, 70, 0, 'test', 'default')`,
    ).run();
    const s = repo.getSettlement(1, 'default');
    assert.equal(s.toast.totalCents, 123456);
    assert.equal(s.toast.ordersCount, 80);
    assert.equal(s.toast.guestsCount, 120);
    assert.equal(s.toast.rowsFound, 1);
    assert.equal(s.toast.attributionDate, '2026-05-01');
  });

  it('applies talent payout from the deal', () => {
    db.prepare(
      `INSERT INTO box_office_lines (show_id, location_id, source, qty, face_price, fees)
       VALUES (1, 'default', 'dice', 100, 30.00, 3.00)`,
    ).run();
    repo.upsertDeal(
      1,
      {
        guaranteeCents: 100000,
        vsPctAfterCosts: 0.85,
        costsOffTop: [{ label: 'Sound', cents: 5000 }],
        buyoutCents: 0,
      },
      'cook-jane',
      'default',
    );
    const s = repo.getSettlement(1, 'default');
    // ticket gross = 300000c, fees = 30000c, net = 270000c
    // overage = 300000 - 5000 - 100000 = 195000
    // vsBonus = floor(195000 * 0.85) = 165750
    // talent = 100000 + 165750 + 0 = 265750
    // costs_off_top = 5000
    // net_door = 270000 - 5000 - 265750 = -750
    assert.equal(s.ticketing.grossCents, 300000);
    assert.equal(s.talent.totalCents, 265750);
    assert.equal(s.costsOffTopCents, 5000);
    assert.equal(s.netDoorCents, -750);
  });

  it('throws if the show does not exist', () => {
    assert.throws(() => repo.getSettlement(9999, 'default'), /show 9999 not found/);
  });
});
