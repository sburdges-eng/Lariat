/**
 * rebuild-cache must not delete the invoice record.
 *
 * `buildVendorSummary()` rebuilds `vendor_summary.json` from CSV exports and
 * returns a fresh object. It never read the file it was about to overwrite, so
 * every line appended by `ingest_sysco_order_emails.py` and
 * `ingest_sysco_invoice_pdfs.py` was discarded on each run.
 *
 * That is not hypothetical. `docs/OPERATIONS.md` lists `npm run rebuild-cache`
 * as the per-delivery Sysco step, and none of the CSVs it rebuilds from are
 * present in the repo — so today the rebuild writes an *empty* vendor summary
 * over 207 recovered April/May lines and gains nothing. The already-empty
 * `catalog` and the vanished `webstaurantstore` key in the committed cache are
 * what that looks like after it has happened once.
 *
 * These tests pin the merge contract: a rebuild may add and may correct, but it
 * may never silently drop transactional rows it has no source for.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildVendorSummary } from '../../scripts/rebuild-cache.mjs';

/** Shape of a recovered order-email row, as the ingest writes it. */
const emailRow = (invoice, description) => ({
  invoice,
  delivery_date: '4/2/2026',
  description,
  qty: 2,
  category: 'Dairy',
  supc: '4002408',
  extended_price: 108.2,
  source: 'order_email',
});

const existingCache = () => ({
  sysco: {
    recent_items: [
      emailRow('04488129', 'Mayonnaise Heavy Duty Pail'),
      emailRow('04488128', 'Spice Asian Yuzu Kosho Green'),
    ],
    catalog: [{ supc: '1234567', description: 'Catalog Item' }],
    last_invoice_date: '6/1/2026',
  },
  webstaurantstore: { total_spend: 4321.0, line_items_available: false },
});

describe('buildVendorSummary — preserves what it cannot rebuild', () => {
  it('keeps ingested recent_items when no CSV source supplies them', () => {
    const result = buildVendorSummary(existingCache());
    const invoices = result.sysco.recent_items.map((r) => r.invoice);
    assert.ok(
      invoices.includes('04488129') && invoices.includes('04488128'),
      'recovered order-email lines must survive a rebuild',
    );
  });

  it('never returns fewer recent_items than it was given', () => {
    const existing = existingCache();
    const before = existing.sysco.recent_items.length;
    const result = buildVendorSummary(existing);
    assert.ok(
      result.sysco.recent_items.length >= before,
      `rebuild shrank recent_items ${before} -> ${result.sysco.recent_items.length}`,
    );
  });

  it('keeps a populated catalog rather than blanking it', () => {
    const result = buildVendorSummary(existingCache());
    assert.equal(result.sysco.catalog.length, 1);
  });

  it('preserves vendors it does not know how to rebuild', () => {
    const result = buildVendorSummary(existingCache());
    assert.equal(result.webstaurantstore?.total_spend, 4321.0);
  });

  it('does not regress last_invoice_date', () => {
    const result = buildVendorSummary(existingCache());
    assert.equal(result.sysco.last_invoice_date, '6/1/2026');
  });

  it('is safe on a first run with no existing cache', () => {
    const result = buildVendorSummary(undefined);
    assert.ok(Array.isArray(result.sysco.recent_items));
    assert.ok(Array.isArray(result.sysco.catalog));
  });

  it('does not duplicate a row already present under the same key', () => {
    const existing = existingCache();
    // Feed the output back in: a second rebuild must be a no-op, not a doubling.
    const once = buildVendorSummary(existing);
    const twice = buildVendorSummary(once);
    assert.equal(twice.sysco.recent_items.length, once.sysco.recent_items.length);
  });
});
