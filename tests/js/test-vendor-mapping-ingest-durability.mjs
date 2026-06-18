#!/usr/bin/env node
import { describe, it, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register(new URL('./resolver.mjs', import.meta.url));

const { getDb, setDbPathForTest } = await import('../../lib/db.ts');
setDbPathForTest(':memory:');
const db = getDb();
after(() => setDbPathForTest(null));

const { pairCatalogRows } = await import('../../lib/vendorMappingRepo.ts');

const BEVERAGE_CATEGORIES = ['beer', 'wine', 'liquor', 'na beverage'];

function simulateIngestVpSweep(locationId = 'default') {
  const bevPlaceholders = BEVERAGE_CATEGORIES.map(() => '?').join(',');
  const operatorVpMasterByKey = new Map();
  const masterSnapRows = db.prepare(
    `SELECT vendor, sku, master_id FROM vendor_prices
      WHERE location_id = ?
        AND master_id IS NOT NULL AND TRIM(master_id) != ''
        AND COALESCE(LOWER(category), '') NOT IN (${bevPlaceholders})`,
  ).all(locationId, ...BEVERAGE_CATEGORIES);
  for (const r of masterSnapRows) {
    const vendor = String(r.vendor ?? '').trim().toLowerCase();
    const sku = String(r.sku ?? '');
    if (!vendor || !sku) continue;
    operatorVpMasterByKey.set(`${vendor}\x1f${sku}`, String(r.master_id));
  }

  const workbookRows = db
    .prepare(
      `SELECT ingredient, vendor, sku, pack_size, pack_unit, unit_price, category
         FROM vendor_prices WHERE location_id = ? AND COALESCE(LOWER(category), '') NOT IN (${bevPlaceholders})`,
    )
    .all(locationId, ...BEVERAGE_CATEGORIES);

  db.prepare(
    `DELETE FROM vendor_prices WHERE location_id = ? AND COALESCE(LOWER(category), '') NOT IN (${bevPlaceholders})`,
  ).run(locationId, ...BEVERAGE_CATEGORIES);

  const ins = db.prepare(
    `INSERT INTO vendor_prices (ingredient, vendor, sku, pack_size, pack_unit, unit_price, location_id, category)
     VALUES (@ingredient, @vendor, @sku, @pack_size, @pack_unit, @unit_price, @location_id, @category)`,
  );
  for (const r of workbookRows) {
    ins.run({
      ingredient: r.ingredient,
      vendor: r.vendor,
      sku: r.sku,
      pack_size: r.pack_size,
      pack_unit: r.pack_unit,
      unit_price: r.unit_price,
      location_id: locationId,
      category: r.category,
    });
  }

  const reapplyVpMaster = db.prepare(`
    UPDATE vendor_prices
       SET master_id = @master_id
     WHERE location_id = @location_id
       AND lower(trim(vendor)) = @vendor
       AND sku = @sku
  `);
  for (const [key, masterId] of operatorVpMasterByKey) {
    const sep = key.indexOf('\x1f');
    const vendor = key.slice(0, sep);
    const sku = key.slice(sep + 1);
    reapplyVpMaster.run({ master_id: masterId, location_id: locationId, vendor, sku });
  }
}

beforeEach(() => {
  db.exec(`DELETE FROM audit_events; DELETE FROM ingredient_maps; DELETE FROM ingredient_masters; DELETE FROM vendor_prices;`);
});

describe('ingest master_id durability', () => {
  it('reapply preserves operator master_id after VP delete+insert', () => {
    db.prepare(
      `INSERT INTO vendor_prices (ingredient, vendor, sku, pack_size, pack_unit, unit_price, location_id, master_id)
       VALUES ('CHICKEN BREAST B/S', 'Sysco', 'S123', 1, 'lb', 4.2, 'default', 'chicken_breast')`,
    ).run();
    db.prepare(
      `INSERT INTO vendor_prices (ingredient, vendor, sku, pack_size, pack_unit, unit_price, location_id, master_id)
       VALUES ('CHICKEN BRST BNLS', 'Shamrock', 'H456', 1, 'lb', 3.9, 'default', 'chicken_breast')`,
    ).run();
    simulateIngestVpSweep();
    const sysco = db.prepare(`SELECT master_id FROM vendor_prices WHERE sku = 'S123'`).get();
    const sham = db.prepare(`SELECT master_id FROM vendor_prices WHERE sku = 'H456'`).get();
    assert.equal(sysco.master_id, 'chicken_breast');
    assert.equal(sham.master_id, 'chicken_breast');
  });

  it('pair then ingest sweep keeps both sides linked', () => {
    db.prepare(
      `INSERT INTO vendor_prices (ingredient, vendor, sku, pack_size, pack_unit, unit_price, location_id)
       VALUES ('CHICKEN BREAST B/S', 'Sysco', 'S123', 1, 'lb', 4.2, 'default')`,
    ).run();
    db.prepare(
      `INSERT INTO vendor_prices (ingredient, vendor, sku, pack_size, pack_unit, unit_price, location_id)
       VALUES ('CHICKEN BRST BNLS', 'Shamrock', 'H456', 1, 'lb', 3.9, 'default')`,
    ).run();
    pairCatalogRows(db, {
      syscoKey: { vendor: 'sysco', sku: 'S123', ingredient: 'CHICKEN BREAST B/S' },
      shamrockKey: { vendor: 'shamrock', sku: 'H456', ingredient: 'CHICKEN BRST BNLS' },
      canonicalName: 'Chicken Breast',
    });
    simulateIngestVpSweep();
    const count = db.prepare(`SELECT COUNT(*) AS c FROM vendor_prices WHERE master_id = 'chicken_breast'`).get();
    assert.equal(count.c, 2);
  });

  it('beverage rows excluded from sweep keep master_id', () => {
    db.prepare(
      `INSERT INTO vendor_prices (ingredient, vendor, sku, category, location_id, master_id, pack_size, pack_unit, unit_price)
       VALUES ('Modelo', 'Sysco', 'B1', 'beer', 'default', 'modelo', 1, 'each', 2)`,
    ).run();
    simulateIngestVpSweep();
    const row = db.prepare(`SELECT master_id FROM vendor_prices WHERE sku = 'B1'`).get();
    assert.equal(row.master_id, 'modelo');
  });
});
