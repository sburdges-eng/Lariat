// @ts-nocheck -- Jest globals are supplied by the test runner.
/** @jest-environment jsdom */
//
// Regression for a stale-current-price bug found during the GH #250
// checkjs migration of app/costing/prices/[vendor]/[sku]/page.jsx: the
// "Current" price KPI (and the "Change" % derived from it) read the tail
// of vendor_prices_history instead of the live vendor_prices row the page
// already fetches into `current`. Both ingest paths — scripts/ingest-
// costing.mjs and lib/vendorPricesRepo.ts's upsertVendorPrice — snapshot
// the OLD price into history BEFORE writing the NEW price into the live
// table, so vendor_prices_history's newest row for a SKU is always one
// price move behind vendor_prices. listPriceShocks() (same lib file as
// listPriceSeries, which this page consumes) already overlays the live
// price for exactly this reason ("Without this overlay a fresh price
// move is invisible (or one ingest behind)"), but this page's single-SKU
// view never got that treatment — it displayed a stale "Current" price
// and a stale "Change" % any time a SKU had been re-ingested since its
// last history snapshot.
import { render, screen } from '@testing-library/react';

import * as db from '../../lib/db.ts';
import SkuHistoryPage from '../costing/prices/[vendor]/[sku]/page.jsx';

const VENDOR = 'TestVendor';
const SKU = 'TV-001';

beforeAll(() => {
  db.setDbPathForTest(':memory:');
});

afterAll(() => {
  db.setDbPathForTest(null);
});

beforeEach(() => {
  const conn = db.getDb();
  conn.exec('DELETE FROM vendor_prices; DELETE FROM vendor_prices_history;');
});

function seed() {
  const conn = db.getDb();
  // Baseline history snapshot: $2.00/unit.
  conn
    .prepare(
      `INSERT INTO vendor_prices_history
         (ingredient, vendor, sku, pack_size, pack_unit, pack_price, unit_price,
          category, location_id, imported_at, snapshot_at, snapshot_reason)
       VALUES ('Test Ingredient', ?, ?, 10, 'lb', 20.00, 2.00, 'produce', 'default',
               '2026-07-01 00:00:00', '2026-07-01 00:00:00', 'test-seed')`,
    )
    .run(VENDOR, SKU);
  // Newest history snapshot: $2.50/unit — this is what the buggy code
  // showed as "Current", but it is one ingest cycle STALE relative to the
  // live vendor_prices row below (per the snapshot-old-before-write-new
  // sequencing both ingest paths use).
  conn
    .prepare(
      `INSERT INTO vendor_prices_history
         (ingredient, vendor, sku, pack_size, pack_unit, pack_price, unit_price,
          category, location_id, imported_at, snapshot_at, snapshot_reason)
       VALUES ('Test Ingredient', ?, ?, 10, 'lb', 25.00, 2.50, 'produce', 'default',
               '2026-07-05 00:00:00', '2026-07-05 00:00:00', 'test-seed')`,
    )
    .run(VENDOR, SKU);
  // Live vendor_prices row: the TRUE current price ($3.00/unit) — already
  // ingested, not yet snapshotted into history (that only happens on the
  // *next* ingest run).
  conn
    .prepare(
      `INSERT INTO vendor_prices
         (ingredient, vendor, sku, pack_size, pack_unit, pack_price, unit_price,
          category, location_id, imported_at)
       VALUES ('Test Ingredient', ?, ?, 10, 'lb', 30.00, 3.00, 'produce', 'default',
               '2026-07-10 00:00:00')`,
    )
    .run(VENDOR, SKU);
}

describe('SkuHistoryPage — "Current" reads the live vendor_prices row, not stale history', () => {
  test('Current KPI shows the live price ($3.0000), not the stale history tail ($2.5000)', async () => {
    seed();
    render(
      await SkuHistoryPage({
        params: { vendor: VENDOR, sku: SKU },
        searchParams: {},
      }),
    );
    const currentValue = screen.getByText('Current').parentElement.querySelector('.kpi-value');
    expect(currentValue).toHaveTextContent('$3.0000');
  });

  test('Change % is computed against the live current price, not the stale history tail', async () => {
    seed();
    render(
      await SkuHistoryPage({
        params: { vendor: VENDOR, sku: SKU },
        searchParams: {},
      }),
    );
    // (3.00 - 2.00) / 2.00 * 100 = +50.0% (live). The bug would have shown
    // +25.0% ((2.50 - 2.00) / 2.00 * 100), off the stale history tail.
    const changeValue = screen.getByText('Change').parentElement.querySelector('.kpi-value');
    expect(changeValue).toHaveTextContent('+50.0%');
  });

  test('the Snapshots list still shows the recorded historical price ($2.5000) unaffected', () => {
    // Sanity check: the fix only changes which price feeds "Current"/
    // "Change" — the raw history table itself is untouched. (The Sparkline
    // axis label also legitimately shows $2.5000 as the series max, so
    // assert on presence rather than a single exact match.)
    seed();
    return SkuHistoryPage({
      params: { vendor: VENDOR, sku: SKU },
      searchParams: {},
    }).then((el) => {
      render(el);
      expect(screen.getAllByText('$2.5000').length).toBeGreaterThan(0);
    });
  });
});
