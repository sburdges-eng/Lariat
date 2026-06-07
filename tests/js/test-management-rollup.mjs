#!/usr/bin/env node
// Tests for the /management rollup page's data-layer behavior.
//
// We don't render the JSX (Next server components + next/link won't load
// cleanly under bare `node --test`), so we exercise the same read shape
// the page does and assert the contracts the page relies on:
//
//   1. Empty-state — with no accounting_variance rows on file,
//      readLatestAccountingVariance(db, loc) returns null. The page
//      treats null as the "no compute run yet" empty state.
//
//   2. Location scoping — when we pass loc='other', the cleaning_log
//      and accounting_variance reads only return that location's rows.
//      This guards against the regression PR review #96 flagged: the
//      page was hardcoding loc=DEFAULT_LOCATION_ID, so a multi-site
//      install would silently cross-leak 'default' data into every
//      site's dashboard.
//
//   3. Pack-changes O(1) count — we replaced the full-bom_lines scan
//      with `SELECT COUNT(*) FROM pack_size_changes WHERE acknowledged
//      = 0`. Verify the count tracks ack/unack state and survives a
//      legacy DB without the table (returns null, page renders '—').
//
// Run: node --experimental-strip-types --test tests/js/test-management-rollup.mjs

import { register } from 'node:module';
register(new URL('./resolver.mjs', import.meta.url));

