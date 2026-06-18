#!/usr/bin/env node
import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register(new URL('./resolver.mjs', import.meta.url));

const { getDb, setDbPathForTest } = await import('../../lib/db.ts');
setDbPathForTest(':memory:');
const db = getDb();
after(() => setDbPathForTest(null));

const { enrichOrderGuideRow } = await import('../../lib/orderGuideEnrichment.ts');

beforeEach(() => {
  db.exec(`DELETE FROM ingredient_masters; DELETE FROM vendor_prices;`);
});

describe('orderGuideEnrichment', () => {
  it('flags vendor mismatch when guide vendor differs from preferred', () => {
    db.prepare(
      `INSERT INTO ingredient_masters (master_id, canonical_name, preferred_vendor, quality_locked)
       VALUES ('avocado', 'Avocado', 'sysco', 0)`,
    ).run();
    db.prepare(
      `INSERT INTO vendor_prices (ingredient, vendor, sku, location_id, master_id, pack_size, pack_unit, unit_price)
       VALUES ('Avocado Hass', 'Shamrock', 'H1', 'default', 'avocado', 1, 'each', 1.4)`,
    ).run();
    const e = enrichOrderGuideRow(db, {
      ingredient: 'Avocado Hass',
      vendor: 'Shamrock',
      base_qty: 1,
      unit: 'each',
      unit_price: 1.4,
    });
    assert.ok(e);
    assert.equal(e.vendor_mismatch, true);
    assert.equal(e.preferred_vendor, 'sysco');
  });

  it('shows lock badge data', () => {
    db.prepare(
      `INSERT INTO ingredient_masters (master_id, canonical_name, preferred_vendor, quality_locked, quality_lock_reason)
       VALUES ('lime', 'Lime', 'shamrock', 1, 'quality')`,
    ).run();
    db.prepare(
      `INSERT INTO vendor_prices (ingredient, vendor, sku, location_id, master_id, pack_size, pack_unit, unit_price)
       VALUES ('Lime', 'Shamrock', 'H9', 'default', 'lime', 1, 'each', 0.2)`,
    ).run();
    const e = enrichOrderGuideRow(db, {
      ingredient: 'Lime',
      vendor: 'Shamrock',
      base_qty: 1,
      unit: 'each',
      unit_price: 0.2,
    });
    assert.equal(e.quality_locked, true);
    assert.equal(e.quality_lock_reason, 'quality');
  });

  it('returns null when no VP link', () => {
    const e = enrichOrderGuideRow(db, {
      ingredient: 'Mystery Item',
      vendor: 'Sysco',
      base_qty: 1,
      unit: 'each',
      unit_price: 1,
    });
    assert.equal(e, null);
  });
});