import { describe, it, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const { getDb, setDbPathForTest } = await import('../../lib/db.ts');
const { readLatestAccountingVariance } = await import('../../lib/computeEngine/index.ts');
const { listDepletionExceptions } = await import('../../lib/depletionExceptions.ts');
const { listPriceShocks } = await import('../../lib/vendorPricesRepo.ts');

setDbPathForTest(':memory:');
const db = getDb();
after(() => setDbPathForTest(null));

const managementPageSource = () =>
  readFileSync(new URL('../../app/management/page.jsx', import.meta.url), 'utf8');

beforeEach(() => {
  db.exec(`
    DELETE FROM accounting_variance;
    DELETE FROM bom_lines;
    DELETE FROM cleaning_log;
    DELETE FROM dish_components;
    DELETE FROM pack_size_changes;
    DELETE FROM receiving_log;
    DELETE FROM sales_lines;
    DELETE FROM staff_certifications;
    DELETE FROM vendor_prices;
    DELETE FROM vendor_prices_history;
  `);
});

// ── Page-style readers (mirror app/management/page.jsx) ─────────────────
// These match the page's inline reads exactly. If the page changes its
// SQL, this test will fall out of sync — that's the intent. The test
// is the contract.

function readCleaningTodayLikePage(db, locationId) {
  const today = new Date().toISOString().slice(0, 10);
  const row = db
    .prepare(
      `SELECT COUNT(*) AS c FROM cleaning_log WHERE location_id = ? AND shift_date = ?`,
    )
    .get(locationId, today);
  return row?.c ?? 0;
}

function readPackSizeChangesUnackedLikePage(db) {
  try {
    const row = db
      .prepare('SELECT COUNT(*) AS c FROM pack_size_changes WHERE acknowledged = 0')
      .get();
    return row?.c ?? 0;
  } catch {
    return null;
  }
}

function readPriceShocksCountLikePage(db, locationId) {
  return listPriceShocks(db, {
    location_id: locationId,
    windowDays: 7,
    minPctMove: 5,
    limit: 100,
  }).length;
}

function readDepletionIssuesCountLikePage(db, locationId) {
  return listDepletionExceptions(db, {
    location_id: locationId,
    limit: 100,
  }).length;
}

function readCertWarningsLikePage(db, locationId) {
  const today = new Date().toISOString().slice(0, 10);
  const rows = db.prepare(
    `SELECT expires_on
       FROM staff_certifications
      WHERE location_id = ?
        AND active = 1
        AND expires_on IS NOT NULL`,
  ).all(locationId);

  const todayMs = new Date(today + 'T00:00:00Z').getTime();
  let expired = 0;
  let expiringSoon = 0;
  for (const r of rows) {
    const expMs = new Date(r.expires_on + 'T00:00:00Z').getTime();
    if (Number.isNaN(expMs)) continue;
    const days = Math.floor((expMs - todayMs) / 86400000);
    if (days < 0) expired++;
    else if (days <= 30) expiringSoon++;
  }
  return { expired, expiringSoon, total: expired + expiringSoon };
}

function readReceivingMatchesCountLikePage(db, locationId) {
  const row = db.prepare(
    `SELECT COUNT(*) AS c
       FROM receiving_log r
      WHERE r.location_id = ?
        AND r.status IN ('accepted', 'accepted_with_note')
        AND r.received_qty IS NOT NULL
        AND r.received_qty > 0
        AND r.received_unit IS NOT NULL
        AND TRIM(r.received_unit) <> ''
        AND r.match_status IN ('unmatched', 'ambiguous')`,
  ).get(locationId);
  return row?.c ?? 0;
}

function isoDaysFromToday(delta) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function isoDateTimeDaysAgo(daysAgo) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

function insertPriceSnapshot({
  locationId,
  vendor,
  sku,
  ingredient,
  unitPrice,
  daysAgo,
}) {
  db.prepare(
    `INSERT INTO vendor_prices_history
       (run_id, ingredient, vendor, sku, pack_size, pack_unit, pack_price,
        unit_price, location_id, snapshot_at, snapshot_reason)
     VALUES (1, ?, ?, ?, 1, 'lb', ?, ?, ?, ?, 'test')`,
  ).run(ingredient, vendor, sku, unitPrice, unitPrice, locationId, isoDateTimeDaysAgo(daysAgo));
}

describe('management rollup — empty state', () => {
  it('readLatestAccountingVariance returns null when no rows on file', () => {
    const v = readLatestAccountingVariance(db, 'default');
    assert.strictEqual(v, null);
  });

  it('cleaning_log count is 0 on a fresh DB', () => {
    assert.strictEqual(readCleaningTodayLikePage(db, 'default'), 0);
  });

  it('pack_size_changes count is 0 on a fresh DB', () => {
    assert.strictEqual(readPackSizeChangesUnackedLikePage(db), 0);
  });

  it('new management alert counts are 0 on a fresh DB', () => {
    assert.strictEqual(readPriceShocksCountLikePage(db, 'default'), 0);
    assert.strictEqual(readDepletionIssuesCountLikePage(db, 'default'), 0);
    assert.strictEqual(readReceivingMatchesCountLikePage(db, 'default'), 0);
    assert.deepStrictEqual(readCertWarningsLikePage(db, 'default'), {
      expired: 0,
      expiringSoon: 0,
      total: 0,
    });
  });
});

describe('management rollup — tile wiring', () => {
  it('renders links for the new management alert tiles', () => {
    const source = managementPageSource();
    assert.match(source, /label="Price shocks"/);
    assert.match(source, /\/costing\/price-shocks/);
    assert.match(source, /label="Depletion issues"/);
    assert.match(source, /\/costing\/depletion-exceptions/);
    assert.match(source, /label="Cert warnings"/);
    assert.match(source, /\/labor\/certs/);
    assert.match(source, /label="Receiving to match"/);
    assert.match(
      source,
      /href={locHref\('\/management\/receiving-matches', loc\)}/,
    );
  });
});

describe('management rollup — location scoping', () => {
  beforeEach(() => {
    const today = new Date().toISOString().slice(0, 10);
    // Two sites with cleaning entries today.
    db.prepare(
      `INSERT INTO cleaning_log (shift_date, location_id, area, task, completed_at)
       VALUES (?, 'default', 'line', 'wipe-down', datetime('now'))`,
    ).run(today);
    db.prepare(
      `INSERT INTO cleaning_log (shift_date, location_id, area, task, completed_at)
       VALUES (?, 'default', 'line', 'sanitize', datetime('now'))`,
    ).run(today);
    db.prepare(
      `INSERT INTO cleaning_log (shift_date, location_id, area, task, completed_at)
       VALUES (?, 'other', 'bar', 'wipe-down', datetime('now'))`,
    ).run(today);

    // Two sites with accounting_variance rows.
    db.prepare(
      `INSERT INTO accounting_variance
         (theoretical_cogs, actual_cogs, variance_amount, variance_pct, location_id)
       VALUES (1000, 1080, 80, 8.0, 'default')`,
    ).run();
    db.prepare(
      `INSERT INTO accounting_variance
         (theoretical_cogs, actual_cogs, variance_amount, variance_pct, location_id)
       VALUES (500, 510, 10, 2.0, 'other')`,
    ).run();
  });

  it("'default' site sees only its own cleaning rows", () => {
    assert.strictEqual(readCleaningTodayLikePage(db, 'default'), 2);
  });

  it("'other' site sees only its own cleaning rows", () => {
    assert.strictEqual(readCleaningTodayLikePage(db, 'other'), 1);
  });

  it("a site that doesn't exist returns 0", () => {
    assert.strictEqual(readCleaningTodayLikePage(db, 'ghost'), 0);
  });

  it("'default' site sees its own variance row, not 'other'", () => {
    const v = readLatestAccountingVariance(db, 'default');
    assert.ok(v);
    assert.strictEqual(v.variance_pct, 8.0);
    assert.strictEqual(v.theoretical_cogs, 1000);
  });

  it("'other' site sees its own variance row, not 'default'", () => {
    const v = readLatestAccountingVariance(db, 'other');
    assert.ok(v);
    assert.strictEqual(v.variance_pct, 2.0);
    assert.strictEqual(v.theoretical_cogs, 500);
  });
});

describe('management rollup — new alert counts', () => {
  it('counts price shocks with the page window and threshold', () => {
    insertPriceSnapshot({
      locationId: 'default',
      vendor: 'sysco',
      sku: 'AVO-1',
      ingredient: 'Avocado',
      unitPrice: 2,
      daysAgo: 6,
    });
    insertPriceSnapshot({
      locationId: 'default',
      vendor: 'sysco',
      sku: 'AVO-1',
      ingredient: 'Avocado',
      unitPrice: 2.5,
      daysAgo: 0,
    });
    insertPriceSnapshot({
      locationId: 'default',
      vendor: 'sysco',
      sku: 'OIL-1',
      ingredient: 'Canola Oil',
      unitPrice: 10,
      daysAgo: 6,
    });
    insertPriceSnapshot({
      locationId: 'default',
      vendor: 'sysco',
      sku: 'OIL-1',
      ingredient: 'Canola Oil',
      unitPrice: 10.2,
      daysAgo: 0,
    });

    assert.strictEqual(readPriceShocksCountLikePage(db, 'default'), 1);
  });

  it('counts unresolved depletion issues from existing sales mappings', () => {
    db.prepare(
      `INSERT INTO sales_lines (period_label, item_name, quantity_sold, net_sales, source, location_id)
       VALUES ('2026-W17', 'Mystery Plate', 3, 27, 'toast', 'default'),
              ('2026-W17', 'Mystery Plate', 2, 18, 'toast', 'default'),
              ('2026-W17', 'Unmapped Burger', 1, 14, 'toast', 'default')`,
    ).run();

    assert.strictEqual(readDepletionIssuesCountLikePage(db, 'default'), 2);
  });

  it('counts active certs expired or expiring in 30 days', () => {
    db.prepare(
      `INSERT INTO staff_certifications
         (location_id, cook_id, cert_type, cert_label, expires_on, active)
       VALUES
         ('default', 'alice', 'food_handler', 'Food Handler', ?, 1),
         ('default', 'bob', 'cfpm', 'ServSafe Manager', ?, 1),
         ('default', 'carla', 'tips', 'TIPS', ?, 1),
         ('default', 'drew', 'allergen', 'Allergen', ?, 0)`,
    ).run(
      isoDaysFromToday(-3),
      isoDaysFromToday(15),
      isoDaysFromToday(60),
      isoDaysFromToday(-10),
    );

    assert.deepStrictEqual(readCertWarningsLikePage(db, 'default'), {
      expired: 1,
      expiringSoon: 1,
      total: 2,
    });
  });

  it('counts only accepted stock rows that still need manager matching', () => {
    db.prepare(
      `INSERT INTO receiving_log
         (shift_date, location_id, vendor, category, item, status,
          received_qty, received_unit, match_status)
       VALUES
         ('2026-06-07', 'default', 'Local Farms', 'produce', 'Tomato Case',
          'accepted', 2, 'case', 'unmatched'),
         ('2026-06-07', 'default', 'Shamrock', 'refrigerated', 'Milk 2%',
          'accepted_with_note', 6, 'gal', 'ambiguous'),
         ('2026-06-07', 'default', 'Shamrock', 'refrigerated', 'Chicken Breast',
          'accepted', 40, 'lb', 'matched'),
         ('2026-06-07', 'default', 'Shamrock', 'refrigerated', 'Spoiled Milk',
          'rejected', 6, 'gal', 'unmatched'),
         ('2026-06-07', 'default', 'Local Farms', 'produce', 'No Qty',
          'accepted', NULL, 'case', 'unmatched'),
         ('2026-06-07', 'other', 'Local Farms', 'produce', 'Other Tomato',
          'accepted', 4, 'case', 'unmatched')`,
    ).run();

    assert.strictEqual(readReceivingMatchesCountLikePage(db, 'default'), 2);
  });
});

describe('management rollup — new alert location scoping', () => {
  it('scopes price shocks by location', () => {
    insertPriceSnapshot({
      locationId: 'default',
      vendor: 'sysco',
      sku: 'AVO-1',
      ingredient: 'Avocado',
      unitPrice: 2,
      daysAgo: 6,
    });
    insertPriceSnapshot({
      locationId: 'default',
      vendor: 'sysco',
      sku: 'AVO-1',
      ingredient: 'Avocado',
      unitPrice: 2.5,
      daysAgo: 0,
    });
    insertPriceSnapshot({
      locationId: 'other',
      vendor: 'shamrock',
      sku: 'CHEESE-1',
      ingredient: 'Cheddar',
      unitPrice: 4,
      daysAgo: 6,
    });
    insertPriceSnapshot({
      locationId: 'other',
      vendor: 'shamrock',
      sku: 'CHEESE-1',
      ingredient: 'Cheddar',
      unitPrice: 5,
      daysAgo: 0,
    });
    insertPriceSnapshot({
      locationId: 'other',
      vendor: 'shamrock',
      sku: 'CREAM-1',
      ingredient: 'Cream',
      unitPrice: 3,
      daysAgo: 6,
    });
    insertPriceSnapshot({
      locationId: 'other',
      vendor: 'shamrock',
      sku: 'CREAM-1',
      ingredient: 'Cream',
      unitPrice: 3.5,
      daysAgo: 0,
    });

    assert.strictEqual(readPriceShocksCountLikePage(db, 'default'), 1);
    assert.strictEqual(readPriceShocksCountLikePage(db, 'other'), 2);
  });

  it('scopes depletion issues by location', () => {
    db.prepare(
      `INSERT INTO sales_lines (period_label, item_name, quantity_sold, net_sales, source, location_id)
       VALUES ('2026-W17', 'Default Plate', 1, 10, 'toast', 'default'),
              ('2026-W17', 'Satellite Plate', 1, 12, 'toast', 'other'),
              ('2026-W17', 'Satellite Bowl', 1, 13, 'toast', 'other')`,
    ).run();

    assert.strictEqual(readDepletionIssuesCountLikePage(db, 'default'), 1);
    assert.strictEqual(readDepletionIssuesCountLikePage(db, 'other'), 2);
  });

  it('scopes cert warnings by location', () => {
    db.prepare(
      `INSERT INTO staff_certifications
         (location_id, cook_id, cert_type, cert_label, expires_on, active)
       VALUES
         ('default', 'alice', 'food_handler', 'Food Handler', ?, 1),
         ('other', 'bob', 'cfpm', 'ServSafe Manager', ?, 1),
         ('other', 'carla', 'tips', 'TIPS', ?, 1)`,
    ).run(
      isoDaysFromToday(15),
      isoDaysFromToday(-1),
      isoDaysFromToday(10),
    );

    assert.deepStrictEqual(readCertWarningsLikePage(db, 'default'), {
      expired: 0,
      expiringSoon: 1,
      total: 1,
    });
    assert.deepStrictEqual(readCertWarningsLikePage(db, 'other'), {
      expired: 1,
      expiringSoon: 1,
      total: 2,
    });
  });

  it('scopes receiving-match debt by location', () => {
    db.prepare(
      `INSERT INTO receiving_log
         (shift_date, location_id, vendor, category, item, status,
          received_qty, received_unit, match_status)
       VALUES
         ('2026-06-07', 'default', 'Local Farms', 'produce', 'Tomato Case',
          'accepted', 2, 'case', 'unmatched'),
         ('2026-06-07', 'other', 'Local Farms', 'produce', 'Other Tomato',
          'accepted', 4, 'case', 'unmatched'),
         ('2026-06-07', 'other', 'Shamrock', 'refrigerated', 'Other Milk',
          'accepted_with_note', 6, 'gal', 'ambiguous')`,
    ).run();

    assert.strictEqual(readReceivingMatchesCountLikePage(db, 'default'), 1);
    assert.strictEqual(readReceivingMatchesCountLikePage(db, 'other'), 2);
  });
});

describe('management rollup — pack-size count is O(1) and ack-aware', () => {
  it('counts only acknowledged=0 rows; ignores acked', () => {
    db.prepare(
      `INSERT INTO pack_size_changes (vendor, sku, prev_pack, new_pack, acknowledged)
       VALUES ('sysco', 'A', '6x#10', '4x#10', 0)`,
    ).run();
    db.prepare(
      `INSERT INTO pack_size_changes (vendor, sku, prev_pack, new_pack, acknowledged)
       VALUES ('sysco', 'B', '12x12oz', '24x6oz', 0)`,
    ).run();
    db.prepare(
      `INSERT INTO pack_size_changes (vendor, sku, prev_pack, new_pack, acknowledged)
       VALUES ('shamrock', 'C', '1cs', '2cs', 1)`,
    ).run();

    assert.strictEqual(readPackSizeChangesUnackedLikePage(db), 2);

    // Acknowledge one of the two outstanding — count should drop to 1.
    db.prepare(`UPDATE pack_size_changes SET acknowledged = 1 WHERE sku = 'A'`).run();
    assert.strictEqual(readPackSizeChangesUnackedLikePage(db), 1);
  });

  it('returns null when the pack_size_changes table is missing (legacy DB)', () => {
    // Drop the table to simulate a pre-migration DB.
    db.exec('DROP TABLE pack_size_changes');
    assert.strictEqual(readPackSizeChangesUnackedLikePage(db), null);

    // Recreate so other tests' beforeEach DELETE doesn't crash.
    db.exec(`
      CREATE TABLE pack_size_changes (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        vendor       TEXT NOT NULL,
        sku          TEXT NOT NULL,
        prev_pack    TEXT,
        new_pack     TEXT,
        prev_price   REAL,
        new_price    REAL,
        detected_at  TEXT DEFAULT (datetime('now')),
        acknowledged INTEGER DEFAULT 0
      );
    `);
  });
});
